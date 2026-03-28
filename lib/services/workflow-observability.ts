import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logSystemEvent } from "@/lib/services/system-event-service";

export type WorkflowEventSeverity = "low" | "medium" | "high" | "critical";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type WorkflowEventInput = {
  eventType: string;
  entityType: string;
  entityId?: string | null;
  actorType?: string | null;
  actorUserId?: string | null;
  actorId?: string | null;
  status?: string | null;
  severity?: WorkflowEventSeverity | null;
  metadata?: Record<string, JsonValue> | null;
  requestId?: string | null;
  correlationId?: string | null;
  dedupeKey?: string | null;
};

function normalizeText(value: string | null | undefined) {
  const cleaned = (value ?? "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function buildAlertCorrelationId(input: {
  alertType: string;
  entityType: string;
  entityId?: string | null;
}) {
  return [
    "alert",
    normalizeText(input.alertType) ?? "unknown",
    normalizeText(input.entityType) ?? "unknown",
    normalizeText(input.entityId) ?? "none"
  ].join(":");
}

export async function recordWorkflowEvent(input: WorkflowEventInput) {
  return logSystemEvent(
    {
      event_type: input.eventType,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      actor_type: input.actorType ?? null,
      actor_id: input.actorId ?? input.actorUserId ?? null,
      actor_user_id: input.actorUserId ?? null,
      status: input.status ?? null,
      severity: input.severity ?? null,
      metadata: input.metadata ?? {},
      request_id: input.requestId ?? null,
      correlation_id: input.correlationId ?? null,
      dedupe_key: input.dedupeKey ?? null
    },
    { required: false }
  );
}

export async function maybeRecordRepeatedFailureAlert(input: {
  workflowEventType: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, JsonValue> | null;
  actorUserId?: string | null;
  threshold?: number;
  lookbackHours?: number;
  severity?: WorkflowEventSeverity;
}) {
  const entityType = normalizeText(input.entityType);
  const workflowEventType = normalizeText(input.workflowEventType);
  if (!entityType || !workflowEventType) return false;

  const threshold = Math.max(2, input.threshold ?? 2);
  const lookbackHours = Math.max(1, input.lookbackHours ?? 24);
  const entityId = normalizeText(input.entityId);
  const sinceIso = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const supabase = await createClient({ serviceRole: true });

  let failuresQuery = supabase
    .from("system_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", workflowEventType)
    .eq("entity_type", entityType)
    .eq("status", "failed")
    .gte("created_at", sinceIso);

  if (entityId) {
    failuresQuery = failuresQuery.eq("entity_id", entityId);
  }

  const { count, error: countError } = await failuresQuery;
  if (countError) {
    console.error("[workflow-observability] unable to count repeated failures", countError);
    return false;
  }
  if (Number(count ?? 0) < threshold) return false;

  const correlationId = buildAlertCorrelationId({
    alertType: workflowEventType,
    entityType,
    entityId
  });
  let existingAlertQuery = supabase
    .from("system_events")
    .select("id")
    .eq("event_type", "system_alert")
    .eq("entity_type", entityType)
    .eq("correlation_id", correlationId)
    .eq("status", "open");

  if (entityId) {
    existingAlertQuery = existingAlertQuery.eq("entity_id", entityId);
  }

  const { data: existingAlert, error: existingAlertError } = await existingAlertQuery.limit(1).maybeSingle();
  if (existingAlertError) {
    console.error("[workflow-observability] unable to check existing alert state", existingAlertError);
    return false;
  }
  if (existingAlert?.id) return false;

  await recordWorkflowEvent({
    eventType: "system_alert",
    entityType,
    entityId,
    actorType: "system",
    actorUserId: input.actorUserId ?? null,
    status: "open",
    severity: input.severity ?? "high",
    correlationId,
    metadata: {
      alert_type: "repeated_failure",
      source_event_type: workflowEventType,
      threshold,
      lookback_hours: lookbackHours,
      ...(input.metadata ?? {})
    }
  });
  return true;
}

export async function recordImmediateSystemAlert(input: {
  entityType: string;
  entityId?: string | null;
  actorUserId?: string | null;
  severity?: WorkflowEventSeverity;
  alertKey: string;
  metadata?: Record<string, JsonValue> | null;
}) {
  const correlationId = buildAlertCorrelationId({
    alertType: input.alertKey,
    entityType: input.entityType,
    entityId: input.entityId
  });
  const supabase = await createClient({ serviceRole: true });
  let existingAlertQuery = supabase
    .from("system_events")
    .select("id")
    .eq("event_type", "system_alert")
    .eq("entity_type", input.entityType)
    .eq("correlation_id", correlationId)
    .eq("status", "open");

  if (normalizeText(input.entityId)) {
    existingAlertQuery = existingAlertQuery.eq("entity_id", input.entityId);
  }

  const { data: existingAlert, error: existingAlertError } = await existingAlertQuery.limit(1).maybeSingle();
  if (existingAlertError) {
    console.error("[workflow-observability] unable to check immediate alert state", existingAlertError);
  }
  if (existingAlert?.id) {
    return false;
  }

  return recordWorkflowEvent({
    eventType: "system_alert",
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    actorType: "system",
    actorUserId: input.actorUserId ?? null,
    status: "open",
    severity: input.severity ?? "high",
    correlationId,
    metadata: {
      alert_type: input.alertKey,
      ...(input.metadata ?? {})
    }
  });
}
