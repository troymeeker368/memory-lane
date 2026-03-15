import "server-only";

import { createClient } from "@/lib/supabase/server";

type AuditLogEntryInput = {
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  serviceRole?: boolean;
};

export async function insertAuditLogEntry(input: AuditLogEntryInput) {
  const supabase = await createClient({ serviceRole: input.serviceRole ?? false });
  const { error } = await supabase.from("audit_logs").insert({
    actor_user_id: input.actorUserId,
    actor_role: input.actorRole,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    details: input.details ?? {}
  });

  if (error) {
    throw new Error(`Unable to insert audit log entry (${input.action}): ${error.message}`);
  }
}
