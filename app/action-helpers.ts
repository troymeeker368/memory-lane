import { getCurrentProfile, getCurrentProfileForRolesOrError } from "@/lib/auth";
import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import { insertAuditLogEntry } from "@/lib/services/audit-log-service";
import type { AuditAction } from "@/types/app";
import type { CanonicalPersonSourceType } from "@/types/identity";

export type ActionErrorResult = {
  error: string;
  ok?: never;
};

export type ActionSuccessResult<T extends object = object> = {
  ok: true;
  error?: undefined;
} & T;

export async function insertAudit(
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown>
) {
  const profile = await getCurrentProfile();
  await insertAuditLogEntry({
    actorUserId: profile.id,
    actorRole: profile.role,
    action,
    entityType,
    entityId,
    details
  });
}

export async function requireManagerAdminEditor() {
  return getCurrentProfileForRolesOrError(
    ["admin", "manager", "director"],
    "Only manager/director/admin can edit submitted entries."
  );
}

export async function requireAdminEditor() {
  return getCurrentProfileForRolesOrError(["admin"], "Only admin can manage ancillary pricing.");
}

export async function resolveActionMemberIdentity(input: {
  actionLabel: string;
  memberId?: string | null;
  leadId?: string | null;
  sourceType?: CanonicalPersonSourceType | null;
  selectedRefId?: string | null;
}) {
  return resolveCanonicalMemberRef(
    {
      sourceType: input.sourceType,
      selectedId: input.selectedRefId,
      memberId: input.memberId,
      leadId: input.leadId
    },
    { actionLabel: input.actionLabel }
  );
}
