import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isPostgresUniqueViolation } from "@/lib/services/idempotency";

type AuditLogEntryInput = {
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  dedupeKey?: string | null;
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
    details: input.details ?? {},
    dedupe_key: input.dedupeKey ?? null
  });

  if (error) {
    if (input.dedupeKey && isPostgresUniqueViolation(error)) {
      return false;
    }

    throw new Error(`Unable to insert audit log entry (${input.action}): ${error.message}`);
  }

  return true;
}
