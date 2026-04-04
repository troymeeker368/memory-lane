import "server-only";

import { getCurrentProfile, getCurrentProfileForRolesOrError } from "@/lib/auth";
import { insertAuditLogEntry } from "@/lib/services/audit-log-service";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import type { AuditAction } from "@/types/app";

export async function insertDocumentationAudit(
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
    console.error("[documentation-actions] audit log insert failed after committed write", {
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
      console.error("[documentation-actions] system alert insert failed after audit log failure", {
        action,
        entityType,
        entityId,
        message: alertMessage
      });
    }
  }
}

export async function requireDocumentationManagerEditor() {
  return getCurrentProfileForRolesOrError(["admin", "manager", "director"], "Only manager/director/admin can edit submitted entries.");
}
