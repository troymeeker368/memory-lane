import {
  DOCUMENT_CENTER_NAME,
  getDocumentCenterSignatureHtml,
  getDocumentCenterSignatureText
} from "@/lib/services/document-branding";

type BuildCarePlanSignatureRequestTemplateInput = {
  caregiverName: string;
  nurseName: string;
  memberName: string;
  requestUrl: string;
  expiresAt: string;
  optionalMessage?: string | null;
};

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatExpirationDate(expiresAt: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York"
  }).format(new Date(expiresAt));
}

export function buildCarePlanSignatureRequestTemplate(input: BuildCarePlanSignatureRequestTemplateInput) {
  const subject = `${DOCUMENT_CENTER_NAME} Care Plan Signature Request for ${input.memberName}`;
  const expiresOn = formatExpirationDate(input.expiresAt);
  const optionalMessage = clean(input.optionalMessage);
  const caregiverName = escapeHtml(input.caregiverName);
  const nurseName = escapeHtml(input.nurseName);
  const requestUrl = escapeHtml(input.requestUrl);

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;">
      <p style="margin:0 0 12px;">Hello ${caregiverName},</p>
      <p style="margin:0 0 12px;">${nurseName} sent a care plan for your review and signature.</p>
      ${optionalMessage ? `<p style="margin:0 0 12px;"><strong>Message from care team:</strong> ${escapeHtml(optionalMessage)}</p>` : ""}
      <p style="margin:0 0 16px;">
        <a href="${requestUrl}" style="display:inline-block;background:#005f9f;color:#ffffff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:8px;">
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

  return {
    subject,
    html,
    text
  };
}
