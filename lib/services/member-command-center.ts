import {
  ensureMemberAttendanceScheduleSupabase,
  ensureMemberCommandCenterProfileSupabase,
  getAvailableLockerNumbersForMemberSupabase,
  getMemberCommandCenterDetailSupabase,
  getMemberCommandCenterIndexSupabase,
  updateMemberCommandCenterProfileSupabase,
  updateMemberSupabase
} from "@/lib/services/member-command-center-supabase";
import { mapCodeStatusToDnr } from "@/lib/services/intake-pof-shared";
import { createClient } from "@/lib/supabase/server";
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

export async function ensureMemberCommandCenterProfile(memberId: string) {
  return ensureMemberCommandCenterProfileSupabase(memberId);
}

export async function ensureMemberAttendanceSchedule(memberId: string) {
  return ensureMemberAttendanceScheduleSupabase(memberId);
}

export async function getMemberCommandCenterIndex(filters?: { q?: string; status?: "all" | "active" | "inactive" }) {
  return getMemberCommandCenterIndexSupabase(filters);
}

export async function getMemberCommandCenterDetail(memberId: string) {
  return getMemberCommandCenterDetailSupabase(memberId);
}

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

function combineText(parts: Array<string | null | undefined>, separator = " | ") {
  const joined = parts
    .map((part) => clean(part))
    .filter((part): part is string => Boolean(part))
    .join(separator);
  return joined.length > 0 ? joined : null;
}

function toNullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function prefillMemberCommandCenterFromAssessment(input: {
  memberId: string;
  assessmentId: string;
  actorUserId: string;
  actorName: string;
}) {
  const supabase = await createClient();
  const { data: assessment, error } = await supabase
    .from("intake_assessments")
    .select(
      "id, member_id, assessment_date, signed_at, code_status, diet_type, diet_other, diet_restrictions_notes, incontinence_products, social_triggers, emotional_wellness_notes, transport_notes, notes, total_score, recommended_track, admission_review_required"
    )
    .eq("id", input.assessmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!assessment) throw new Error("Assessment not found.");
  if (String(assessment.member_id) !== input.memberId) {
    throw new Error("Assessment/member mismatch.");
  }

  const profile = await ensureMemberCommandCenterProfileSupabase(input.memberId, {
    actor: {
      userId: toNullableUuid(input.actorUserId),
      name: clean(input.actorName)
    }
  });
  const now = toEasternISO();

  const updatedProfile = await updateMemberCommandCenterProfileSupabase(profile.id, {
    source_assessment_id: input.assessmentId,
    source_assessment_at:
      clean(String(assessment.signed_at ?? "")) ??
      (clean(String(assessment.assessment_date ?? "")) ? `${String(assessment.assessment_date)}T12:00:00.000Z` : null),
    code_status: clean(String(assessment.code_status ?? "")),
    dnr: mapCodeStatusToDnr(clean(String(assessment.code_status ?? ""))),
    diet_type: clean(String(assessment.diet_type ?? "")),
    dietary_preferences_restrictions: combineText([
      String(assessment.diet_restrictions_notes ?? ""),
      String(assessment.diet_other ?? "")
    ]),
    swallowing_difficulty: clean(String(assessment.incontinence_products ?? "")),
    command_center_notes: combineText([
      String(assessment.transport_notes ?? ""),
      String(assessment.social_triggers ?? ""),
      String(assessment.emotional_wellness_notes ?? ""),
      String(assessment.notes ?? "")
    ]),
    updated_by_user_id: toNullableUuid(input.actorUserId),
    updated_by_name: clean(input.actorName),
    updated_at: now
  });

  await updateMemberSupabase(input.memberId, {
    latest_assessment_id: input.assessmentId,
    latest_assessment_date: clean(String(assessment.assessment_date ?? "")),
    latest_assessment_score: toNullableNumber(assessment.total_score),
    latest_assessment_track: clean(String(assessment.recommended_track ?? "")),
    latest_assessment_admission_review_required: Boolean(assessment.admission_review_required),
    code_status: clean(String(assessment.code_status ?? ""))
  });

  return updatedProfile;
}

export async function updateMemberDobFromCommandCenter(memberId: string, dob: string | null) {
  return updateMemberSupabase(memberId, { dob: dob ?? null });
}

export async function updateMemberEnrollmentFromSchedule(memberId: string, enrollmentDate: string | null) {
  return updateMemberSupabase(memberId, { enrollment_date: enrollmentDate ?? null });
}
