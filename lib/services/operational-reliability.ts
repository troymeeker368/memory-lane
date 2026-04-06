import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
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

type OperationalReliabilitySnapshotRpcRow = {
  pending_enrollment_packets: number | string | null;
  failed_enrollment_packets: number | string | null;
  pending_pof_requests: number | string | null;
  failed_pof_requests: number | string | null;
  pending_care_plan_signatures: number | string | null;
  failed_care_plan_signatures: number | string | null;
  recent_billing_failures: number | string | null;
  open_system_alerts: number | string | null;
  stuck_enrollment_packets: unknown;
  stuck_pof_requests: unknown;
  stuck_care_plan_requests: unknown;
  recent_billing_failure_rows: unknown;
};

const OPERATIONAL_RELIABILITY_SNAPSHOT_RPC = "rpc_get_operational_reliability_snapshot";
const OPERATIONAL_RELIABILITY_SNAPSHOT_RPC_MIGRATION = "0203_operational_reliability_snapshot_rpc.sql";

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

function toJsonObjectArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)
      )
    : [];
}

function toRpcStuckWorkflowRows(value: unknown) {
  return toJsonObjectArray(value).map((row) => ({
    workflowType: String(row.workflowType ?? "") as WorkflowDomain,
    entityId: String(row.entityId ?? ""),
    memberId: normalizeText(typeof row.memberId === "string" ? row.memberId : null),
    status: String(row.status ?? "unknown"),
    updatedAt: String(row.updatedAt ?? ""),
    ageMinutes: Math.max(0, Number(row.ageMinutes ?? 0)),
    error: normalizeText(typeof row.error === "string" ? row.error : null)
  }));
}

function toRpcBillingFailureRows(value: unknown) {
  return toJsonObjectArray(value).map((row) => ({
    id: String(row.id ?? ""),
    eventType: String(row.eventType ?? ""),
    entityId: normalizeText(typeof row.entityId === "string" ? row.entityId : null),
    createdAt: String(row.createdAt ?? ""),
    severity: normalizeText(typeof row.severity === "string" ? row.severity : null),
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {}
  }));
}

async function loadOperationalReliabilitySnapshotRpc(input?: {
  olderThanMinutes?: number;
  carePlanOlderThanMinutes?: number;
  lookbackHours?: number;
  limit?: number;
}) {
  const supabase = createServiceRoleClient("operational_reliability_read");
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, OPERATIONAL_RELIABILITY_SNAPSHOT_RPC, {
      p_retry_age_minutes: Math.max(5, input?.olderThanMinutes ?? 15),
      p_care_plan_age_minutes: Math.max(5, input?.carePlanOlderThanMinutes ?? 30),
      p_billing_lookback_hours: Math.max(1, input?.lookbackHours ?? 72),
      p_limit: Math.min(100, Math.max(1, input?.limit ?? 25))
    });
    const row = (Array.isArray(data) ? data[0] : null) as OperationalReliabilitySnapshotRpcRow | null;
    if (!row) {
      throw new Error("Operational reliability snapshot RPC returned no rows.");
    }
    return {
      summary: {
        pendingEnrollmentPackets: Number(row.pending_enrollment_packets ?? 0),
        failedEnrollmentPackets: Number(row.failed_enrollment_packets ?? 0),
        pendingPofRequests: Number(row.pending_pof_requests ?? 0),
        failedPofRequests: Number(row.failed_pof_requests ?? 0),
        pendingCarePlanSignatures: Number(row.pending_care_plan_signatures ?? 0),
        failedCarePlanSignatures: Number(row.failed_care_plan_signatures ?? 0),
        recentBillingFailures: Number(row.recent_billing_failures ?? 0),
        openSystemAlerts: Number(row.open_system_alerts ?? 0)
      } satisfies OperationalReliabilitySummary,
      stuckEnrollmentPackets: toRpcStuckWorkflowRows(row.stuck_enrollment_packets),
      stuckPofRequests: toRpcStuckWorkflowRows(row.stuck_pof_requests),
      stuckCarePlanRequests: toRpcStuckWorkflowRows(row.stuck_care_plan_requests),
      recentBillingFailures: toRpcBillingFailureRows(row.recent_billing_failure_rows)
    } satisfies WorkflowReliabilitySnapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load operational reliability snapshot.";
    if (message.includes(OPERATIONAL_RELIABILITY_SNAPSHOT_RPC)) {
      throw new Error(
        `Operational reliability snapshot RPC is not available. Apply Supabase migration ${OPERATIONAL_RELIABILITY_SNAPSHOT_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
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
  const snapshot = await loadOperationalReliabilitySnapshotRpc({
    olderThanMinutes: options?.olderThanMinutes,
    limit: options?.limit
  });
  return snapshot.stuckEnrollmentPackets;
}

export async function listStuckPofRequests(options?: {
  olderThanMinutes?: number;
  limit?: number;
}) {
  const snapshot = await loadOperationalReliabilitySnapshotRpc({
    olderThanMinutes: options?.olderThanMinutes,
    limit: options?.limit
  });
  return snapshot.stuckPofRequests;
}

export async function listStuckCarePlanRequests(options?: {
  olderThanMinutes?: number;
  limit?: number;
}) {
  const snapshot = await loadOperationalReliabilitySnapshotRpc({
    carePlanOlderThanMinutes: options?.olderThanMinutes,
    limit: options?.limit
  });
  return snapshot.stuckCarePlanRequests;
}

export async function listRecentBillingWorkflowFailures(options?: {
  lookbackHours?: number;
  limit?: number;
}) {
  const snapshot = await loadOperationalReliabilitySnapshotRpc({
    lookbackHours: options?.lookbackHours,
    limit: options?.limit
  });
  return snapshot.recentBillingFailures;
}

export async function getOperationalReliabilitySummary(): Promise<OperationalReliabilitySummary> {
  const snapshot = await loadOperationalReliabilitySnapshotRpc();
  return snapshot.summary;
}

export async function getOperationalReliabilitySnapshot(): Promise<WorkflowReliabilitySnapshot> {
  return loadOperationalReliabilitySnapshotRpc();
}
