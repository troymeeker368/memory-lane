import {
  MHP_TABS,
  ensureMemberHealthProfileSupabase,
  getMemberHealthProfileDetailSupabase,
  getMemberHealthProfileIndexSupabase,
  type MhpTab
} from "@/lib/services/member-health-profiles-supabase";

export { MHP_TABS, type MhpTab };

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

export async function prefillMemberHealthProfileFromAssessment(_input: {
  memberId: string;
  assessmentId: string;
  actorUserId: string;
  actorName: string;
}) {
  throw new Error(
    "Prefill from assessment now requires Supabase intake-to-health-profile mapping. TODO schema dependency: public.intake_assessments + normalized MHP mapping table."
  );
}
