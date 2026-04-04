import {
  backfillMissingMemberCommandCenterRowsSupabase,
  deleteMemberContactSupabase,
  getRequiredMemberAttendanceScheduleSupabase,
  getRequiredMemberCommandCenterProfileSupabase,
  upsertMemberContactSupabase,
  updateMemberSupabase
} from "@/lib/services/member-command-center-write";
import {
  getAvailableLockerNumbersForMemberSupabase,
  getMemberCommandCenterDetailSupabase,
  getMemberCommandCenterIndexSupabase
} from "@/lib/services/member-command-center-read";
import { createClient } from "@/lib/supabase/server";
import { mutateMemberAllergyWorkflow } from "@/lib/services/member-health-profiles";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { toEasternISO } from "@/lib/timezone";

export function calculateAgeYears(dob: string | null) {
  if (!dob) return null;
  const parsedDob = new Date(`${dob}T00:00:00.000`);
  if (Number.isNaN(parsedDob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - parsedDob.getFullYear();
  const monthDelta = now.getMonth() - parsedDob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < parsedDob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

export function calculateMonthsEnrolled(enrollmentDate: string | null) {
  if (!enrollmentDate) return null;
  const parsedEnrollmentDate = new Date(`${enrollmentDate}T00:00:00.000`);
  if (Number.isNaN(parsedEnrollmentDate.getTime())) return null;
  const now = new Date();
  const years = now.getFullYear() - parsedEnrollmentDate.getFullYear();
  const months = now.getMonth() - parsedEnrollmentDate.getMonth();
  const totalMonths = years * 12 + months - (now.getDate() < parsedEnrollmentDate.getDate() ? 1 : 0);
  return totalMonths >= 0 ? totalMonths : null;
}

export async function getAvailableLockerNumbersForMember(memberId: string) {
  return getAvailableLockerNumbersForMemberSupabase(memberId);
}

export async function getRequiredMemberCommandCenterProfile(memberId: string) {
  return getRequiredMemberCommandCenterProfileSupabase(memberId);
}

export async function getRequiredMemberAttendanceSchedule(memberId: string) {
  return getRequiredMemberAttendanceScheduleSupabase(memberId);
}

export async function getMemberCommandCenterIndex(filters?: { q?: string; status?: "all" | "active" | "inactive" }) {
  return getMemberCommandCenterIndexSupabase(filters);
}

export async function getMemberCommandCenterDetail(memberId: string) {
  return getMemberCommandCenterDetailSupabase(memberId);
}

export async function backfillMissingMemberCommandCenterRows(memberIds: Array<string | null | undefined>) {
  return backfillMissingMemberCommandCenterRowsSupabase(memberIds);
}

const PREFILL_MEMBER_COMMAND_CENTER_RPC = "rpc_prefill_member_command_center_from_assessment";
const MEMBER_COMMAND_CENTER_RPC_MIGRATION = "0056_shared_rpc_orchestration_hardening.sql";
const UPDATE_MEMBER_COMMAND_CENTER_BUNDLE_RPC = "rpc_update_member_command_center_bundle";
const SAVE_MEMBER_COMMAND_CENTER_ATTENDANCE_BILLING_RPC = "rpc_save_member_command_center_attendance_billing";
const SAVE_MEMBER_COMMAND_CENTER_TRANSPORTATION_RPC = "rpc_save_member_command_center_transportation";
const MEMBER_COMMAND_CENTER_WORKFLOW_RPC_MIGRATION = "0057_mcc_mhp_workflow_rpc_hardening.sql";

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toNullableUuid(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

export async function prefillMemberCommandCenterFromAssessment(input: {
  memberId: string;
  assessmentId: string;
  actorUserId: string;
  actorName: string;
}) {
  await getRequiredMemberCommandCenterProfileSupabase(input.memberId);
  const supabase = await createClient();
  try {
    await invokeSupabaseRpcOrThrow<unknown>(supabase, PREFILL_MEMBER_COMMAND_CENTER_RPC, {
      p_member_id: input.memberId,
      p_assessment_id: input.assessmentId,
      p_actor_user_id: toNullableUuid(input.actorUserId),
      p_actor_name: clean(input.actorName),
      p_now: toEasternISO()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prefill Member Command Center from assessment.";
    if (message.includes(PREFILL_MEMBER_COMMAND_CENTER_RPC)) {
      throw new Error(
        `Member Command Center prefill RPC is not available. Apply Supabase migration ${MEMBER_COMMAND_CENTER_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }

  return getRequiredMemberCommandCenterProfileSupabase(input.memberId);
}

export async function saveMemberCommandCenterBundle(input: {
  memberId: string;
  mccPatch: Record<string, unknown>;
  memberPatch?: Record<string, unknown>;
  actor: { id: string; fullName: string };
  now?: string;
}) {
  await getRequiredMemberCommandCenterProfileSupabase(input.memberId);
  const supabase = await createClient();
  try {
    await invokeSupabaseRpcOrThrow<unknown>(supabase, UPDATE_MEMBER_COMMAND_CENTER_BUNDLE_RPC, {
      p_member_id: input.memberId,
      p_mcc_patch: input.mccPatch,
      p_member_patch: input.memberPatch ?? {},
      p_actor_user_id: toNullableUuid(input.actor.id),
      p_actor_name: clean(input.actor.fullName),
      p_now: input.now ?? toEasternISO()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save Member Command Center bundle.";
    if (message.includes(UPDATE_MEMBER_COMMAND_CENTER_BUNDLE_RPC)) {
      throw new Error(
        `Member Command Center workflow RPC is not available. Apply Supabase migration ${MEMBER_COMMAND_CENTER_WORKFLOW_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function saveMemberCommandCenterAttendanceBillingWorkflow(input: {
  memberId: string;
  schedulePatch: Record<string, unknown>;
  memberPatch?: Record<string, unknown>;
  billingPayload: Record<string, unknown>;
  templatePayload: Record<string, unknown>;
  actor: { id: string; fullName: string };
  now?: string;
}) {
  await getRequiredMemberAttendanceScheduleSupabase(input.memberId);
  const supabase = await createClient();
  try {
    await invokeSupabaseRpcOrThrow<unknown>(supabase, SAVE_MEMBER_COMMAND_CENTER_ATTENDANCE_BILLING_RPC, {
      p_member_id: input.memberId,
      p_schedule_patch: input.schedulePatch,
      p_member_patch: input.memberPatch ?? {},
      p_billing_payload: input.billingPayload,
      p_template_payload: input.templatePayload,
      p_actor_user_id: toNullableUuid(input.actor.id),
      p_actor_name: clean(input.actor.fullName),
      p_now: input.now ?? toEasternISO()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save attendance billing workflow.";
    if (message.includes(SAVE_MEMBER_COMMAND_CENTER_ATTENDANCE_BILLING_RPC)) {
      throw new Error(
        `Member Command Center attendance workflow RPC is not available. Apply Supabase migration ${MEMBER_COMMAND_CENTER_WORKFLOW_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function saveMemberCommandCenterTransportationWorkflow(input: {
  memberId: string;
  schedulePatch: Record<string, unknown>;
  busStopNames: string[];
  actor: { id: string; fullName: string };
  now?: string;
}) {
  await getRequiredMemberAttendanceScheduleSupabase(input.memberId);
  const supabase = await createClient();
  try {
    await invokeSupabaseRpcOrThrow<unknown>(supabase, SAVE_MEMBER_COMMAND_CENTER_TRANSPORTATION_RPC, {
      p_member_id: input.memberId,
      p_schedule_patch: input.schedulePatch,
      p_bus_stop_names: input.busStopNames,
      p_actor_user_id: toNullableUuid(input.actor.id),
      p_actor_name: clean(input.actor.fullName),
      p_now: input.now ?? toEasternISO()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save transportation workflow.";
    if (message.includes(SAVE_MEMBER_COMMAND_CENTER_TRANSPORTATION_RPC)) {
      throw new Error(
        `Member Command Center transportation workflow RPC is not available. Apply Supabase migration ${MEMBER_COMMAND_CENTER_WORKFLOW_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function updateMemberDobFromCommandCenter(memberId: string, dob: string | null) {
  return updateMemberSupabase(memberId, { dob: dob ?? null });
}

export async function updateMemberEnrollmentFromSchedule(memberId: string, enrollmentDate: string | null) {
  return updateMemberSupabase(memberId, { enrollment_date: enrollmentDate ?? null });
}

export async function mutateMemberCommandCenterAllergyWorkflow(input: {
  memberId: string;
  operation: "create" | "update" | "delete";
  allergyId?: string | null;
  payload?: Record<string, unknown>;
  actor: { id: string; fullName: string };
  now?: string;
}) {
  const result = await mutateMemberAllergyWorkflow({
    memberId: input.memberId,
    operation: input.operation,
    allergyId: input.allergyId,
    payload: input.payload ?? {},
    actor: input.actor,
    now: input.now
  });
  return result.entity_row;
}

export async function saveMemberCommandCenterContact(input: {
  id?: string;
  memberId: string;
  contactName: string;
  relationshipToMember?: string | null;
  category: string;
  categoryOther?: string | null;
  email?: string | null;
  cellularNumber?: string | null;
  workNumber?: string | null;
  homeNumber?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  isPayor?: boolean;
  actor: { id: string; fullName: string };
  now?: string;
}) {
  const timestamp = input.now ?? toEasternISO();
  return upsertMemberContactSupabase({
    id: clean(input.id) ?? undefined,
    member_id: input.memberId,
    contact_name: input.contactName,
    relationship_to_member: clean(input.relationshipToMember) ?? null,
    category: input.category,
    category_other: clean(input.categoryOther) ?? null,
    email: clean(input.email)?.toLowerCase() ?? null,
    cellular_number: clean(input.cellularNumber) ?? null,
    work_number: clean(input.workNumber) ?? null,
    home_number: clean(input.homeNumber) ?? null,
    street_address: clean(input.streetAddress) ?? null,
    city: clean(input.city) ?? null,
    state: clean(input.state) ?? null,
    zip: clean(input.zip) ?? null,
    is_payor: input.isPayor === true,
    created_by_user_id: input.actor.id,
    created_by_name: input.actor.fullName,
    created_at: timestamp,
    updated_at: timestamp
  });
}

export async function deleteMemberCommandCenterContact(input: { id: string }) {
  return deleteMemberContactSupabase(input.id);
}
