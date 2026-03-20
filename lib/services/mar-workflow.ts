import { createHash } from "node:crypto";

import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import {
  MAR_NOT_GIVEN_REASON_OPTIONS,
  MAR_PRN_OUTCOME_OPTIONS,
  type MarAdministrationHistoryRow,
  type MarNotGivenReason,
  type MarPrnOption,
  type MarPrnOutcome,
  type MarTodayRow,
  type MarWorkflowSnapshot
} from "@/lib/services/mar-shared";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import {
  clean,
  isDateWithinMedicationWindow,
  mapMarHistoryRow,
  mapMarTodayRow,
  normalizeGenerationWindow,
  normalizeScheduledTimes,
  throwMarSupabaseError,
  toMemberPhotoLookup,
  type MemberPhotoRow
} from "@/lib/services/mar-workflow-core";
import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
import { easternDateTimeLocalToISO, toEasternDate, toEasternISO } from "@/lib/timezone";

export { MAR_NOT_GIVEN_REASON_OPTIONS, MAR_PRN_OUTCOME_OPTIONS };
export type {
  MarAdministrationHistoryRow,
  MarNotGivenReason,
  MarPrnOption,
  MarPrnOutcome,
  MarTodayRow,
  MarWorkflowSnapshot
};

type PhysicianOrderForSyncRow = {
  id: string;
  member_id: string;
  status: string;
};
const MAR_MHP_SOURCE_PREFIX = "mhp-";
const MAR_MEDICATION_SYNC_RPC = "rpc_sync_mar_medications_from_member_profile";
const MAR_RECONCILE_RPC = "rpc_reconcile_member_mar_state";
const MAR_RPC_MIGRATION = "0056_shared_rpc_orchestration_hardening.sql";
const MAR_TODAY_SELECT =
  "mar_schedule_id, member_id, member_name, pof_medication_id, medication_name, dose, route, frequency, instructions, prn, scheduled_time, administration_id, status, not_given_reason, prn_reason, notes, administered_by, administered_by_user_id, administered_at, source";
const MAR_HISTORY_SELECT =
  "id, member_id, member_name, pof_medication_id, mar_schedule_id, administration_date, scheduled_time, medication_name, dose, route, status, not_given_reason, prn_reason, prn_outcome, prn_outcome_assessed_at, prn_followup_note, notes, administered_by, administered_by_user_id, administered_at, source, created_at, updated_at";

type MarMedicationSyncRpcRow = {
  anchor_physician_order_id: string;
  synced_medications: number;
};

type MarReconcileRpcRow = {
  anchor_physician_order_id: string;
  synced_medications: number;
  inserted_schedules: number;
  patched_schedules: number;
  reactivated_schedules: number;
  deactivated_schedules: number;
};

type MarSyncMedicationRow = {
  member_id: string | null;
  updated_at: string | null;
  scheduled_times: unknown;
  start_date: string | null;
  end_date: string | null;
};

type MarScheduleFreshnessRow = {
  member_id: string | null;
  updated_at: string | null;
};

function addDaysDateOnly(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildPrnAdministrationIdempotencyKey(input: {
  pofMedicationId: string;
  administeredAt: string;
  prnReason: string;
  submissionId?: string | null;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        pofMedicationId: input.pofMedicationId,
        administeredAt: input.administeredAt,
        prnReason: input.prnReason.trim().toLowerCase(),
        submissionId: clean(input.submissionId)?.toLowerCase() ?? null
      })
    )
    .digest("hex");
}

async function resolveMarMemberId(memberId: string, actionLabel: string, serviceRole?: boolean) {
  const canonical = await resolveCanonicalMemberRef(
    {
      sourceType: "member",
      memberId,
      selectedId: memberId
    },
    { actionLabel, serviceRole }
  );
  if (!canonical.memberId) {
    throw new Error(`${actionLabel} expected member.id but canonical member resolution returned empty memberId.`);
  }
  return canonical.memberId;
}

async function syncMarMedicationsFromMhp(input: {
  memberId: string;
  anchorPhysicianOrderId?: string | null;
  serviceRole?: boolean;
}) {
  const serviceRole = input.serviceRole ?? true;
  const memberId = await resolveMarMemberId(input.memberId, "syncMarMedicationsFromMhp", serviceRole);
  const supabase = await createClient({ serviceRole });
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, MAR_MEDICATION_SYNC_RPC, {
      p_member_id: memberId,
      p_preferred_physician_order_id: input.anchorPhysicianOrderId ?? null,
      p_now: toEasternISO()
    });
    const row = (Array.isArray(data) ? data[0] : null) as MarMedicationSyncRpcRow | null;
    return { synced: Number(row?.synced_medications ?? 0) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync MAR medications from member profile.";
    if (message.includes(MAR_MEDICATION_SYNC_RPC)) {
      throw new Error(
        `MAR medication sync RPC is not available. Apply Supabase migration ${MAR_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function syncPofMedicationsFromSignedOrder(input: {
  physicianOrderId: string;
  serviceRole?: boolean;
}) {
  const serviceRole = input.serviceRole ?? true;
  const supabase = await createClient({ serviceRole });
  const { data, error } = await supabase
    .from("physician_orders")
    .select("id, member_id, status")
    .eq("id", input.physicianOrderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Physician order not found for MAR medication sync.");

  const order = data as PhysicianOrderForSyncRow;
  if (order.status !== "signed") {
    return { synced: 0 };
  }
  return syncMarMedicationsFromMhp({
    memberId: order.member_id,
    anchorPhysicianOrderId: order.id,
    serviceRole
  });
}

export async function generateMarSchedulesForMember(input: {
  memberId: string;
  startDate?: string | null;
  endDate?: string | null;
  serviceRole?: boolean;
}) {
  const serviceRole = input.serviceRole ?? true;
  const memberId = await resolveMarMemberId(input.memberId, "generateMarSchedulesForMember", serviceRole);
  const { startDate, endDate } = normalizeGenerationWindow(input.startDate, input.endDate);
  const supabase = await createClient({ serviceRole });
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, MAR_RECONCILE_RPC, {
      p_member_id: memberId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_preferred_physician_order_id: null,
      p_now: toEasternISO()
    });
    const row = (Array.isArray(data) ? data[0] : null) as MarReconcileRpcRow | null;
    return {
      inserted: Number(row?.inserted_schedules ?? 0),
      patched: Number(row?.patched_schedules ?? 0),
      reactivated: Number(row?.reactivated_schedules ?? 0),
      deactivated: Number(row?.deactivated_schedules ?? 0)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reconcile MAR schedules.";
    if (message.includes(MAR_RECONCILE_RPC)) {
      throw new Error(
        `MAR reconciliation RPC is not available. Apply Supabase migration ${MAR_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function syncTodayMarSchedules(options?: { serviceRole?: boolean }) {
  const serviceRole = options?.serviceRole ?? true;
  const today = toEasternDate();
  const supabase = await createClient({ serviceRole });
  const todayStart = easternDateTimeLocalToISO(`${today}T00:00`);
  const tomorrow = addDaysDateOnly(today, 1);
  const todayEndExclusive = easternDateTimeLocalToISO(`${tomorrow}T00:00`);
  const [{ data: medicationRowsRaw, error: medicationError }, { data: scheduleRowsRaw, error: scheduleError }] = await Promise.all([
    supabase
      .from("pof_medications")
      .select("member_id, updated_at, scheduled_times, start_date, end_date")
      .eq("active", true)
      .eq("given_at_center", true)
      .eq("prn", false)
      .like("source_medication_id", `${MAR_MHP_SOURCE_PREFIX}%`),
    supabase
      .from("mar_schedules")
      .select("member_id, updated_at")
      .eq("active", true)
      .gte("scheduled_time", todayStart)
      .lt("scheduled_time", todayEndExclusive)
  ]);
  if (medicationError) throwMarSupabaseError(medicationError, "pof_medications");
  if (scheduleError) throwMarSupabaseError(scheduleError, "mar_schedules");

  const medicationRows = ((medicationRowsRaw ?? []) as MarSyncMedicationRow[]).filter((row) =>
    row.member_id && isDateWithinMedicationWindow(today, row.start_date, row.end_date)
  );
  const scheduleRows = (scheduleRowsRaw ?? []) as MarScheduleFreshnessRow[];

  const expectedScheduleCountByMember = new Map<string, number>();
  const latestMedicationUpdateByMember = new Map<string, number>();
  medicationRows.forEach((row) => {
    const memberId = clean(row.member_id);
    if (!memberId) return;
    const currentCount = expectedScheduleCountByMember.get(memberId) ?? 0;
    expectedScheduleCountByMember.set(memberId, currentCount + normalizeScheduledTimes(row.scheduled_times).length);
    const updatedAtMs = Date.parse(String(row.updated_at ?? ""));
    if (Number.isFinite(updatedAtMs)) {
      latestMedicationUpdateByMember.set(memberId, Math.max(latestMedicationUpdateByMember.get(memberId) ?? 0, updatedAtMs));
    }
  });

  const activeScheduleCountByMember = new Map<string, number>();
  const latestScheduleUpdateByMember = new Map<string, number>();
  scheduleRows.forEach((row) => {
    const memberId = clean(row.member_id);
    if (!memberId) return;
    activeScheduleCountByMember.set(memberId, (activeScheduleCountByMember.get(memberId) ?? 0) + 1);
    const updatedAtMs = Date.parse(String(row.updated_at ?? ""));
    if (Number.isFinite(updatedAtMs)) {
      latestScheduleUpdateByMember.set(memberId, Math.max(latestScheduleUpdateByMember.get(memberId) ?? 0, updatedAtMs));
    }
  });

  const candidateMemberIds = Array.from(new Set([...expectedScheduleCountByMember.keys(), ...activeScheduleCountByMember.keys()]));
  const memberIds = candidateMemberIds.filter((memberId) => {
    const expectedCount = expectedScheduleCountByMember.get(memberId) ?? 0;
    const activeCount = activeScheduleCountByMember.get(memberId) ?? 0;
    if (expectedCount !== activeCount) return true;
    if (expectedCount === 0) return false;
    return (latestMedicationUpdateByMember.get(memberId) ?? 0) > (latestScheduleUpdateByMember.get(memberId) ?? 0);
  });

  if (memberIds.length === 0) {
    return;
  }

  await Promise.all(
    memberIds.map((memberId) =>
      generateMarSchedulesForMember({
        memberId,
        startDate: today,
        endDate: today,
        serviceRole
      })
    )
  );
}

export async function getMarWorkflowSnapshot(options?: {
  serviceRole?: boolean;
  historyLimit?: number;
  prnLimit?: number;
  reconcileToday?: boolean;
}) {
  const serviceRole = options?.serviceRole ?? true;
  if (options?.reconcileToday) {
    await syncTodayMarSchedules({ serviceRole });
  }
  const todayDate = toEasternDate();

  const historyLimit = Math.max(10, Math.min(options?.historyLimit ?? 200, 500));
  const prnLimit = Math.max(10, Math.min(options?.prnLimit ?? 200, 500));
  const supabase = await createClient({ serviceRole });

  const [
    { data: todayRowsRaw, error: todayError },
    { data: overdueRowsRaw, error: overdueError },
    { data: notGivenRowsRaw, error: notGivenError },
    { data: historyRowsRaw, error: historyError },
    { data: prnRowsRaw, error: prnError },
    { data: prnAwaitingRaw, error: prnAwaitingError },
    { data: prnEffectiveRaw, error: prnEffectiveError },
    { data: prnIneffectiveRaw, error: prnIneffectiveError }
  ] = await Promise.all([
    supabase.from("v_mar_today").select(MAR_TODAY_SELECT).order("scheduled_time", { ascending: true }),
    supabase.from("v_mar_overdue_today").select(MAR_TODAY_SELECT).order("scheduled_time", { ascending: true }),
    supabase.from("v_mar_not_given_today").select(MAR_HISTORY_SELECT).order("administered_at", { ascending: false }),
    supabase.from("v_mar_administration_history").select(MAR_HISTORY_SELECT).order("administered_at", { ascending: false }).limit(historyLimit),
    supabase.from("v_mar_prn_log").select(MAR_HISTORY_SELECT).order("administered_at", { ascending: false }).limit(prnLimit),
    supabase.from("v_mar_prn_given_awaiting_outcome").select(MAR_HISTORY_SELECT).order("administered_at", { ascending: false }).limit(prnLimit),
    supabase.from("v_mar_prn_effective").select(MAR_HISTORY_SELECT).order("administered_at", { ascending: false }).limit(prnLimit),
    supabase.from("v_mar_prn_ineffective").select(MAR_HISTORY_SELECT).order("administered_at", { ascending: false }).limit(prnLimit)
  ]);

  if (todayError) throwMarSupabaseError(todayError, "v_mar_today");
  if (overdueError) throwMarSupabaseError(overdueError, "v_mar_overdue_today");
  if (notGivenError) throwMarSupabaseError(notGivenError, "v_mar_not_given_today");
  if (historyError) throwMarSupabaseError(historyError, "v_mar_administration_history");
  if (prnError) throwMarSupabaseError(prnError, "v_mar_prn_log");
  if (prnAwaitingError) throwMarSupabaseError(prnAwaitingError, "v_mar_prn_given_awaiting_outcome");
  if (prnEffectiveError) throwMarSupabaseError(prnEffectiveError, "v_mar_prn_effective");
  if (prnIneffectiveError) throwMarSupabaseError(prnIneffectiveError, "v_mar_prn_ineffective");

  const today = (todayRowsRaw ?? [])
    .map((row: unknown) => mapMarTodayRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarTodayRow => Boolean(row));
  const overdueToday = (overdueRowsRaw ?? [])
    .map((row: unknown) => mapMarTodayRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarTodayRow => Boolean(row));
  const notGivenToday = (notGivenRowsRaw ?? [])
    .map((row: unknown) => mapMarHistoryRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarAdministrationHistoryRow => Boolean(row));
  const history = (historyRowsRaw ?? [])
    .map((row: unknown) => mapMarHistoryRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarAdministrationHistoryRow => Boolean(row));
  const prnLog = (prnRowsRaw ?? [])
    .map((row: unknown) => mapMarHistoryRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarAdministrationHistoryRow => Boolean(row));
  const prnAwaitingOutcome = (prnAwaitingRaw ?? [])
    .map((row: unknown) => mapMarHistoryRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarAdministrationHistoryRow => Boolean(row));
  const prnEffective = (prnEffectiveRaw ?? [])
    .map((row: unknown) => mapMarHistoryRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarAdministrationHistoryRow => Boolean(row));
  const prnIneffective = (prnIneffectiveRaw ?? [])
    .map((row: unknown) => mapMarHistoryRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarAdministrationHistoryRow => Boolean(row));

  const { data: prnMedicationRows, error: prnMedicationError } = await supabase
    .from("pof_medications")
    .select("id, member_id, medication_name, dose, route, prn_instructions, start_date, end_date")
    .eq("active", true)
    .eq("given_at_center", true)
    .eq("prn", true)
    .like("source_medication_id", `${MAR_MHP_SOURCE_PREFIX}%`);
  if (prnMedicationError) throwMarSupabaseError(prnMedicationError, "pof_medications");

  const prnMemberIds = Array.from(
    new Set((prnMedicationRows ?? []).map((row: { member_id: string | null }) => clean(row.member_id)).filter((row): row is string => Boolean(row)))
  );
  let memberRows: { id: string; display_name: string }[] = [];
  if (prnMemberIds.length > 0) {
    const { data, error } = await supabase.from("members").select("id, display_name").in("id", prnMemberIds);
    if (error) throw new Error(error.message);
    memberRows = (data ?? []) as { id: string; display_name: string }[];
  }

  const memberNameById = new Map(
    memberRows.map((row: { id: string; display_name: string }) => [row.id, row.display_name] as const)
  );
  const prnMedicationOptions: MarPrnOption[] = (prnMedicationRows ?? [])
    .filter((row: { start_date: string | null; end_date: string | null }) =>
      isDateWithinMedicationWindow(todayDate, row.start_date, row.end_date)
    )
    .map((row: {
      id: string;
      member_id: string;
      medication_name: string;
      dose: string | null;
      route: string | null;
      prn_instructions: string | null;
    }) => ({
      pofMedicationId: row.id,
      memberId: row.member_id,
      memberName: memberNameById.get(row.member_id) ?? "Member",
      medicationName: row.medication_name,
      dose: row.dose,
      route: row.route,
      prnInstructions: row.prn_instructions
    }))
    .sort((left, right) => {
      const memberSort = left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" });
      if (memberSort !== 0) return memberSort;
      return left.medicationName.localeCompare(right.medicationName, undefined, { sensitivity: "base" });
    });

  const memberIdsForPhotos = Array.from(new Set([...today.map((row) => row.memberId), ...overdueToday.map((row) => row.memberId)]));
  if (memberIdsForPhotos.length > 0) {
    const { data: photoRows, error: photoError } = await supabase
      .from("member_command_centers")
      .select("member_id, profile_image_url")
      .in("member_id", memberIdsForPhotos);
    if (photoError) throwMarSupabaseError(photoError, "member_command_centers");

    const photoByMemberId = toMemberPhotoLookup((photoRows ?? []) as MemberPhotoRow[]);
    today.forEach((row) => {
      row.memberPhotoUrl = photoByMemberId.get(row.memberId) ?? null;
    });
    overdueToday.forEach((row) => {
      row.memberPhotoUrl = photoByMemberId.get(row.memberId) ?? null;
    });
  }

  return {
    today,
    overdueToday,
    notGivenToday,
    history,
    prnLog,
    prnAwaitingOutcome,
    prnEffective,
    prnIneffective,
    prnMedicationOptions
  } satisfies MarWorkflowSnapshot;
}

export async function documentScheduledMarAdministration(input: {
  marScheduleId: string;
  status: "Given" | "Not Given";
  notGivenReason?: MarNotGivenReason | null;
  notes?: string | null;
  actor: {
    userId: string;
    fullName: string;
  };
  serviceRole?: boolean;
}) {
  const now = toEasternISO();
  const note = clean(input.notes);
  const reason =
    input.status === "Not Given" && MAR_NOT_GIVEN_REASON_OPTIONS.includes(input.notGivenReason as MarNotGivenReason)
      ? (input.notGivenReason as MarNotGivenReason)
      : null;

  if (input.status === "Not Given" && !reason) {
    throw new Error("Not Given reason is required.");
  }
  if (input.status === "Not Given" && reason === "Other" && !note) {
    throw new Error("A note is required when Not Given reason is Other.");
  }

  const supabase = await createClient({ serviceRole: input.serviceRole });
  const { data: scheduleRowData, error: scheduleError } = await supabase
    .from("mar_schedules")
    .select("id, member_id, pof_medication_id, medication_name, dose, route, scheduled_time, active, prn")
    .eq("id", input.marScheduleId)
    .maybeSingle();
  if (scheduleError) throwMarSupabaseError(scheduleError, "mar_schedules");
  if (!scheduleRowData) throw new Error("MAR schedule not found.");

  const scheduleRow = scheduleRowData as {
    id: string;
    member_id: string;
    pof_medication_id: string;
    medication_name: string;
    dose: string | null;
    route: string | null;
    scheduled_time: string;
    active: boolean | null;
    prn: boolean | null;
  };

  if (!scheduleRow.active) {
    throw new Error("The selected MAR schedule is no longer active.");
  }
  if (scheduleRow.prn) {
    throw new Error("Scheduled MAR documentation cannot be used for PRN medications.");
  }

  const { data: medicationData, error: medicationError } = await supabase
    .from("pof_medications")
    .select("id, active, given_at_center, prn, scheduled_times")
    .eq("id", scheduleRow.pof_medication_id)
    .maybeSingle();
  if (medicationError) throwMarSupabaseError(medicationError, "pof_medications");
  if (!medicationData) {
    throw new Error("The medication linked to this MAR schedule no longer exists.");
  }

  const medication = medicationData as {
    id: string;
    active: boolean | null;
    given_at_center: boolean | null;
    prn: boolean | null;
    scheduled_times: string[] | null;
  };

  if (!medication.active || !medication.given_at_center || medication.prn) {
    throw new Error("The linked medication is not an active center-administered scheduled medication.");
  }
  const normalizedScheduledTimes = normalizeScheduledTimes(medication.scheduled_times);
  if (normalizedScheduledTimes.length === 0) {
    throw new Error("The linked medication no longer has an active scheduled-dose configuration.");
  }

  const { data: existingAdministration, error: existingAdministrationError } = await supabase
    .from("mar_administrations")
    .select("id")
    .eq("mar_schedule_id", input.marScheduleId)
    .maybeSingle();
  if (existingAdministrationError) throwMarSupabaseError(existingAdministrationError, "mar_administrations");
  if (existingAdministration?.id) {
    throw new Error("This MAR dose has already been documented.");
  }

  const { data: inserted, error: insertError } = await supabase
    .from("mar_administrations")
    .insert({
      member_id: scheduleRow.member_id,
      pof_medication_id: scheduleRow.pof_medication_id,
      mar_schedule_id: scheduleRow.id,
      administration_date: toEasternDate(now),
      scheduled_time: scheduleRow.scheduled_time,
      medication_name: scheduleRow.medication_name,
      dose: scheduleRow.dose,
      route: scheduleRow.route,
      status: input.status,
      not_given_reason: input.status === "Not Given" ? reason : null,
      prn_reason: null,
      prn_outcome: null,
      prn_outcome_assessed_at: null,
      prn_followup_note: null,
      notes: note,
      administered_by: input.actor.fullName,
      administered_by_user_id: input.actor.userId,
      administered_at: now,
      source: "scheduled"
    })
    .select("id")
    .single();
  if (insertError) throwMarSupabaseError(insertError, "mar_administrations");
  if (!inserted?.id) throw new Error("Unable to save scheduled MAR administration.");
  await recordWorkflowEvent({
    eventType: "mar_administration_documented",
    entityType: "mar_administration",
    entityId: inserted.id as string,
    actorType: "user",
    actorUserId: input.actor.userId,
    status: input.status === "Given" ? "given" : "not_given",
    severity: "low",
    metadata: {
      member_id: scheduleRow.member_id,
      mar_schedule_id: scheduleRow.id,
      pof_medication_id: scheduleRow.pof_medication_id,
      scheduled_time: scheduleRow.scheduled_time,
      not_given_reason: reason
    }
  });
  try {
    await recordWorkflowMilestone({
      event: {
        event_type: "mar_administration_documented",
        entity_type: "mar_administration",
        entity_id: inserted.id as string,
        actor_type: "user",
        actor_id: input.actor.userId,
        actor_user_id: input.actor.userId,
        status: input.status === "Given" ? "given" : "not_given",
        severity: "low",
        metadata: {
          member_id: scheduleRow.member_id,
          mar_schedule_id: scheduleRow.id,
          pof_medication_id: scheduleRow.pof_medication_id,
          scheduled_time: scheduleRow.scheduled_time,
          not_given_reason: reason
        }
      }
    });
  } catch (error) {
    console.error("[mar-workflow] unable to emit scheduled MAR workflow milestone", error);
  }
  if (input.status === "Not Given") {
    try {
      await recordWorkflowMilestone({
        event: {
          eventType: "action_required",
          entityType: "mar_administration",
          entityId: inserted.id as string,
          actorType: "user",
          actorUserId: input.actor.userId,
          status: "open",
          severity: "high",
          metadata: {
            member_id: scheduleRow.member_id,
            mar_schedule_id: scheduleRow.id,
            pof_medication_id: scheduleRow.pof_medication_id,
            title: "MAR Dose Not Given",
            message: `${scheduleRow.medication_name} was documented as Not Given. Review the MAR entry and follow up on the reason.`,
            priority: "high",
            action_url: `/health/mar?memberId=${scheduleRow.member_id}`,
            not_given_reason: reason
          }
        }
      });
    } catch (error) {
      console.error("[mar-workflow] unable to emit MAR not-given notification", error);
    }
  }

  return {
    administrationId: inserted.id as string,
    memberId: scheduleRow.member_id,
    administeredAt: now
  };
}

export async function documentPrnMarAdministration(input: {
  pofMedicationId: string;
  prnReason: string;
  notes?: string | null;
  administeredAtIso?: string | null;
  submissionId?: string | null;
  actor: {
    userId: string;
    fullName: string;
  };
  serviceRole?: boolean;
}) {
  const administeredAt = input.administeredAtIso ? input.administeredAtIso : toEasternISO();
  const reason = clean(input.prnReason);
  if (!reason) throw new Error("PRN reason is required.");
  const idempotencyKey = buildPrnAdministrationIdempotencyKey({
    pofMedicationId: input.pofMedicationId,
    administeredAt,
    prnReason: reason,
    submissionId: input.submissionId ?? null
  });

  const supabase = await createClient({ serviceRole: input.serviceRole });
  const { data: medicationData, error: medicationError } = await supabase
    .from("pof_medications")
    .select("id, source_medication_id, member_id, medication_name, dose, route, active, given_at_center, prn")
    .eq("id", input.pofMedicationId)
    .maybeSingle();
  if (medicationError) throwMarSupabaseError(medicationError, "pof_medications");
  if (!medicationData) throw new Error("Selected PRN medication was not found.");

  const medication = medicationData as {
    id: string;
    source_medication_id: string | null;
    member_id: string;
    medication_name: string;
    dose: string | null;
    route: string | null;
    active: boolean;
    given_at_center: boolean;
    prn: boolean;
  };

  if (!medication.active || !medication.given_at_center || !medication.prn) {
    throw new Error("Selected medication is not an active center-administered PRN medication.");
  }
  if (!String(medication.source_medication_id ?? "").startsWith(MAR_MHP_SOURCE_PREFIX)) {
    throw new Error("Selected medication is not linked to the canonical MHP medication list.");
  }

  const { data: existingData, error: existingError } = await supabase
    .from("mar_administrations")
    .select("id")
    .eq("source", "prn")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingError) throwMarSupabaseError(existingError, "mar_administrations");
  if (existingData?.id) {
    return {
      administrationId: existingData.id as string,
      memberId: medication.member_id,
      administeredAt,
      pofMedicationId: medication.id,
      duplicateSafe: true
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("mar_administrations")
    .insert({
      member_id: medication.member_id,
      pof_medication_id: medication.id,
      mar_schedule_id: null,
      administration_date: toEasternDate(administeredAt),
      scheduled_time: null,
      medication_name: medication.medication_name,
      dose: medication.dose,
      route: medication.route,
      status: "Given",
      not_given_reason: null,
      prn_reason: reason,
      prn_outcome: null,
      prn_outcome_assessed_at: null,
      prn_followup_note: null,
      notes: clean(input.notes),
      administered_by: input.actor.fullName,
      administered_by_user_id: input.actor.userId,
      administered_at: administeredAt,
      source: "prn",
      idempotency_key: idempotencyKey
    })
    .select("id")
    .single();
  if (insertError) {
    const message = String(insertError.message ?? "").toLowerCase();
    if (
      insertError.code === "23505" ||
      message.includes("duplicate key") ||
      message.includes("idx_mar_administrations_prn_idempotency")
    ) {
      const { data: duplicateData, error: duplicateError } = await supabase
        .from("mar_administrations")
        .select("id")
        .eq("source", "prn")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (duplicateError) throwMarSupabaseError(duplicateError, "mar_administrations");
      if (duplicateData?.id) {
        return {
          administrationId: duplicateData.id as string,
          memberId: medication.member_id,
          administeredAt,
          pofMedicationId: medication.id,
          duplicateSafe: true
        };
      }
    }
    throwMarSupabaseError(insertError, "mar_administrations");
  }
  if (!inserted?.id) throw new Error("Unable to save PRN MAR administration.");
  await recordWorkflowEvent({
    eventType: "mar_administration_documented",
    entityType: "mar_administration",
    entityId: inserted.id as string,
    actorType: "user",
    actorUserId: input.actor.userId,
    status: "given",
    severity: "low",
    metadata: {
      member_id: medication.member_id,
      pof_medication_id: medication.id,
      source: "prn",
      prn_reason: reason
    }
  });
  try {
    await recordWorkflowMilestone({
      event: {
        event_type: "mar_administration_documented",
        entity_type: "mar_administration",
        entity_id: inserted.id as string,
        actor_type: "user",
        actor_id: input.actor.userId,
        actor_user_id: input.actor.userId,
        status: "given",
        severity: "low",
        metadata: {
          member_id: medication.member_id,
          pof_medication_id: medication.id,
          source: "prn",
          prn_reason: reason
        }
      }
    });
  } catch (error) {
    console.error("[mar-workflow] unable to emit PRN MAR workflow milestone", error);
  }

  return {
    administrationId: inserted.id as string,
    memberId: medication.member_id,
    administeredAt,
    pofMedicationId: medication.id,
    duplicateSafe: false
  };
}

export async function documentPrnOutcomeAssessment(input: {
  administrationId: string;
  prnOutcome: MarPrnOutcome;
  prnFollowupNote?: string | null;
  outcomeAssessedAtIso?: string | null;
  actor: {
    userId: string;
    fullName: string;
  };
  serviceRole?: boolean;
}) {
  const followupNote = clean(input.prnFollowupNote);
  if (input.prnOutcome === "Ineffective" && !followupNote) {
    throw new Error("Follow-up note is required when PRN outcome is Ineffective.");
  }

  const outcomeAssessedAt = input.outcomeAssessedAtIso ? input.outcomeAssessedAtIso : toEasternISO();
  const supabase = await createClient({ serviceRole: input.serviceRole });
  const { data: existingData, error: existingError } = await supabase
    .from("mar_administrations")
    .select("id, member_id, source, status")
    .eq("id", input.administrationId)
    .maybeSingle();
  if (existingError) throwMarSupabaseError(existingError, "mar_administrations");
  if (!existingData) throw new Error("PRN administration entry not found.");

  const existing = existingData as {
    id: string;
    member_id: string;
    source: "scheduled" | "prn";
    status: "Given" | "Not Given";
  };

  if (existing.source !== "prn" || existing.status !== "Given") {
    throw new Error("PRN outcome can only be documented for PRN administrations with status Given.");
  }

  const { data: updated, error: updateError } = await supabase
    .from("mar_administrations")
    .update({
      prn_outcome: input.prnOutcome,
      prn_outcome_assessed_at: outcomeAssessedAt,
      prn_followup_note: followupNote
    })
    .eq("id", input.administrationId)
    .select("id")
    .single();
  if (updateError) throwMarSupabaseError(updateError, "mar_administrations");
  if (!updated?.id) throw new Error("Unable to save PRN outcome documentation.");
  await recordWorkflowEvent({
    eventType: "mar_prn_outcome_documented",
    entityType: "mar_administration",
    entityId: updated.id as string,
    actorType: "user",
    actorUserId: input.actor.userId,
    status: input.prnOutcome.toLowerCase(),
    severity: input.prnOutcome === "Ineffective" ? "medium" : "low",
    metadata: {
      member_id: existing.member_id,
      prn_outcome: input.prnOutcome,
      prn_followup_note: followupNote
    }
  });
  if (input.prnOutcome === "Ineffective") {
    try {
      await recordWorkflowMilestone({
        event: {
          eventType: "action_required",
          entityType: "mar_administration",
          entityId: updated.id as string,
          actorType: "user",
          actorUserId: input.actor.userId,
          status: "open",
          severity: "high",
          metadata: {
            member_id: existing.member_id,
            title: "PRN Follow-up Needed",
            message: "A PRN medication was documented as ineffective. Review the member and complete follow-up now.",
            priority: "high",
            action_url: `/health/mar?memberId=${existing.member_id}`,
            prn_outcome: input.prnOutcome,
            prn_followup_note: followupNote
          }
        }
      });
    } catch (error) {
      console.error("[mar-workflow] unable to emit PRN ineffective notification", error);
    }
  }

  return {
    administrationId: updated.id as string,
    memberId: existing.member_id,
    outcomeAssessedAt
  };
}
