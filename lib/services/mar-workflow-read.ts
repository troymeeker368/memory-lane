import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import type {
  MarAdministrationHistoryRow,
  MarPrnOption,
  MarTodayRow,
  MarWorkflowSnapshot
} from "@/lib/services/mar-shared";
import {
  getPrnHistorySnapshot,
  listActivePrnMedicationOptions,
  syncActivePrnMedicationOrders
} from "@/lib/services/mar-prn-workflow";
import { listMarWorkflowMemberOptions, type MarWorkflowMemberOption } from "@/lib/services/mar-member-options";
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
import { easternDateTimeLocalToISO, toEasternDate, toEasternISO } from "@/lib/timezone";

const MAR_MHP_SOURCE_PREFIX = "mhp-";
const MAR_RECONCILE_RPC = "rpc_reconcile_member_mar_state";
const MAR_RPC_MIGRATION = "0056_shared_rpc_orchestration_hardening.sql";
const MAR_TODAY_SELECT =
  "mar_schedule_id, member_id, member_name, pof_medication_id, medication_name, dose, route, frequency, instructions, prn, scheduled_time, administration_id, status, not_given_reason, prn_reason, notes, administered_by, administered_by_user_id, administered_at, source";
const MAR_HISTORY_SELECT =
  "id, member_id, member_name, pof_medication_id, mar_schedule_id, administration_date, scheduled_time, medication_name, dose, route, status, not_given_reason, prn_reason, prn_outcome, prn_outcome_assessed_at, prn_followup_note, notes, administered_by, administered_by_user_id, administered_at, source, created_at, updated_at";

type MarReconcileRpcRow = {
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

async function resolveMarMemberId(memberId: string, actionLabel: string, serviceRole?: boolean) {
  return resolveCanonicalMemberId(memberId, { actionLabel, serviceRole });
}

async function generateMarSchedulesForMemberRead(input: {
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

  if (memberIds.length === 0) return;

  await Promise.all(
    memberIds.map((memberId) =>
      generateMarSchedulesForMemberRead({
        memberId,
        startDate: today,
        endDate: today,
        serviceRole
      })
    )
  );
}

export async function refreshMarWorkflowData(options?: { serviceRole?: boolean }) {
  const serviceRole = options?.serviceRole ?? true;
  await syncTodayMarSchedules({ serviceRole });
  await syncActivePrnMedicationOrders({ serviceRole });
}

export async function getMarWorkflowSnapshot(options?: {
  serviceRole?: boolean;
  historyLimit?: number;
  prnLimit?: number;
  memberOptions?: MarWorkflowMemberOption[];
}) {
  const serviceRole = options?.serviceRole ?? true;

  const historyLimit = Math.max(10, Math.min(options?.historyLimit ?? 200, 500));
  const prnLimit = Math.max(10, Math.min(options?.prnLimit ?? 200, 500));
  const supabase = await createClient({ serviceRole });

  const [
    { data: todayRowsRaw, error: todayError },
    { data: overdueRowsRaw, error: overdueError },
    { data: notGivenRowsRaw, error: notGivenError },
    { data: historyRowsRaw, error: historyError }
  ] = await Promise.all([
    supabase.from("v_mar_today").select(MAR_TODAY_SELECT).order("scheduled_time", { ascending: true }),
    supabase.from("v_mar_overdue_today").select(MAR_TODAY_SELECT).order("scheduled_time", { ascending: true }),
    supabase.from("v_mar_not_given_today").select(MAR_HISTORY_SELECT).order("administered_at", { ascending: false }),
    supabase.from("v_mar_administration_history").select(MAR_HISTORY_SELECT).order("administered_at", { ascending: false }).limit(historyLimit)
  ]);

  if (todayError) throwMarSupabaseError(todayError, "v_mar_today");
  if (overdueError) throwMarSupabaseError(overdueError, "v_mar_overdue_today");
  if (notGivenError) throwMarSupabaseError(notGivenError, "v_mar_not_given_today");
  if (historyError) throwMarSupabaseError(historyError, "v_mar_administration_history");

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
  const prnSnapshot = await getPrnHistorySnapshot({ limit: prnLimit, serviceRole });
  const prnMedicationOptions: MarPrnOption[] = await listActivePrnMedicationOptions({ serviceRole });
  const scheduledHistory = history.filter((row) => row.source !== "prn");
  const mergedHistory = [...prnSnapshot.log, ...scheduledHistory]
    .sort((left, right) => new Date(right.administeredAt).getTime() - new Date(left.administeredAt).getTime())
    .slice(0, historyLimit);

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
    history: mergedHistory,
    prnLog: prnSnapshot.log,
    prnAwaitingOutcome: prnSnapshot.awaitingOutcome,
    prnEffective: prnSnapshot.effective,
    prnIneffective: prnSnapshot.ineffective,
    prnMedicationOptions,
    memberOptions: options?.memberOptions ?? (await listMarWorkflowMemberOptions({ serviceRole }))
  } satisfies MarWorkflowSnapshot;
}
