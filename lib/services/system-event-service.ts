import { createClient } from "@/lib/supabase/server";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type LogSystemEventInput = {
  event_type: string;
  entity_type: string;
  entity_id?: string | null;
  actor_type?: string | null;
  actor_id?: string | null;
  actor_user_id?: string | null;
  status?: string | null;
  severity?: string | null;
  metadata?: JsonValue | null;
  request_id?: string | null;
  correlation_id?: string | null;
};

type LogSystemEventOptions = {
  required?: boolean;
};

function buildSystemEventErrorMessage(input: LogSystemEventInput, message: string) {
  return [
    "Unable to persist required system event.",
    `event_type=${input.event_type}`,
    `entity_type=${input.entity_type}`,
    `entity_id=${input.entity_id ?? "null"}`,
    `reason=${message}`
  ].join(" ");
}

export async function logSystemEvent(
  input: LogSystemEventInput,
  options?: LogSystemEventOptions
) {
  const required = options?.required ?? true;
  const supabase = await createClient({ serviceRole: true });
  const actorUserId =
    input.actor_user_id ?? ((input.actor_type ?? "").trim().toLowerCase() === "user" ? input.actor_id ?? null : null);
  const { error } = await supabase.from("system_events").insert({
    event_type: input.event_type,
    entity_type: input.entity_type,
    entity_id: input.entity_id ?? null,
    actor_type: input.actor_type ?? null,
    actor_id: input.actor_id ?? null,
    actor_user_id: actorUserId,
    status: input.status ?? null,
    severity: input.severity ?? null,
    metadata: (input.metadata ?? {}) as JsonValue,
    request_id: input.request_id ?? null,
    correlation_id: input.correlation_id ?? null
  });

  if (error) {
    const summary = {
      eventType: input.event_type,
      entityType: input.entity_type,
      entityId: input.entity_id ?? null,
      message: error.message
    };
    if (!required) {
      console.error("[system_events] failed to insert optional event", summary);
      return false;
    }
    throw new Error(buildSystemEventErrorMessage(input, error.message));
  }

  return true;
}
