import type { AppRole } from "@/types/app";

import { getMemberDetail } from "@/lib/services/member-detail-read-model";
import {
  findActiveMemberByLockerNumberSupabase,
  getMemberSupabase,
  getTransportationAddRiderMemberOptionsSupabase,
  listMembersSupabase
} from "@/lib/services/member-command-center-read";

type MemberListFilters = Parameters<typeof listMembersSupabase>[0];
type MemberDetailScope = {
  role?: AppRole;
  staffUserId?: string | null;
};

function cleanLockerNumber(lockerNumber: string | null | undefined) {
  const normalized = String(lockerNumber ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export async function getMemberList(filters?: MemberListFilters) {
  return listMembersSupabase(filters);
}

export async function getMemberById(memberId: string) {
  return getMemberSupabase(memberId);
}

export async function getMemberDetailById(memberId: string, scope?: MemberDetailScope) {
  return getMemberDetail(memberId, scope);
}

export async function getTransportationAddRiderMembers(
  ...args: Parameters<typeof getTransportationAddRiderMemberOptionsSupabase>
) {
  return getTransportationAddRiderMemberOptionsSupabase(...args);
}

export async function getMemberLockerConflict(input: {
  memberId: string;
  lockerNumber: string | null;
}) {
  const member = await getMemberSupabase(input.memberId);
  if (!member) {
    return {
      member: null,
      conflict: null
    };
  }

  const normalizedLocker = cleanLockerNumber(input.lockerNumber);
  if (!normalizedLocker || member.status !== "active") {
    return {
      member,
      conflict: null
    };
  }

  const conflict = await findActiveMemberByLockerNumberSupabase(normalizedLocker, {
    excludeMemberId: member.id
  });

  return {
    member,
    conflict: conflict
      ? {
          id: conflict.id,
          displayName: conflict.display_name
        }
      : null
  };
}
