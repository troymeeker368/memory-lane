import "server-only";

import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import { buildCarePlanPdfDataUrl } from "@/lib/services/care-plan-pdf";
import {
  DOCUMENT_CENTER_NAME,
  getDocumentCenterSignatureHtml,
  getDocumentCenterSignatureText
} from "@/lib/services/document-branding";
import {
  canSendCaregiverSignatureByNurseSignatureState,
  resolvePublicCaregiverLinkState
} from "@/lib/services/care-plan-esign-rules";
import { getCarePlanById, type CaregiverSignatureStatus, type CarePlan } from "@/lib/services/care-plans";
import { logSystemEvent } from "@/lib/services/system-event-service";

const STORAGE_BUCKET = "member-documents";
const TOKEN_BYTE_LENGTH = 32;

export type CarePlanSignatureEventType =
  | "sent"
  | "send_failed"
  | "opened"
  | "signed"
  | "expired";

export type PublicCarePlanSigningContext =
  | { state: "invalid" }
  | { state: "expired"; carePlan: CarePlan }
  | { state: "completed"; carePlan: CarePlan }
  | { state: "ready"; detail: NonNullable<Awaited<ReturnType<typeof getCarePlanById>>> };

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

type SubmitPublicCarePlanSignatureInput = {
  token: string;
  caregiverTypedName: string;
  signatureImageDataUrl: string;
  attested: boolean;
  caregiverIp: string | null;
  caregiverUserAgent: string | null;
};

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

function parseDataUrl(dataUrl: string) {
  const normalized = dataUrl.trim();
  const match = /^data:([^;]+);base64,(.+)$/.exec(normalized);
  if (!match) throw new Error("Invalid data URL payload.");
  return {
    contentType: match[1],
    bytes: Buffer.from(match[2], "base64")
  };
}

function getStorageUri(path: string) {
  return `storage://${STORAGE_BUCKET}/${path}`;
}

function parseStorageUri(uri: string | null | undefined) {
  const normalized = clean(uri);
  if (!normalized) return null;
  const prefix = `storage://${STORAGE_BUCKET}/`;
  if (!normalized.startsWith(prefix)) return null;
  return normalized.slice(prefix.length);
}

function nextMemberFileId() {
  return `mf_${randomUUID().replace(/-/g, "")}`;
}

async function uploadToStorage(input: { objectPath: string; bytes: Buffer; contentType: string }) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage.from(STORAGE_BUCKET).upload(input.objectPath, input.bytes, {
    contentType: input.contentType,
    upsert: true
  });
  if (error) throw new Error(error.message);
  return getStorageUri(input.objectPath);
}

async function createCarePlanSignatureEvent(input: {
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
  if (error) throw new Error(error.message);
}

async function loadCarePlanRowByToken(token: string) {
  const hashed = hashToken(token);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("care_plans")
    .select("id, member_id, caregiver_signature_status, caregiver_signature_expires_at")
    .eq("caregiver_signature_request_token", hashed)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; member_id: string; caregiver_signature_status: CaregiverSignatureStatus; caregiver_signature_expires_at: string | null } | null;
}

async function markExpiredIfNeeded(input: {
  carePlanId: string;
  memberId: string;
  status: CaregiverSignatureStatus;
  expiresAt: string | null;
}) {
  if (input.status === "signed" || input.status === "expired") return input.status;
  if (resolvePublicCaregiverLinkState({ status: input.status, expiresAt: input.expiresAt }) !== "expired") {
    return input.status;
  }

  const now = toEasternISO();
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("care_plans")
    .update({
      caregiver_signature_status: "expired",
      updated_at: now
    })
    .eq("id", input.carePlanId);
  if (error) throw new Error(error.message);
  await createCarePlanSignatureEvent({
    carePlanId: input.carePlanId,
    memberId: input.memberId,
    eventType: "expired",
    actorType: "system"
  });
  return "expired" as const;
}

export function canSendCaregiverSignature(plan: CarePlan) {
  return canSendCaregiverSignatureByNurseSignatureState({
    nurseSignatureStatus: plan.nurseSignatureStatus,
    nurseSignedAt: plan.nurseSignedAt
  });
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

  const subject = `${DOCUMENT_CENTER_NAME} Care Plan Signature Request for ${input.memberName}`;
  const expiresOn = input.expiresAt.slice(0, 10);
  const optionalMessage = clean(input.optionalMessage);
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;">
      <p style="margin:0 0 12px;">Hello ${input.caregiverName},</p>
      <p style="margin:0 0 12px;">${input.nurseName} sent a care plan for your review and signature.</p>
      ${optionalMessage ? `<p style="margin:0 0 12px;"><strong>Message from care team:</strong> ${optionalMessage}</p>` : ""}
      <p style="margin:0 0 16px;">
        <a href="${input.requestUrl}" style="display:inline-block;background:#005f9f;color:#ffffff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:8px;">
          Open Secure Care Plan
        </a>
      </p>
      <p style="margin:0 0 12px;">This secure link expires on ${expiresOn}.</p>
      <p style="margin:0;">Thank you,</p>
      <p style="margin:0;">${getDocumentCenterSignatureHtml()}</p>
    </div>
  `.trim();

  const text = [
    `Hello ${input.caregiverName},`,
    `${input.nurseName} sent a care plan for your review and signature.`,
    optionalMessage ? `Message: ${optionalMessage}` : null,
    `Sign securely: ${input.requestUrl}`,
    `This secure link expires on ${expiresOn}.`,
    "Thank you,",
    getDocumentCenterSignatureText()
  ]
    .filter(Boolean)
    .join("\n");

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
  if (!isEmail(caregiverEmail)) throw new Error("Caregiver email is invalid.");

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
  const admin = createSupabaseAdminClient();

  try {
    await sendSignatureEmail({
      toEmail: caregiverEmail!,
      caregiverName: caregiverName,
      nurseName: input.actor.signatureName,
      fromEmail: senderEmail,
      requestUrl: signatureRequestUrl,
      expiresAt,
      memberName: detail.carePlan.memberName,
      optionalMessage: input.optionalMessage ?? null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email failure.";
    await admin
      .from("care_plans")
      .update({
        caregiver_name: caregiverName,
        caregiver_email: caregiverEmail,
        caregiver_signature_status: "send_failed",
        caregiver_signature_error: message,
        updated_by_user_id: input.actor.id,
        updated_by_name: input.actor.fullName,
        updated_at: now
      })
      .eq("id", input.carePlanId);
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
    throw error;
  }

  const { error: updateError } = await admin
    .from("care_plans")
    .update({
      caregiver_name: caregiverName,
      caregiver_email: caregiverEmail,
      caregiver_signature_status: "sent",
      caregiver_sent_at: now,
      caregiver_sent_by_user_id: input.actor.id,
      caregiver_viewed_at: null,
      caregiver_signed_at: null,
      caregiver_signature_request_token: hashedToken,
      caregiver_signature_expires_at: expiresAt,
      caregiver_signature_request_url: signatureRequestUrl,
      caregiver_signed_name: null,
      caregiver_signature_image_url: null,
      caregiver_signature_ip: null,
      caregiver_signature_user_agent: null,
      caregiver_signature_error: null,
      final_member_file_id: null,
      updated_by_user_id: input.actor.id,
      updated_by_name: input.actor.fullName,
      updated_at: now
    })
    .eq("id", input.carePlanId);
  if (updateError) throw new Error(updateError.message);

  await createCarePlanSignatureEvent({
    carePlanId: input.carePlanId,
    memberId: detail.carePlan.memberId,
    eventType: "sent",
    actorType: "user",
    actorUserId: input.actor.id,
    actorName: input.actor.fullName,
    actorEmail: senderEmail
  });

  const refreshed = await getCarePlanById(input.carePlanId);
  if (!refreshed) throw new Error("Care plan could not be loaded after send.");
  return refreshed.carePlan;
}

export async function getPublicCarePlanSigningContext(
  token: string,
  metadata?: { ip?: string | null; userAgent?: string | null }
): Promise<PublicCarePlanSigningContext> {
  const normalizedToken = clean(token);
  if (!normalizedToken) return { state: "invalid" };
  const tokenRow = await loadCarePlanRowByToken(normalizedToken);
  if (!tokenRow) return { state: "invalid" };

  const resolvedStatus = await markExpiredIfNeeded({
    carePlanId: tokenRow.id,
    memberId: tokenRow.member_id,
    status: tokenRow.caregiver_signature_status,
    expiresAt: tokenRow.caregiver_signature_expires_at
  });
  const linkState = resolvePublicCaregiverLinkState({
    status: resolvedStatus,
    expiresAt: tokenRow.caregiver_signature_expires_at
  });

  const detail = await getCarePlanById(tokenRow.id, { serviceRole: true });
  if (!detail) return { state: "invalid" };
  if (linkState === "expired") return { state: "expired", carePlan: detail.carePlan };
  if (linkState === "completed") return { state: "completed", carePlan: detail.carePlan };
  if (linkState !== "ready") return { state: "invalid" };

  if (!detail.carePlan.caregiverViewedAt) {
    const now = toEasternISO();
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("care_plans")
      .update({
        caregiver_signature_status: "viewed",
        caregiver_viewed_at: now,
        updated_at: now
      })
      .eq("id", detail.carePlan.id);
    if (error) throw new Error(error.message);
    await createCarePlanSignatureEvent({
      carePlanId: detail.carePlan.id,
      memberId: detail.carePlan.memberId,
      eventType: "opened",
      actorType: "caregiver",
      actorEmail: detail.carePlan.caregiverEmail,
      actorName: detail.carePlan.caregiverName,
      actorIp: metadata?.ip ?? null,
      actorUserAgent: metadata?.userAgent ?? null
    });
  }

  const refreshed = await getCarePlanById(tokenRow.id, { serviceRole: true });
  if (!refreshed) return { state: "invalid" };
  return { state: "ready", detail: refreshed };
}

async function upsertFinalSignedMemberFile(input: {
  carePlanId: string;
  memberId: string;
  memberName: string;
  dataUrl: string;
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  signedPdfStorageUri: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const now = toEasternISO();
  const fileName = `Care Plan Final Signed - ${input.memberName} - ${toEasternDate(now)}.pdf`;
  const documentSource = `Care Plan Final Signed:${input.carePlanId}`;

  const { data: existing, error: existingError } = await admin
    .from("member_files")
    .select("id")
    .eq("member_id", input.memberId)
    .eq("document_source", documentSource)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (existing) {
    const { error: updateError } = await admin
      .from("member_files")
      .update({
        file_name: fileName,
        file_type: "application/pdf",
        file_data_url: input.dataUrl,
        storage_object_path: parseStorageUri(input.signedPdfStorageUri),
        category: "Care Plan",
        category_other: null,
        document_source: documentSource,
        care_plan_id: input.carePlanId,
        uploaded_by_user_id: input.uploadedByUserId,
        uploaded_by_name: input.uploadedByName,
        uploaded_at: now,
        updated_at: now
      })
      .eq("id", existing.id);
    if (updateError) throw new Error(updateError.message);
    return String(existing.id);
  }

  const memberFileId = nextMemberFileId();
  const { error: insertError } = await admin.from("member_files").insert({
    id: memberFileId,
    member_id: input.memberId,
    file_name: fileName,
    file_type: "application/pdf",
    file_data_url: input.dataUrl,
    storage_object_path: parseStorageUri(input.signedPdfStorageUri),
    category: "Care Plan",
    category_other: null,
    document_source: documentSource,
    care_plan_id: input.carePlanId,
    uploaded_by_user_id: input.uploadedByUserId,
    uploaded_by_name: input.uploadedByName,
    uploaded_at: now,
    updated_at: now
  });
  if (insertError) throw new Error(insertError.message);
  return memberFileId;
}

export async function submitPublicCarePlanSignature(input: SubmitPublicCarePlanSignatureInput) {
  const token = clean(input.token);
  const caregiverTypedName = clean(input.caregiverTypedName);
  if (!token) throw new Error("Signature token is required.");
  if (!caregiverTypedName) throw new Error("Typed caregiver name is required.");
  if (!input.attested) throw new Error("Attestation is required before signing.");

  const signature = parseDataUrl(input.signatureImageDataUrl);
  if (!signature.contentType.startsWith("image/")) {
    throw new Error("Signature image format is invalid.");
  }

  const tokenRow = await loadCarePlanRowByToken(token);
  if (!tokenRow) throw new Error("This signature link is invalid.");
  const status = await markExpiredIfNeeded({
    carePlanId: tokenRow.id,
    memberId: tokenRow.member_id,
    status: tokenRow.caregiver_signature_status,
    expiresAt: tokenRow.caregiver_signature_expires_at
  });
  if (status === "expired") throw new Error("This signature link has expired.");
  if (status === "signed") throw new Error("This signature link has already been used.");
  if (status !== "sent" && status !== "viewed") throw new Error("This signature link is not active.");

  const detail = await getCarePlanById(tokenRow.id, { serviceRole: true });
  if (!detail) throw new Error("Care plan was not found.");

  const now = toEasternISO();
  const day = toEasternDate(now);
  const signaturePath = `members/${detail.carePlan.memberId}/care-plans/${detail.carePlan.id}/caregiver-signature.png`;
  const signatureUri = await uploadToStorage({
    objectPath: signaturePath,
    bytes: signature.bytes,
    contentType: signature.contentType
  });

  const admin = createSupabaseAdminClient();
  const { error: signatureDraftError } = await admin
    .from("care_plans")
    .update({
      caregiver_signed_name: caregiverTypedName,
      caregiver_signature_image_url: signatureUri,
      caregiver_signature_ip: clean(input.caregiverIp),
      caregiver_signature_user_agent: clean(input.caregiverUserAgent),
      caregiver_signature_error: null,
      responsible_party_signature: caregiverTypedName,
      responsible_party_signature_date: day,
      updated_at: now
    })
    .eq("id", detail.carePlan.id);
  if (signatureDraftError) throw new Error(signatureDraftError.message);

  try {
    const generated = await buildCarePlanPdfDataUrl(detail.carePlan.id, { serviceRole: true });
    const parsedPdf = parseDataUrl(generated.dataUrl);
    const signedPdfStoragePath = `members/${detail.carePlan.memberId}/care-plans/${detail.carePlan.id}/final-signed.pdf`;
    const signedPdfStorageUri = await uploadToStorage({
      objectPath: signedPdfStoragePath,
      bytes: parsedPdf.bytes,
      contentType: "application/pdf"
    });

    const finalMemberFileId = await upsertFinalSignedMemberFile({
      carePlanId: detail.carePlan.id,
      memberId: detail.carePlan.memberId,
      memberName: detail.carePlan.memberName,
      dataUrl: generated.dataUrl,
      uploadedByUserId: detail.carePlan.nurseSignedByUserId ?? detail.carePlan.nurseDesigneeUserId,
      uploadedByName: detail.carePlan.nurseSignedByName ?? detail.carePlan.nurseDesigneeName,
      signedPdfStorageUri
    });

    const rotatedToken = hashToken(generateSigningToken());
    const { error: finalLinkError } = await admin
      .from("care_plans")
      .update({
        caregiver_signature_status: "signed",
        caregiver_signed_at: now,
        caregiver_signature_request_token: rotatedToken,
        caregiver_signature_request_url: null,
        final_member_file_id: finalMemberFileId,
        updated_at: toEasternISO()
      })
      .eq("id", detail.carePlan.id);
    if (finalLinkError) throw new Error(finalLinkError.message);

    await createCarePlanSignatureEvent({
      carePlanId: detail.carePlan.id,
      memberId: detail.carePlan.memberId,
      eventType: "signed",
      actorType: "caregiver",
      actorName: caregiverTypedName,
      actorEmail: detail.carePlan.caregiverEmail,
      actorIp: clean(input.caregiverIp),
      actorUserAgent: clean(input.caregiverUserAgent),
      metadata: {
        finalMemberFileId,
        signatureImageUrl: signatureUri
      }
    });

    await logSystemEvent({
      event_type: "care_plan_caregiver_signed",
      entity_type: "care_plan",
      entity_id: detail.carePlan.id,
      actor_type: "caregiver",
      metadata: {
        member_id: detail.carePlan.memberId,
        final_member_file_id: finalMemberFileId,
        caregiver_email: detail.carePlan.caregiverEmail,
        signature_image_url: signatureUri
      }
    });

    return {
      carePlanId: detail.carePlan.id,
      memberId: detail.carePlan.memberId,
      finalMemberFileId
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to complete care plan filing.";
    await admin
      .from("care_plans")
      .update({
        caregiver_signature_error: reason,
        updated_at: toEasternISO()
      })
      .eq("id", detail.carePlan.id);
    throw error;
  }
}
