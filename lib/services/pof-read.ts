import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toSendWorkflowDeliveryStatus } from "@/lib/services/send-workflow-state";
import type { Database } from "@/types/supabase-types";
import {
  isExpired,
  parseEmailAddress,
  toStatus,
  toSummary,
  type PofRequestRow
} from "@/lib/services/pof-esign-core";

import type { PofDocumentEvent, PofRequestStatus, PofRequestSummary } from "@/lib/services/pof-types";
type DocumentEventRow = Database["public"]["Tables"]["document_events"]["Row"];

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toDeliveryStatus(row: Pick<PofRequestRow, "status" | "delivery_status">) {
  const fallback =
    toStatus(row.status) === "sent" || toStatus(row.status) === "opened" || toStatus(row.status) === "signed"
      ? "sent"
      : "pending_preparation";
  return toSendWorkflowDeliveryStatus(row.delivery_status, fallback);
}

function toEffectivePofRequestRow(row: PofRequestRow): PofRequestRow {
  if (!isExpired(row.expires_at)) return row;
  const status = toStatus(row.status);
  if (status === "expired" || status === "signed" || status === "declined") {
    return row;
  }
  return {
    ...row,
    status: "expired"
  };
}

function toEffectivePofSummary(row: PofRequestRow): PofRequestSummary {
  return {
    ...toSummary(toEffectivePofRequestRow(row)),
    deliveryStatus: toDeliveryStatus(row),
    deliveryError: clean(row.delivery_error),
    optionalMessage: row.optional_message
  };
}

export function getConfiguredClinicalSenderEmail() {
  const preferred =
    parseEmailAddress(process.env.CLINICAL_SENDER_EMAIL) ??
    parseEmailAddress(process.env.DEFAULT_CLINICAL_SENDER_EMAIL) ??
    parseEmailAddress(process.env.RESEND_FROM_EMAIL);
  return preferred ?? "";
}

export async function listPofRequestsForMember(memberId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pof_requests")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PofRequestRow[]).map(toEffectivePofSummary);
}

export async function listPofRequestsByPhysicianOrderIds(memberId: string, physicianOrderIds: string[]) {
  if (physicianOrderIds.length === 0) return [] as PofRequestSummary[];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pof_requests")
    .select("*")
    .eq("member_id", memberId)
    .in("physician_order_id", physicianOrderIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PofRequestRow[]).map(toEffectivePofSummary);
}

export async function getPofRequestSummaryById(requestId: string, memberId?: string | null) {
  const normalizedRequestId = clean(requestId);
  if (!normalizedRequestId) return null;

  const supabase = await createClient();
  let query = supabase.from("pof_requests").select("*").eq("id", normalizedRequestId);
  if (clean(memberId)) {
    query = query.eq("member_id", clean(memberId)!);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  return toEffectivePofSummary(data as PofRequestRow);
}

export async function getPofRequestTimeline(requestId: string, memberId?: string) {
  const supabase = await createClient();
  let requestQuery = supabase.from("pof_requests").select("*").eq("id", requestId);
  if (memberId) requestQuery = requestQuery.eq("member_id", memberId);
  const { data: requestData, error: requestError } = await requestQuery.maybeSingle();
  if (requestError) throw new Error(requestError.message);
  if (!requestData) return null;
  const effectiveRequest = toEffectivePofRequestRow(requestData as PofRequestRow);

  const { data: eventsData, error: eventsError } = await supabase
    .from("document_events")
    .select("*")
    .eq("document_id", requestId)
    .order("created_at", { ascending: true });
  if (eventsError) throw new Error(eventsError.message);

  const events = ((eventsData ?? []) as DocumentEventRow[]).map(
    (row): PofDocumentEvent => ({
      id: row.id,
      documentId: row.document_id,
      memberId: row.member_id,
      physicianOrderId: row.physician_order_id,
      eventType: row.event_type as PofDocumentEvent["eventType"],
      actorType: row.actor_type as PofDocumentEvent["actorType"],
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      actorEmail: row.actor_email,
      actorIp: row.actor_ip,
      actorUserAgent: row.actor_user_agent,
      metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {},
      createdAt: row.created_at
    })
  );

  return {
    request: toEffectivePofSummary(effectiveRequest),
    events
  };
}

export async function listPofTimelineForPhysicianOrder(physicianOrderId: string) {
  const supabase = await createClient();
  const { data: requestsData, error: requestsError } = await supabase
    .from("pof_requests")
    .select("*")
    .eq("physician_order_id", physicianOrderId)
    .order("created_at", { ascending: false });
  if (requestsError) throw new Error(requestsError.message);
  const requests = ((requestsData ?? []) as PofRequestRow[]).map(toEffectivePofSummary);
  if (requests.length === 0) return { requests, events: [] as PofDocumentEvent[] };

  const requestIds = requests.map((row) => row.id);
  const { data: eventsData, error: eventsError } = await supabase
    .from("document_events")
    .select("*")
    .in("document_id", requestIds)
    .order("created_at", { ascending: true });
  if (eventsError) throw new Error(eventsError.message);

  const events = ((eventsData ?? []) as DocumentEventRow[]).map(
    (row): PofDocumentEvent => ({
      id: row.id,
      documentId: row.document_id,
      memberId: row.member_id,
      physicianOrderId: row.physician_order_id,
      eventType: row.event_type as PofDocumentEvent["eventType"],
      actorType: row.actor_type as PofDocumentEvent["actorType"],
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      actorEmail: row.actor_email,
      actorIp: row.actor_ip,
      actorUserAgent: row.actor_user_agent,
      metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {},
      createdAt: row.created_at
    })
  );

  return { requests, events };
}
