import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import {
  createPrnMedicationOrderAndAdministration,
  documentPrnFollowupAssessment,
  documentPrnMedicationAdministration,
} from "@/lib/services/mar-prn-workflow";
import {
  MAR_NOT_GIVEN_REASON_OPTIONS,
  MAR_PRN_OUTCOME_OPTIONS,
  type MarNotGivenReason,
  type MarPrnOutcome,
} from "@/lib/services/mar-shared";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import {
  clean,
  normalizeGenerationWindow,
  normalizeScheduledTimes,
  throwMarSupabaseError,
} from "@/lib/services/mar-workflow-core";
import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export { MAR_NOT_GIVEN_REASON_OPTIONS, MAR_PRN_OUTCOME_OPTIONS };
export type {
  MarNotGivenReason,
  MarPrnOutcome,
};

type PhysicianOrderForSyncRow = {
  id: string;
  member_id: string;
  status: string;
};
const MAR_MEDICATION_SYNC_RPC = "rpc_sync_mar_medications_from_member_profile";
const MAR_RECONCILE_RPC = "rpc_reconcile_member_mar_state";
const MAR_RPC_MIGRATION = "0056_shared_rpc_orchestration_hardening.sql";

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

async function resolveMarMemberId(memberId: string, actionLabel: string, serviceRole?: boolean) {
  return resolveCanonicalMemberId(memberId, { actionLabel, serviceRole });
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
  medicationOrderId: string;
  indication: string;
  status: "Given" | "Refused" | "Held" | "Omitted";
  doseGiven?: string | null;
  routeGiven?: string | null;
  symptomScoreBefore?: number | null;
  followupDueAtIso?: string | null;
  notes?: string | null;
  administeredAtIso?: string | null;
  submissionId?: string | null;
  actor: {
    userId: string;
    fullName: string;
  };
  serviceRole?: boolean;
}) {
  return documentPrnMedicationAdministration({
    medicationOrderId: input.medicationOrderId,
    indication: input.indication,
    status: input.status,
    doseGiven: input.doseGiven,
    routeGiven: input.routeGiven,
    symptomScoreBefore: input.symptomScoreBefore,
    followupDueAtIso: input.followupDueAtIso,
    notes: input.notes,
    administeredAtIso: input.administeredAtIso,
    submissionId: input.submissionId,
    actor: input.actor,
    serviceRole: input.serviceRole,
  });
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
  return documentPrnFollowupAssessment({
    administrationId: input.administrationId,
    prnOutcome: input.prnOutcome,
    prnFollowupNote: input.prnFollowupNote,
    outcomeAssessedAtIso: input.outcomeAssessedAtIso,
    actor: input.actor,
    serviceRole: input.serviceRole,
  });
}

export async function createPrnOrderAndAdministration(input: Parameters<typeof createPrnMedicationOrderAndAdministration>[0]) {
  return createPrnMedicationOrderAndAdministration(input);
}
