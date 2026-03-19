import { getCurrentProfile, getCurrentProfileForRolesOrError } from "@/lib/auth";
import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import { insertAuditLogEntry } from "@/lib/services/audit-log-service";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
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
  let actorUserId: string | null = null;
  let actorRole: string | null = null;
  try {
    const profile = await getCurrentProfile();
    actorUserId = profile.id;
    actorRole = profile.role;
    await insertAuditLogEntry({
      actorUserId,
      actorRole,
      action,
      entityType,
      entityId,
      details
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown audit log error.";
    console.error("[action-helpers] audit log insert failed after committed write", {
      action,
      entityType,
      entityId,
      message
    });
    try {
      await recordImmediateSystemAlert({
        entityType,
        entityId,
        actorUserId,
        severity: "medium",
        alertKey: "audit_log_insert_failed",
        metadata: {
          audit_action: action,
          actor_role: actorRole,
          error: message
        }
      });
    } catch (alertError) {
      const alertMessage = alertError instanceof Error ? alertError.message : "Unknown system alert error.";
      console.error("[action-helpers] system alert insert failed after audit log failure", {
        action,
        entityType,
        entityId,
        message: alertMessage
      });
    }
  }
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
