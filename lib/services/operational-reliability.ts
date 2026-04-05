import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { toEasternISO } from "@/lib/timezone";
import { sendEnrollmentPacketRequest } from "@/lib/services/enrollment-packets-sender";
import { sendCarePlanToCaregiverForSignature } from "@/lib/services/care-plan-esign";
import { createBillingExport } from "@/lib/services/billing-workflows";
import { resendPofSignatureRequest } from "@/lib/services/pof-esign";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
import type { Database } from "@/types/supabase-types";

type WorkflowDomain = "enrollment_packet" | "pof_request" | "care_plan" | "billing";
type EnrollmentPacketRetryRow = Pick<
  Database["public"]["Tables"]["enrollment_packet_requests"]["Row"],
  "id" | "member_id" | "delivery_status" | "updated_at" | "created_at" | "delivery_error"
>;
type PofRetryRow = Pick<
  Database["public"]["Tables"]["pof_requests"]["Row"],
  "id" | "member_id" | "delivery_status" | "updated_at" | "created_at" | "delivery_error"
>;
type CarePlanRetryRow = Pick<
  Database["public"]["Tables"]["care_plans"]["Row"],
  "id" | "member_id" | "caregiver_signature_status" | "updated_at" | "created_at" | "caregiver_signature_error"
>;
type SystemEventRow = Pick<
  Database["public"]["Tables"]["system_events"]["Row"],
  "id" | "event_type" | "entity_id" | "created_at" | "severity" | "metadata"
>;

type StuckWorkflowRow = {
  workflowType: WorkflowDomain;
  entityId: string;
  memberId: string | null;
  status: string;
  updatedAt: string;
  ageMinutes: number;
  error: string | null;
};

export type OperationalReliabilitySummary = {
  pendingEnrollmentPackets: number;
  failedEnrollmentPackets: number;
  pendingPofRequests: number;
  failedPofRequests: number;
  pendingCarePlanSignatures: number;
  failedCarePlanSignatures: number;
  recentBillingFailures: number;
  openSystemAlerts: number;
};

export type WorkflowReliabilitySnapshot = {
  summary: OperationalReliabilitySummary;
  stuckEnrollmentPackets: StuckWorkflowRow[];
  stuckPofRequests: StuckWorkflowRow[];
  stuckCarePlanRequests: StuckWorkflowRow[];
  recentBillingFailures: Array<{
    id: string;
    eventType: string;
    entityId: string | null;
    createdAt: string;
    severity: string | null;
    metadata: Record<string, unknown>;
  }>;
};

function normalizeText(value: string | null | undefined) {
  const cleaned = (value ?? "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function ageMinutesFromIso(updatedAt: string) {
  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.floor((Date.now() - parsed) / 60000));
}

function sinceIso(minutes: number) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function toStuckWorkflowRow(input: {
  workflowType: WorkflowDomain;
  entityId: string;
  memberId?: string | null;
  status: string;
  updatedAt: string;
  error?: string | null;
}) {
  return {
    workflowType: input.workflowType,
    entityId: input.entityId,
    memberId: input.memberId ?? null,
    status: input.status,
    updatedAt: input.updatedAt,
    ageMinutes: ageMinutesFromIso(input.updatedAt),
    error: normalizeText(input.error)
  } satisfies StuckWorkflowRow;
}

export async function retryEnrollmentPacketDelivery(
  input: Parameters<typeof sendEnrollmentPacketRequest>[0]
) {
  const result = await sendEnrollmentPacketRequest(input);
  await recordWorkflowEvent({
    eventType: "enrollment_packet_retry_requested",
    entityType: "enrollment_packet_request",
    entityId: result.request.id,
    actorType: "user",
    actorUserId: input.senderUserId,
    status: result.request.deliveryStatus,
    severity: "medium",
    metadata: {
      member_id: result.request.memberId,
      lead_id: result.request.leadId,
      retry_requested_at: toEasternISO()
    }
  });
  return result;
}

export async function retryPofRequestDelivery(
  input: Parameters<typeof resendPofSignatureRequest>[0]
) {
  const result = await resendPofSignatureRequest(input);
  await recordWorkflowEvent({
    eventType: "pof_request_retry_requested",
    entityType: "pof_request",
    entityId: result.id,
    actorType: "user",
    actorUserId: input.actor.id,
    status: result.deliveryStatus,
    severity: "medium",
    metadata: {
      member_id: result.memberId,
      physician_order_id: result.physicianOrderId,
      retry_requested_at: toEasternISO()
    }
  });
  return result;
}

export async function retryCarePlanCaregiverRequest(
  input: Parameters<typeof sendCarePlanToCaregiverForSignature>[0]
) {
  const result = await sendCarePlanToCaregiverForSignature(input);
  await recordWorkflowEvent({
    eventType: "care_plan_retry_requested",
    entityType: "care_plan",
    entityId: result.id,
    actorType: "user",
    actorUserId: input.actor.id,
    status: result.caregiverSignatureStatus,
    severity: "medium",
    metadata: {
      member_id: result.memberId,
      retry_requested_at: toEasternISO()
    }
  });
  return result;
}

export async function retryBillingExportGeneration(
  input: Parameters<typeof createBillingExport>[0]
) {
  const result = await createBillingExport(input);
  await recordWorkflowEvent({
    eventType: result.ok ? "billing_export_retry_requested" : "billing_export_retry_failed",
    entityType: "billing_batch",
    entityId: input.billingBatchId,
    actorType: "user",
    status: result.ok ? "generated" : "failed",
    severity: result.ok ? "medium" : "high",
    metadata: {
      export_type: input.exportType,
      quickbooks_detail_level: input.quickbooksDetailLevel,
      generated_by: input.generatedBy,
      billing_export_id: result.ok ? result.billingExportId : null,
      error: result.ok ? null : result.error
    }
  });
  return result;
}

export async function listStuckEnrollmentPacketRequests(options?: {
  olderThanMinutes?: number;
  limit?: number;
}) {
  const supabase = createServiceRoleClient("operational_reliability_read");
  const olderThanMinutes = Math.max(5, options?.olderThanMinutes ?? 15);
  const limit = Math.min(100, Math.max(1, options?.limit ?? 25));
  const { data, error } = await supabase
    .from("enrollment_packet_requests")
    .select("id, member_id, delivery_status, updated_at, delivery_error")
    .in("delivery_status", ["send_failed", "retry_pending"])
    .lte("updated_at", sinceIso(olderThanMinutes))
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as EnrollmentPacketRetryRow[]).map((row) =>
    toStuckWorkflowRow({
      workflowType: "enrollment_packet",
      entityId: String(row.id),
      memberId: normalizeText(row.member_id),
      status: String(row.delivery_status ?? "unknown"),
      updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
      error: normalizeText(row.delivery_error)
    })
  );
}

export async function listStuckPofRequests(options?: {
  olderThanMinutes?: number;
  limit?: number;
}) {
  const supabase = createServiceRoleClient("operational_reliability_read");
  const olderThanMinutes = Math.max(5, options?.olderThanMinutes ?? 15);
  const limit = Math.min(100, Math.max(1, options?.limit ?? 25));
  const { data, error } = await supabase
    .from("pof_requests")
    .select("id, member_id, delivery_status, updated_at, delivery_error")
    .in("delivery_status", ["send_failed", "retry_pending"])
    .lte("updated_at", sinceIso(olderThanMinutes))
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as PofRetryRow[]).map((row) =>
    toStuckWorkflowRow({
      workflowType: "pof_request",
      entityId: String(row.id),
      memberId: normalizeText(row.member_id),
      status: String(row.delivery_status ?? "unknown"),
      updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
      error: normalizeText(row.delivery_error)
    })
  );
}

export async function listStuckCarePlanRequests(options?: {
  olderThanMinutes?: number;
  limit?: number;
}) {
  const supabase = createServiceRoleClient("operational_reliability_read");
  const olderThanMinutes = Math.max(5, options?.olderThanMinutes ?? 30);
  const limit = Math.min(100, Math.max(1, options?.limit ?? 25));
  const { data, error } = await supabase
    .from("care_plans")
    .select("id, member_id, caregiver_signature_status, updated_at, caregiver_signature_error")
    .in("caregiver_signature_status", ["send_failed", "ready_to_send"])
    .lte("updated_at", sinceIso(olderThanMinutes))
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as CarePlanRetryRow[]).map((row) =>
    toStuckWorkflowRow({
      workflowType: "care_plan",
      entityId: String(row.id),
      memberId: normalizeText(row.member_id),
      status: String(row.caregiver_signature_status ?? "unknown"),
      updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
      error: normalizeText(row.caregiver_signature_error)
    })
  );
}

export async function listRecentBillingWorkflowFailures(options?: {
  lookbackHours?: number;
  limit?: number;
}) {
  const supabase = createServiceRoleClient("operational_reliability_read");
  const lookbackHours = Math.max(1, options?.lookbackHours ?? 72);
  const limit = Math.min(100, Math.max(1, options?.limit ?? 25));
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("system_events")
    .select("id, event_type, entity_id, created_at, severity, metadata")
    .in("event_type", ["billing_batch_failed", "billing_export_failed"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as SystemEventRow[]).map((row) => ({
    id: String(row.id),
    eventType: String(row.event_type),
    entityId: normalizeText(row.entity_id),
    createdAt: String(row.created_at),
    severity: normalizeText(row.severity),
    metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {}
  }));
}

export async function getOperationalReliabilitySummary(): Promise<OperationalReliabilitySummary> {
  const supabase = createServiceRoleClient("operational_reliability_read");
  const [
    { count: pendingEnrollmentPackets, error: pendingEnrollmentError },
    { count: failedEnrollmentPackets, error: failedEnrollmentError },
    { count: pendingPofRequests, error: pendingPofError },
    { count: failedPofRequests, error: failedPofError },
    { count: pendingCarePlanSignatures, error: pendingCarePlanError },
    { count: failedCarePlanSignatures, error: failedCarePlanError },
    { count: recentBillingFailures, error: billingFailureError },
    { count: openSystemAlerts, error: alertError }
  ] = await Promise.all([
    supabase
      .from("enrollment_packet_requests")
      .select("id", { count: "exact", head: true })
      .in("delivery_status", ["pending_preparation", "ready_to_send", "retry_pending"]),
    supabase
      .from("enrollment_packet_requests")
      .select("id", { count: "exact", head: true })
      .eq("delivery_status", "send_failed"),
    supabase
      .from("pof_requests")
      .select("id", { count: "exact", head: true })
      .in("delivery_status", ["pending_preparation", "ready_to_send", "retry_pending"])
      .in("status", ["draft", "sent", "opened"]),
    supabase
      .from("pof_requests")
      .select("id", { count: "exact", head: true })
      .eq("delivery_status", "send_failed"),
    supabase
      .from("care_plans")
      .select("id", { count: "exact", head: true })
      .in("caregiver_signature_status", ["ready_to_send", "sent", "viewed"]),
    supabase
      .from("care_plans")
      .select("id", { count: "exact", head: true })
      .eq("caregiver_signature_status", "send_failed"),
    supabase
      .from("system_events")
      .select("id", { count: "exact", head: true })
      .in("event_type", ["billing_batch_failed", "billing_export_failed"])
      .gte("created_at", new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()),
    supabase
      .from("system_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "system_alert")
      .eq("status", "open")
  ]);

  const firstError =
    pendingEnrollmentError ??
    failedEnrollmentError ??
    pendingPofError ??
    failedPofError ??
    pendingCarePlanError ??
    failedCarePlanError ??
    billingFailureError ??
    alertError;
  if (firstError) throw new Error(firstError.message);

  return {
    pendingEnrollmentPackets: Number(pendingEnrollmentPackets ?? 0),
    failedEnrollmentPackets: Number(failedEnrollmentPackets ?? 0),
    pendingPofRequests: Number(pendingPofRequests ?? 0),
    failedPofRequests: Number(failedPofRequests ?? 0),
    pendingCarePlanSignatures: Number(pendingCarePlanSignatures ?? 0),
    failedCarePlanSignatures: Number(failedCarePlanSignatures ?? 0),
    recentBillingFailures: Number(recentBillingFailures ?? 0),
    openSystemAlerts: Number(openSystemAlerts ?? 0)
  };
}

export async function getOperationalReliabilitySnapshot(): Promise<WorkflowReliabilitySnapshot> {
  const [summary, stuckEnrollmentPackets, stuckPofRequests, stuckCarePlanRequests, recentBillingFailures] =
    await Promise.all([
      getOperationalReliabilitySummary(),
      listStuckEnrollmentPacketRequests(),
      listStuckPofRequests(),
      listStuckCarePlanRequests(),
      listRecentBillingWorkflowFailures()
    ]);

  return {
    summary,
    stuckEnrollmentPackets,
    stuckPofRequests,
    stuckCarePlanRequests,
    recentBillingFailures
  };
}
