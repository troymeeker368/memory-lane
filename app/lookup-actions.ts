"use server";

import { requireModuleAccess, requirePhysicianOrdersAccess } from "@/lib/auth";
import { searchUnscheduledAttendanceMemberOptions } from "@/lib/services/attendance";
import { requireCarePlanAuthorizedUser } from "@/lib/services/care-plan-authorization";
import { listEnrollmentPacketEligibleLeadPicker, listSalesLeadPickerOptions } from "@/lib/services/leads-read";
import { listMemberPickerOptionsSupabase } from "@/lib/services/shared-lookups-supabase";

type MemberLookupRequest = {
  q?: string;
  selectedId?: string | null;
  limit?: number;
};

export async function searchDocumentationMembersAction(input: MemberLookupRequest) {
  await requireModuleAccess("documentation");
  return listMemberPickerOptionsSupabase({
    q: input.q,
    selectedId: input.selectedId,
    status: "active",
    limit: input.limit ?? 25
  });
}

export async function searchHealthMembersAction(input: MemberLookupRequest) {
  await requireModuleAccess("health");
  return listMemberPickerOptionsSupabase({
    q: input.q,
    selectedId: input.selectedId,
    status: "active",
    limit: input.limit ?? 25
  });
}

export async function searchCarePlanMembersAction(input: MemberLookupRequest) {
  await requireCarePlanAuthorizedUser();
  return listMemberPickerOptionsSupabase({
    q: input.q,
    selectedId: input.selectedId,
    status: "active",
    limit: input.limit ?? 25
  });
}

export async function searchPhysicianOrderMembersAction(input: MemberLookupRequest) {
  await requirePhysicianOrdersAccess();
  return listMemberPickerOptionsSupabase({
    q: input.q,
    selectedId: input.selectedId,
    status: "active",
    limit: input.limit ?? 25
  });
}

export async function searchReportMembersAction(input: MemberLookupRequest) {
  await requireModuleAccess("reports");
  return listMemberPickerOptionsSupabase({
    q: input.q,
    selectedId: input.selectedId,
    status: "active",
    limit: input.limit ?? 25
  });
}

export async function searchAncillaryMembersAction(input: MemberLookupRequest) {
  await requireModuleAccess("ancillary");
  return listMemberPickerOptionsSupabase({
    q: input.q,
    selectedId: input.selectedId,
    status: "active",
    limit: input.limit ?? 25
  });
}

export async function searchEnrollmentPacketEligibleLeadsAction(input: MemberLookupRequest) {
  await requireModuleAccess("sales");
  return listEnrollmentPacketEligibleLeadPicker({
    q: input.q,
    selectedId: input.selectedId,
    limit: input.limit ?? 25
  });
}

export async function searchSalesLeadsAction(input: MemberLookupRequest) {
  await requireModuleAccess("sales");
  return listSalesLeadPickerOptions({
    q: input.q,
    selectedId: input.selectedId,
    limit: input.limit ?? 25
  });
}

export async function searchUnscheduledAttendanceMembersAction(input: MemberLookupRequest & { selectedDate: string }) {
  await requireModuleAccess("operations");
  return searchUnscheduledAttendanceMemberOptions({
    selectedDate: input.selectedDate,
    q: input.q,
    selectedId: input.selectedId,
    limit: input.limit ?? 25
  });
}
