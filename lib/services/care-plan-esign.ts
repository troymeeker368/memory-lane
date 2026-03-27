import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternISO } from "@/lib/timezone";
import {
  canSendCaregiverSignatureByNurseSignatureState
} from "@/lib/services/care-plan-esign-rules";
import { getCarePlanById, type CaregiverSignatureStatus, type CarePlan } from "@/lib/services/care-plans";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import {
  maybeRecordRepeatedFailureAlert,
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import { throwDeliveryStateFinalizeFailure } from "@/lib/services/send-workflow-state";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";

const TOKEN_BYTE_LENGTH = 32;
const PREPARE_CARE_PLAN_CAREGIVER_REQUEST_RPC = "rpc_prepare_care_plan_caregiver_request";
const TRANSITION_CARE_PLAN_CAREGIVER_STATUS_RPC = "rpc_transition_care_plan_caregiver_status";
const CARE_PLAN_CAREGIVER_REQUEST_MIGRATION = "0073_delivery_and_member_file_rpc_hardening.sql";
const CARE_PLAN_CAREGIVER_STATUS_TRANSITION_MIGRATION = "0118_care_plan_caregiver_status_terminality_hardening.sql";

export async function recordCarePlanAlertSafely(
  input: Parameters<typeof recordImmediateSystemAlert>[0],
  context: string
) {
  try {
    await recordImmediateSystemAlert(input);
  } catch (error) {
    console.error("[care-plan-esign] unable to persist follow-up system alert", {
      context,
      entityId: input.entityId ?? null,
      alertKey: input.alertKey,
      message: error instanceof Error ? error.message : "Unknown system alert error."
    });
  }
}

export type CarePlanSignatureEventType =
  | "sent"
  | "send_failed"
  | "opened"
  | "signed"
  | "expired";

function isMissingRpcFunctionError(error: unknown, rpcName: string) {
  const candidate =
    error && typeof error === "object"
      ? (error as {
          code?: unknown;
          message?: unknown;
          details?: unknown;
          hint?: unknown;
          cause?: { code?: unknown; message?: unknown; details?: unknown; hint?: unknown } | null;
        })
      : null;
  const code = String(candidate?.code ?? candidate?.cause?.code ?? "").toUpperCase();
  const message = [
    candidate?.message,
    candidate?.details,
    candidate?.hint,
    candidate?.cause?.message,
    candidate?.cause?.details,
    candidate?.cause?.hint
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  const normalizedName = rpcName.toLowerCase();

  return (
    code === "PGRST202" ||
    code === "42883" ||
    message.includes(`function ${normalizedName}`) ||
    (message.includes(normalizedName) && message.includes("could not find")) ||
    (message.includes(normalizedName) && message.includes("does not exist")) ||
    (message.includes(normalizedName) && message.includes("schema cache"))
  );
}

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function isEmail(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function generateSigningToken() {
  return randomBytes(TOKEN_BYTE_LENGTH).toString("hex");
}

function buildAppBaseUrl() {
  const explicit =
    clean(process.env.NEXT_PUBLIC_APP_URL) ??
    clean(process.env.APP_URL) ??
    clean(process.env.NEXT_PUBLIC_SITE_URL) ??
    clean(process.env.SITE_URL);
  const vercelHost =
    clean(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    clean(process.env.VERCEL_URL);
  const raw = explicit ?? vercelHost ?? null;
  if (!raw) {
    if ((process.env.NODE_ENV ?? "").toLowerCase() === "production") {
      throw new Error(
        "Care plan e-sign public URL is not configured. Set NEXT_PUBLIC_APP_URL (or APP_URL/SITE_URL) so caregiver links are live."
      );
    }
    return "http://localhost:3001";
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  const localhostHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
  if (parsed.protocol === "http:" && !localhostHostnames.has(parsed.hostname)) {
    parsed.protocol = "https:";
  }
  return parsed.toString().replace(/\/$/, "");
}

function toIsoAtEndOfDate(dateOnly: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly.trim())) {
    throw new Error("Expiration date must be a valid date.");
  }
  const expires = new Date(`${dateOnly}T23:59:59.999`);
  if (Number.isNaN(expires.getTime())) {
    throw new Error("Expiration date is invalid.");
  }
  return expires.toISOString();
}

export async function createCarePlanSignatureEvent(input: {
  carePlanId: string;
  memberId: string;
  eventType: CarePlanSignatureEventType;
  actorType: "user" | "caregiver" | "system";
  actorUserId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  actorIp?: string | null;
  actorUserAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("care_plan_signature_events").insert({
    care_plan_id: input.carePlanId,
    member_id: input.memberId,
    event_type: input.eventType,
    actor_type: input.actorType,
    actor_user_id: input.actorUserId ?? null,
    actor_name: input.actorName ?? null,
    actor_email: input.actorEmail ?? null,
    actor_ip: input.actorIp ?? null,
    actor_user_agent: input.actorUserAgent ?? null,
    metadata: input.metadata ?? {}
  });
  if (!error) return true;

  console.error("[care-plan-esign] signature event insert failed after committed workflow write", {
    carePlanId: input.carePlanId,
    eventType: input.eventType,
    message: error.message
  });
  await recordCarePlanAlertSafely({
    entityType: "care_plan",
    entityId: input.carePlanId,
    actorUserId: input.actorUserId ?? null,
    severity: "medium",
    alertKey: "care_plan_signature_event_insert_failed",
    metadata: {
      member_id: input.memberId,
      event_type: input.eventType,
      error: error.message
    }
  }, "createCarePlanSignatureEvent");
  return false;
}

async function loadCarePlanSignatureRequestTemplateBuilder() {
  const { buildCarePlanSignatureRequestTemplate } = await import("@/lib/email/templates/care-plan-signature-request");
  return buildCarePlanSignatureRequestTemplate;
}

async function prepareCarePlanCaregiverRequest(input: {
  carePlanId: string;
  caregiverName: string;
  caregiverEmail: string;
  caregiverSentByUserId: string;
  caregiverSignatureRequestToken: string;
  caregiverSignatureExpiresAt: string;
  caregiverSignatureRequestUrl: string;
  actorUserId: string;
  actorName: string;
  updatedAt: string;
}) {
  const admin = createSupabaseAdminClient();
  try {
    await invokeSupabaseRpcOrThrow<unknown>(admin, PREPARE_CARE_PLAN_CAREGIVER_REQUEST_RPC, {
      p_care_plan_id: input.carePlanId,
      p_caregiver_name: input.caregiverName,
      p_caregiver_email: input.caregiverEmail,
      p_caregiver_sent_by_user_id: input.caregiverSentByUserId,
      p_caregiver_signature_request_token: input.caregiverSignatureRequestToken,
      p_caregiver_signature_expires_at: input.caregiverSignatureExpiresAt,
      p_caregiver_signature_request_url: input.caregiverSignatureRequestUrl,
      p_actor_user_id: input.actorUserId,
      p_actor_name: input.actorName,
      p_updated_at: input.updatedAt
    });
  } catch (error) {
    if (isMissingRpcFunctionError(error, PREPARE_CARE_PLAN_CAREGIVER_REQUEST_RPC)) {
      throw new Error(
        `Care plan caregiver request RPC is not available. Apply Supabase migration ${CARE_PLAN_CAREGIVER_REQUEST_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function transitionCarePlanCaregiverStatus(input: {
  carePlanId: string;
  status: CaregiverSignatureStatus;
  updatedAt: string;
  actor?: { id: string | null; fullName: string | null } | null;
  caregiverSentAt?: string | null;
  caregiverViewedAt?: string | null;
  caregiverSignatureError?: string | null;
  expectedCurrentStatuses?: CaregiverSignatureStatus[] | null;
}) {
  const admin = createSupabaseAdminClient();
  try {
    await invokeSupabaseRpcOrThrow<unknown>(admin, TRANSITION_CARE_PLAN_CAREGIVER_STATUS_RPC, {
      p_care_plan_id: input.carePlanId,
      p_status: input.status,
      p_updated_at: input.updatedAt,
      p_actor_user_id: input.actor?.id ?? null,
      p_actor_name: input.actor?.fullName ?? null,
      p_caregiver_sent_at: input.caregiverSentAt ?? null,
      p_caregiver_viewed_at: input.caregiverViewedAt ?? null,
      p_caregiver_signature_error: input.caregiverSignatureError ?? null,
      p_expected_current_statuses: input.expectedCurrentStatuses ?? null
    });
  } catch (error) {
    if (isMissingRpcFunctionError(error, TRANSITION_CARE_PLAN_CAREGIVER_STATUS_RPC)) {
      throw new Error(
        `Care plan caregiver status RPC is not available. Apply Supabase migration ${CARE_PLAN_CAREGIVER_STATUS_TRANSITION_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

async function assertCarePlanCaregiverSentStateFinalizationReady(input: {
  carePlanId: string;
  updatedAt: string;
  actor: { id: string; fullName: string };
}) {
  await transitionCarePlanCaregiverStatus({
    carePlanId: input.carePlanId,
    status: "ready_to_send",
    updatedAt: input.updatedAt,
    actor: input.actor,
    caregiverSignatureError: null,
    expectedCurrentStatuses: ["ready_to_send"]
  });
}

export function canSendCaregiverSignature(plan: CarePlan) {
  return canSendCaregiverSignatureByNurseSignatureState({
    nurseSignatureStatus: plan.nurseSignatureStatus,
    nurseSignedAt: plan.nurseSignedAt
  });
}

type SendCarePlanToCaregiverInput = {
  carePlanId: string;
  caregiverName: string;
  caregiverEmail: string;
  optionalMessage?: string | null;
  expiresOnDate: string;
  actor: {
    id: string;
    fullName: string;
    signatureName: string;
  };
};

function buildCommittedCarePlanSendResult(input: {
  carePlan: CarePlan;
  caregiverName: string;
  caregiverEmail: string;
  actorUserId: string;
  sentAt: string;
  expiresAt: string;
  signatureRequestUrl: string;
}) {
  return {
    ...input.carePlan,
    caregiverName: input.caregiverName,
    caregiverEmail: input.caregiverEmail,
    caregiverSignatureStatus: "sent" as const,
    caregiverSentAt: input.sentAt,
    caregiverSentByUserId: input.actorUserId,
    caregiverSignatureExpiresAt: input.expiresAt,
    caregiverSignatureRequestUrl: input.signatureRequestUrl,
    updatedAt: input.sentAt
  };
}

async function sendSignatureEmail(input: {
  toEmail: string;
  caregiverName: string;
  nurseName: string;
  fromEmail: string;
  requestUrl: string;
  expiresAt: string;
  memberName: string;
  optionalMessage?: string | null;
}) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey) throw new Error("Care plan e-sign email delivery is not configured. Set RESEND_API_KEY.");
  const buildCarePlanSignatureRequestTemplate = await loadCarePlanSignatureRequestTemplateBuilder();
  const { subject, html, text } = buildCarePlanSignatureRequestTemplate({
    caregiverName: input.caregiverName,
    nurseName: input.nurseName,
    memberName: input.memberName,
    requestUrl: input.requestUrl,
    expiresAt: input.expiresAt,
    optionalMessage: input.optionalMessage ?? null
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: input.fromEmail,
      to: [input.toEmail],
      subject,
      html,
      text
    })
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      detail = "";
    }
    throw new Error(`Unable to deliver signature email (${response.status}). ${detail}`.trim());
  }
}

export async function sendCarePlanToCaregiverForSignature(input: SendCarePlanToCaregiverInput) {
  const detail = await getCarePlanById(input.carePlanId);
  if (!detail) throw new Error("Care plan was not found.");
  if (detail.carePlan.caregiverSignatureStatus === "signed") {
    throw new Error("Care plan is already signed by the responsible party.");
  }
  const canSend = canSendCaregiverSignature(detail.carePlan);
  if (!canSend.allowed) throw new Error(canSend.reason);

  const caregiverName = clean(input.caregiverName);
  const caregiverEmail = clean(input.caregiverEmail)?.toLowerCase() ?? null;
  if (!caregiverName) throw new Error("Caregiver name is required.");
  if (!caregiverEmail || !isEmail(caregiverEmail)) throw new Error("Caregiver email is invalid.");
  const validatedCaregiverEmail = caregiverEmail;

  const senderEmail =
    clean(process.env.CLINICAL_SENDER_EMAIL) ??
    clean(process.env.DEFAULT_CLINICAL_SENDER_EMAIL) ??
    clean(process.env.RESEND_FROM_EMAIL);
  if (!senderEmail || !isEmail(senderEmail)) {
    throw new Error("Clinical sender email is missing or invalid. Configure CLINICAL_SENDER_EMAIL.");
  }

  const now = toEasternISO();
  const expiresAt = toIsoAtEndOfDate(input.expiresOnDate);
  const token = generateSigningToken();
  const hashedToken = hashToken(token);
  const signatureRequestUrl = `${buildAppBaseUrl()}/sign/care-plan/${token}`;
  await prepareCarePlanCaregiverRequest({
    carePlanId: input.carePlanId,
    caregiverName,
    caregiverEmail: validatedCaregiverEmail,
    caregiverSentByUserId: input.actor.id,
    caregiverSignatureRequestToken: hashedToken,
    caregiverSignatureExpiresAt: expiresAt,
    caregiverSignatureRequestUrl: signatureRequestUrl,
    actorUserId: input.actor.id,
    actorName: input.actor.fullName,
    updatedAt: now
  });
  await assertCarePlanCaregiverSentStateFinalizationReady({
    carePlanId: input.carePlanId,
    updatedAt: now,
    actor: input.actor
  });

  try {
    await sendSignatureEmail({
      toEmail: validatedCaregiverEmail,
      caregiverName,
      nurseName: input.actor.signatureName,
      fromEmail: senderEmail,
      requestUrl: signatureRequestUrl,
      expiresAt,
      memberName: detail.carePlan.memberName,
      optionalMessage: input.optionalMessage ?? null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email failure.";
    const failedAt = toEasternISO();
    await transitionCarePlanCaregiverStatus({
      carePlanId: input.carePlanId,
      status: "send_failed",
      updatedAt: failedAt,
      actor: input.actor,
      caregiverSignatureError: message,
      expectedCurrentStatuses: ["ready_to_send", "send_failed", "sent", "viewed"]
    });
    await createCarePlanSignatureEvent({
      carePlanId: input.carePlanId,
      memberId: detail.carePlan.memberId,
      eventType: "send_failed",
      actorType: "user",
      actorUserId: input.actor.id,
      actorName: input.actor.fullName,
      actorEmail: senderEmail,
      metadata: { error: message }
    });
    await recordWorkflowEvent({
      eventType: "care_plan_failed",
      entityType: "care_plan",
      entityId: input.carePlanId,
      actorType: "user",
      actorUserId: input.actor.id,
      status: "failed",
      severity: "medium",
      metadata: {
        member_id: detail.carePlan.memberId,
        phase: "delivery",
        caregiver_email: caregiverEmail,
        error: message
      }
    });
    await maybeRecordRepeatedFailureAlert({
      workflowEventType: "care_plan_failed",
      entityType: "care_plan",
      entityId: input.carePlanId,
      actorUserId: input.actor.id,
      threshold: 2,
      metadata: {
        member_id: detail.carePlan.memberId,
        phase: "delivery"
      }
    });
    throw error;
  }

  try {
    await transitionCarePlanCaregiverStatus({
      carePlanId: input.carePlanId,
      status: "sent",
      updatedAt: now,
      actor: input.actor,
      caregiverSentAt: now,
      caregiverSignatureError: null,
      expectedCurrentStatuses: ["ready_to_send", "send_failed"]
    });
  } catch (error) {
    await throwDeliveryStateFinalizeFailure({
      entityType: "care_plan",
      entityId: input.carePlanId,
      actorUserId: input.actor.id,
      severity: "high",
      alertKey: "care_plan_delivery_state_finalize_failed",
      metadata: {
        member_id: detail.carePlan.memberId,
        caregiver_email: caregiverEmail,
        email_delivery_state: "email_sent_but_sent_state_not_persisted",
        error: error instanceof Error ? error.message : "Unable to finalize care plan delivery state."
      },
      message:
        "Care plan email was delivered, but the sent state could not be finalized. The signature link remains active in Ready to Send state. Review operational alerts before retrying."
    });
  }

  await createCarePlanSignatureEvent({
    carePlanId: input.carePlanId,
    memberId: detail.carePlan.memberId,
    eventType: "sent",
    actorType: "user",
    actorUserId: input.actor.id,
    actorName: input.actor.fullName,
    actorEmail: senderEmail
  });
  await recordWorkflowEvent({
    eventType: "care_plan_sent",
    entityType: "care_plan",
    entityId: input.carePlanId,
    actorType: "user",
    actorUserId: input.actor.id,
    status: "sent",
    severity: "low",
    metadata: {
      member_id: detail.carePlan.memberId,
      caregiver_email: caregiverEmail,
      sent_at: now,
      expires_at: expiresAt
    }
  });
  try {
    await recordWorkflowMilestone({
      event: {
        event_type: "care_plan_sent",
        entity_type: "care_plan",
        entity_id: input.carePlanId,
        actor_type: "user",
        actor_id: input.actor.id,
        actor_user_id: input.actor.id,
        status: "sent",
        severity: "low",
        metadata: {
          member_id: detail.carePlan.memberId,
          caregiver_email: caregiverEmail,
          sent_at: now,
          expires_at: expiresAt
        }
      }
    });
  } catch (error) {
    console.error("[care-plan-esign] unable to emit post-send workflow milestone", error);
  }

  return buildCommittedCarePlanSendResult({
    carePlan: detail.carePlan,
    caregiverName,
    caregiverEmail: validatedCaregiverEmail,
    actorUserId: input.actor.id,
    sentAt: now,
    expiresAt,
    signatureRequestUrl
  });
}
