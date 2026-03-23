import "server-only";

import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";

export type MarWorkflowMemberOption = {
  memberId: string;
  memberName: string;
};

export type MarMonthlyReportMemberOption = {
  memberId: string;
  memberName: string;
  memberDob: string | null;
  memberIdentifier: string | null;
  memberStatus: string | null;
};

type MarMemberOptionRpcRow = {
  member_id: string;
  member_name: string | null;
  member_dob: string | null;
  member_identifier: string | null;
  member_status: string | null;
  active_for_workflow: boolean | null;
  eligible_for_report: boolean | null;
};

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toOptionalDate(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

async function loadMarMemberOptionRows(serviceRole: boolean) {
  const supabase = await createClient({ serviceRole });
  const rows = await invokeSupabaseRpcOrThrow<MarMemberOptionRpcRow[]>(
    supabase,
    "rpc_list_mar_monthly_report_member_options"
  );

  return (rows ?? []).map((row) => ({
    memberId: row.member_id,
    memberName: clean(row.member_name) ?? "Member",
    memberDob: toOptionalDate(row.member_dob),
    memberIdentifier: clean(row.member_identifier),
    memberStatus: clean(row.member_status),
    activeForWorkflow: Boolean(row.active_for_workflow),
    eligibleForReport: Boolean(row.eligible_for_report)
  }));
}

export async function getMarMemberOptionSets(options?: { serviceRole?: boolean }) {
  const serviceRole = options?.serviceRole ?? true;
  const rows = await loadMarMemberOptionRows(serviceRole);

  return {
    workflowOptions: rows
      .filter((row) => row.activeForWorkflow)
      .map((row) => ({
        memberId: row.memberId,
        memberName: row.memberName
      })) satisfies MarWorkflowMemberOption[],
    reportOptions: rows
      .filter((row) => row.eligibleForReport)
      .map((row) => ({
        memberId: row.memberId,
        memberName: row.memberName,
        memberDob: row.memberDob,
        memberIdentifier: row.memberIdentifier,
        memberStatus: row.memberStatus
      })) satisfies MarMonthlyReportMemberOption[]
  };
}

export async function listMarWorkflowMemberOptions(options?: { serviceRole?: boolean }) {
  return (await getMarMemberOptionSets(options)).workflowOptions;
}

export async function listMarMonthlyReportMemberOptions(options?: { serviceRole?: boolean }) {
  return (await getMarMemberOptionSets(options)).reportOptions;
}
