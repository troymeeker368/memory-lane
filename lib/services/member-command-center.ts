import {
  ensureMemberAttendanceScheduleSupabase,
  ensureMemberCommandCenterProfileSupabase,
  getAvailableLockerNumbersForMemberSupabase,
  getMemberCommandCenterDetailSupabase,
  getMemberCommandCenterIndexSupabase,
  updateMemberSupabase
} from "@/lib/services/member-command-center-supabase";

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

export async function prefillMemberCommandCenterFromAssessment(_input: {
  memberId: string;
  assessmentId: string;
  actorUserId: string;
  actorName: string;
}) {
  throw new Error(
    "Prefill from assessment now requires Supabase intake-to-command-center mapping. TODO schema dependency: public.intake_assessments + normalized field mapping table for MCC prefill."
  );
}

export async function updateMemberDobFromCommandCenter(memberId: string, dob: string | null) {
  return updateMemberSupabase(memberId, { dob: dob ?? null });
}

export async function updateMemberEnrollmentFromSchedule(memberId: string, enrollmentDate: string | null) {
  return updateMemberSupabase(memberId, { enrollment_date: enrollmentDate ?? null });
}
