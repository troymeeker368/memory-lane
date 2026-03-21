import {
  MHP_TABS,
  backfillMissingMemberHealthProfilesSupabase,
  ensureMemberHealthProfileSupabase,
  type MhpTab
} from "@/lib/services/member-health-profiles-supabase";
import {
  getMemberHealthProfileDetailSupabase,
  getMemberHealthProfileIndexSupabase
} from "@/lib/services/member-health-profiles-read";
import { mapCodeStatusToDnr } from "@/lib/services/intake-pof-shared";
import { updateMemberHealthProfileByMemberIdSupabase } from "@/lib/services/member-health-profiles-write-supabase";
import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { toEasternISO } from "@/lib/timezone";

export { MHP_TABS, type MhpTab };

const UPDATE_MEMBER_HEALTH_PROFILE_BUNDLE_RPC = "rpc_update_member_health_profile_bundle";
const UPDATE_MEMBER_TRACK_WITH_NOTE_RPC = "rpc_update_member_track_with_note";
const MUTATE_MEMBER_DIAGNOSIS_WORKFLOW_RPC = "rpc_mutate_member_diagnosis_workflow";
const MUTATE_MEMBER_MEDICATION_WORKFLOW_RPC = "rpc_mutate_member_medication_workflow";
const MUTATE_MEMBER_ALLERGY_WORKFLOW_RPC = "rpc_mutate_member_allergy_workflow";
const MUTATE_MEMBER_PROVIDER_WORKFLOW_RPC = "rpc_mutate_member_provider_workflow";
const MUTATE_MEMBER_EQUIPMENT_WORKFLOW_RPC = "rpc_mutate_member_equipment_workflow";
const MUTATE_MEMBER_NOTE_WORKFLOW_RPC = "rpc_mutate_member_note_workflow";
const MEMBER_HEALTH_PROFILE_WORKFLOW_RPC_MIGRATION = "0057_mcc_mhp_workflow_rpc_hardening.sql";

export async function ensureMemberHealthProfile(memberId: string) {
  return ensureMemberHealthProfileSupabase(memberId);
}

export async function getMemberHealthProfileIndex(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
}) {
  return getMemberHealthProfileIndexSupabase(filters);
}

export async function getMemberHealthProfileDetail(memberId: string) {
  return getMemberHealthProfileDetailSupabase(memberId);
}

export async function backfillMissingMemberHealthProfiles(memberIds: Array<string | null | undefined>) {
  return backfillMissingMemberHealthProfilesSupabase(memberIds);
}

function isMissingRpcFunctionError(error: unknown, rpcName: string) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "").toUpperCase();
  const text = String((error as { message?: string }).message ?? "").toLowerCase();
  return (code === "PGRST202" || code === "42883") && text.includes(rpcName.toLowerCase());
}

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeBinaryGender(value: unknown) {
  const normalized = clean(typeof value === "string" ? value : null)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === "m" || normalized === "male") return "M";
  if (normalized === "f" || normalized === "female") return "F";
  return null;
}

function toNullableUuid(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function requireWorkflowRpcRow<T>(rpcName: string, row: T | null | undefined): T {
  if (row != null) return row;
  throw new Error(
    `Member Health Profile workflow RPC ${rpcName} returned no result row. Refusing fabricated fallback result.`
  );
}

function combineText(parts: Array<string | null | undefined>, separator = " | ") {
  const joined = parts
    .map((part) => clean(part))
    .filter((part): part is string => Boolean(part))
    .join(separator);
  return joined.length > 0 ? joined : null;
}

export async function prefillMemberHealthProfileFromAssessment(input: {
  memberId: string;
  assessmentId: string;
  actorUserId: string;
  actorName: string;
}) {
  const supabase = await createClient();
  const { data: assessment, error } = await supabase
    .from("intake_assessments")
    .select(
      "id, member_id, assessment_date, code_status, diet_type, diet_other, diet_restrictions_notes, mobility_aids, assistive_devices, incontinence_products, emotional_wellness_notes, social_triggers, orientation_notes, health_lately, joy_sparks, notes, personal_notes, falls_history, signed_at"
    )
    .eq("id", input.assessmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!assessment) throw new Error("Assessment not found.");
  if (String(assessment.member_id) !== input.memberId) {
    throw new Error("Assessment/member mismatch.");
  }

  const sourceAssessmentAt =
    clean(String(assessment.signed_at ?? "")) ??
    (clean(String(assessment.assessment_date ?? "")) ? `${String(assessment.assessment_date)}T12:00:00.000Z` : null) ??
    toEasternISO();

  return updateMemberHealthProfileByMemberIdSupabase({
    memberId: input.memberId,
    patch: {
      source_assessment_id: input.assessmentId,
      source_assessment_at: sourceAssessmentAt,
      code_status: clean(String(assessment.code_status ?? "")),
      dnr: mapCodeStatusToDnr(clean(String(assessment.code_status ?? ""))),
      diet_type: clean(String(assessment.diet_type ?? "")),
      dietary_restrictions: combineText([
        String(assessment.diet_restrictions_notes ?? ""),
        String(assessment.diet_other ?? "")
      ]),
      mobility_aids: combineText([
        String(assessment.mobility_aids ?? ""),
        String(assessment.assistive_devices ?? "")
      ], ", "),
      incontinence_products: clean(String(assessment.incontinence_products ?? "")),
      falls_history: clean(String(assessment.falls_history ?? "")),
      mental_health_history: combineText([
        String(assessment.emotional_wellness_notes ?? ""),
        String(assessment.social_triggers ?? "")
      ]),
      communication_style: clean(String(assessment.orientation_notes ?? "")),
      physical_health_problems: clean(String(assessment.health_lately ?? "")),
      joy_sparks: combineText([String(assessment.joy_sparks ?? ""), String(assessment.personal_notes ?? "")]),
      intake_notes: clean(String(assessment.notes ?? "")),
      important_alerts: combineText([
        String(assessment.health_lately ?? ""),
        String(assessment.notes ?? "")
      ]),
      updated_by_user_id: toNullableUuid(input.actorUserId),
      updated_by_name: clean(input.actorName),
      updated_at: toEasternISO()
    }
  });
}

export async function saveMemberHealthProfileBundle(input: {
  memberId: string;
  mhpPatch: Record<string, unknown>;
  memberPatch?: Record<string, unknown>;
  actor: { id: string; fullName: string };
  now?: string;
  syncToCommandCenter?: boolean;
  hospitalName?: string | null;
}) {
  const supabase = await createClient();
  const normalizedMhpPatch =
    Object.prototype.hasOwnProperty.call(input.mhpPatch, "gender")
      ? {
          ...input.mhpPatch,
          gender: normalizeBinaryGender(input.mhpPatch.gender)
        }
      : input.mhpPatch;
  try {
    await invokeSupabaseRpcOrThrow<unknown>(supabase, UPDATE_MEMBER_HEALTH_PROFILE_BUNDLE_RPC, {
      p_member_id: input.memberId,
      p_mhp_patch: normalizedMhpPatch,
      p_member_patch: input.memberPatch ?? {},
      p_actor_user_id: toNullableUuid(input.actor.id),
      p_actor_name: clean(input.actor.fullName),
      p_now: input.now ?? toEasternISO(),
      p_sync_to_mcc: input.syncToCommandCenter ?? true,
      p_hospital_name: clean(input.hospitalName)
    });
  } catch (error) {
    if (isMissingRpcFunctionError(error, UPDATE_MEMBER_HEALTH_PROFILE_BUNDLE_RPC)) {
      throw new Error(
        `Member Health Profile workflow RPC is not available. Apply Supabase migration ${MEMBER_HEALTH_PROFILE_WORKFLOW_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function updateMemberTrackWithCarePlanNote(input: {
  memberId: string;
  track: "Track 1" | "Track 2" | "Track 3";
  actor: { id: string; fullName: string };
  now?: string;
}) {
  const supabase = await createClient();
  try {
    const [result] = await invokeSupabaseRpcOrThrow<Array<{ changed: boolean; member_note_id: string | null }>>(
      supabase,
      UPDATE_MEMBER_TRACK_WITH_NOTE_RPC,
      {
        p_member_id: input.memberId,
        p_track: input.track,
        p_actor_user_id: toNullableUuid(input.actor.id),
        p_actor_name: clean(input.actor.fullName),
        p_now: input.now ?? toEasternISO()
      }
    );
    return requireWorkflowRpcRow(UPDATE_MEMBER_TRACK_WITH_NOTE_RPC, result);
  } catch (error) {
    if (isMissingRpcFunctionError(error, UPDATE_MEMBER_TRACK_WITH_NOTE_RPC)) {
      throw new Error(
        `Member Health Profile track workflow RPC is not available. Apply Supabase migration ${MEMBER_HEALTH_PROFILE_WORKFLOW_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

type WorkflowMutationResult = {
  entity_row: Record<string, unknown> | null;
  changed: boolean;
};

type MedicationWorkflowMutationResult = WorkflowMutationResult & {
  anchor_physician_order_id: string | null;
  synced_medications: number | null;
  inserted_schedules: number | null;
  patched_schedules: number | null;
  reactivated_schedules: number | null;
  deactivated_schedules: number | null;
};

export async function mutateMemberDiagnosisWorkflow(input: {
  memberId: string;
  operation: "create" | "update" | "delete";
  diagnosisId?: string | null;
  payload?: Record<string, unknown>;
  actor: { id: string; fullName: string };
  now?: string;
}) {
  const supabase = await createClient();
  try {
    const [result] = await invokeSupabaseRpcOrThrow<WorkflowMutationResult[]>(supabase, MUTATE_MEMBER_DIAGNOSIS_WORKFLOW_RPC, {
      p_member_id: input.memberId,
      p_operation: input.operation,
      p_diagnosis_id: clean(input.diagnosisId),
      p_payload: input.payload ?? {},
      p_actor_user_id: toNullableUuid(input.actor.id),
      p_actor_name: clean(input.actor.fullName),
      p_now: input.now ?? toEasternISO()
    });
    return requireWorkflowRpcRow(MUTATE_MEMBER_DIAGNOSIS_WORKFLOW_RPC, result);
  } catch (error) {
    if (isMissingRpcFunctionError(error, MUTATE_MEMBER_DIAGNOSIS_WORKFLOW_RPC)) {
      throw new Error(
        `Member Health Profile child workflow RPCs are not available. Apply Supabase migration 0058_mhp_child_workflow_rpc_hardening.sql and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function mutateMemberMedicationWorkflow(input: {
  memberId: string;
  operation: "create" | "update" | "delete" | "inactivate" | "reactivate";
  medicationId?: string | null;
  payload?: Record<string, unknown>;
  actor: { id: string; fullName: string };
  now?: string;
  marStartDate?: string | null;
  marEndDate?: string | null;
}) {
  const supabase = await createClient();
  try {
    const [result] = await invokeSupabaseRpcOrThrow<MedicationWorkflowMutationResult[]>(
      supabase,
      MUTATE_MEMBER_MEDICATION_WORKFLOW_RPC,
      {
        p_member_id: input.memberId,
        p_operation: input.operation,
        p_medication_id: clean(input.medicationId),
        p_payload: input.payload ?? {},
        p_actor_user_id: toNullableUuid(input.actor.id),
        p_actor_name: clean(input.actor.fullName),
        p_now: input.now ?? toEasternISO(),
        p_mar_start_date: clean(input.marStartDate),
        p_mar_end_date: clean(input.marEndDate)
      }
    );
    return requireWorkflowRpcRow(MUTATE_MEMBER_MEDICATION_WORKFLOW_RPC, result);
  } catch (error) {
    if (isMissingRpcFunctionError(error, MUTATE_MEMBER_MEDICATION_WORKFLOW_RPC)) {
      throw new Error(
        `Member Health Profile child workflow RPCs are not available. Apply Supabase migration 0058_mhp_child_workflow_rpc_hardening.sql and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function mutateMemberAllergyWorkflow(input: {
  memberId: string;
  operation: "create" | "update" | "delete";
  allergyId?: string | null;
  payload?: Record<string, unknown>;
  actor: { id: string; fullName: string };
  now?: string;
}) {
  const supabase = await createClient();
  try {
    const [result] = await invokeSupabaseRpcOrThrow<WorkflowMutationResult[]>(supabase, MUTATE_MEMBER_ALLERGY_WORKFLOW_RPC, {
      p_member_id: input.memberId,
      p_operation: input.operation,
      p_allergy_id: clean(input.allergyId),
      p_payload: input.payload ?? {},
      p_actor_user_id: toNullableUuid(input.actor.id),
      p_actor_name: clean(input.actor.fullName),
      p_now: input.now ?? toEasternISO()
    });
    return requireWorkflowRpcRow(MUTATE_MEMBER_ALLERGY_WORKFLOW_RPC, result);
  } catch (error) {
    if (isMissingRpcFunctionError(error, MUTATE_MEMBER_ALLERGY_WORKFLOW_RPC)) {
      throw new Error(
        `Member Health Profile child workflow RPCs are not available. Apply Supabase migration 0058_mhp_child_workflow_rpc_hardening.sql and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function mutateMemberProviderWorkflow(input: {
  memberId: string;
  operation: "create" | "update" | "delete";
  providerId?: string | null;
  payload?: Record<string, unknown>;
  actor: { id: string; fullName: string };
  now?: string;
}) {
  const supabase = await createClient();
  try {
    const [result] = await invokeSupabaseRpcOrThrow<WorkflowMutationResult[]>(supabase, MUTATE_MEMBER_PROVIDER_WORKFLOW_RPC, {
      p_member_id: input.memberId,
      p_operation: input.operation,
      p_provider_id: clean(input.providerId),
      p_payload: input.payload ?? {},
      p_actor_user_id: toNullableUuid(input.actor.id),
      p_actor_name: clean(input.actor.fullName),
      p_now: input.now ?? toEasternISO()
    });
    return requireWorkflowRpcRow(MUTATE_MEMBER_PROVIDER_WORKFLOW_RPC, result);
  } catch (error) {
    if (isMissingRpcFunctionError(error, MUTATE_MEMBER_PROVIDER_WORKFLOW_RPC)) {
      throw new Error(
        `Member Health Profile child workflow RPCs are not available. Apply Supabase migration 0058_mhp_child_workflow_rpc_hardening.sql and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function mutateMemberEquipmentWorkflow(input: {
  memberId: string;
  operation: "create" | "update" | "delete";
  equipmentId?: string | null;
  payload?: Record<string, unknown>;
  actor: { id: string; fullName: string };
  now?: string;
}) {
  const supabase = await createClient();
  try {
    const [result] = await invokeSupabaseRpcOrThrow<WorkflowMutationResult[]>(
      supabase,
      MUTATE_MEMBER_EQUIPMENT_WORKFLOW_RPC,
      {
        p_member_id: input.memberId,
        p_operation: input.operation,
        p_equipment_id: clean(input.equipmentId),
        p_payload: input.payload ?? {},
        p_actor_user_id: toNullableUuid(input.actor.id),
        p_actor_name: clean(input.actor.fullName),
        p_now: input.now ?? toEasternISO()
      }
    );
    return requireWorkflowRpcRow(MUTATE_MEMBER_EQUIPMENT_WORKFLOW_RPC, result);
  } catch (error) {
    if (isMissingRpcFunctionError(error, MUTATE_MEMBER_EQUIPMENT_WORKFLOW_RPC)) {
      throw new Error(
        `Member Health Profile equipment/note workflow RPCs are not available. Apply Supabase migration 0059_mhp_equipment_notes_rpc_hardening.sql and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function mutateMemberNoteWorkflow(input: {
  memberId: string;
  operation: "create" | "update" | "delete";
  noteId?: string | null;
  payload?: Record<string, unknown>;
  actor: { id: string; fullName: string };
  now?: string;
}) {
  const supabase = await createClient();
  try {
    const [result] = await invokeSupabaseRpcOrThrow<WorkflowMutationResult[]>(supabase, MUTATE_MEMBER_NOTE_WORKFLOW_RPC, {
      p_member_id: input.memberId,
      p_operation: input.operation,
      p_note_id: clean(input.noteId),
      p_payload: input.payload ?? {},
      p_actor_user_id: toNullableUuid(input.actor.id),
      p_actor_name: clean(input.actor.fullName),
      p_now: input.now ?? toEasternISO()
    });
    return requireWorkflowRpcRow(MUTATE_MEMBER_NOTE_WORKFLOW_RPC, result);
  } catch (error) {
    if (isMissingRpcFunctionError(error, MUTATE_MEMBER_NOTE_WORKFLOW_RPC)) {
      throw new Error(
        `Member Health Profile equipment/note workflow RPCs are not available. Apply Supabase migration 0059_mhp_equipment_notes_rpc_hardening.sql and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}
