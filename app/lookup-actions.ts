"use server";

import { requireModuleAccess, requireRoles } from "@/lib/auth";
import { PHYSICIAN_ORDER_MODULE_ROLES } from "@/lib/permissions";
import { requireCarePlanAuthorizedUser } from "@/lib/services/care-plan-authorization";
import { listEnrollmentPacketEligibleLeadPicker } from "@/lib/services/leads-read";
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
  await requireRoles(PHYSICIAN_ORDER_MODULE_ROLES);
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
