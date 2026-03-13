import {
  facilityBranding,
  getFacilitySignatureLines,
  resolveFacilityLogoUrl
} from "@/lib/config/facility-branding";

type BuildEnrollmentPacketTemplateInput = {
  recipientName: string;
  memberName: string;
  requestUrl: string;
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

// Recipient-facing enrollment emails must use facility branding and must not expose internal platform names.
export function buildEnrollmentPacketTemplate(input: BuildEnrollmentPacketTemplateInput) {
  const recipientName = clean(input.recipientName) ?? "Family Member";
  const optionalMessage = clean(input.optionalMessage);
  const signatureLines = getFacilitySignatureLines();
  const signatureHtml = signatureLines.map((line) => escapeHtml(line)).join("<br/>");
  const signatureText = signatureLines.join("\n");
  const logoUrl = resolveFacilityLogoUrl();

  const subject = `Enrollment Packet - ${facilityBranding.facilityName}`;
  const memberNameEscaped = escapeHtml(input.memberName);
  const recipientNameEscaped = escapeHtml(recipientName);
  const requestUrlEscaped = escapeHtml(input.requestUrl);
  const facilityNameEscaped = escapeHtml(facilityBranding.facilityName);

  const html = `
    <div style="background:#f3f8fc;padding:24px;font-family:Arial,sans-serif;color:#0f172a;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d9e4ef;border-radius:14px;overflow:hidden;">
        ${logoUrl ? `
        <tr>
          <td style="padding:24px 24px 12px;">
            <img src="${escapeHtml(logoUrl)}" alt="${facilityNameEscaped}" width="180" style="display:block;width:180px;max-width:100%;height:auto;"/>
          </td>
        </tr>
        ` : ""}
        <tr>
          <td style="padding:0 24px 0;">
            <h1 style="margin:0;font-size:24px;line-height:1.3;font-weight:700;color:#0f2943;">Enrollment Packet</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 24px 0;">
            <p style="margin:0 0 12px;font-size:16px;line-height:1.6;">Hello ${recipientNameEscaped},</p>
            <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Thank you for your interest in ${facilityNameEscaped}. We are excited to begin the enrollment process and look forward to getting to know you and your loved one.</p>
            <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">To move forward, please review and complete the enrollment packet using the secure link below.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:2px 24px 0;">
            <div style="background:#eef6ff;border:1px solid #c8ddf4;border-radius:10px;padding:14px 16px;">
              <p style="margin:0;font-size:12px;line-height:1.2;text-transform:uppercase;letter-spacing:0.06em;color:#45617c;">Member</p>
              <p style="margin:8px 0 0;font-size:20px;line-height:1.3;font-weight:700;color:#0f2943;">${memberNameEscaped}</p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px 0;">
            <a href="${requestUrlEscaped}" style="display:inline-block;background:#005f9f;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 18px;border-radius:8px;">Open Enrollment Packet</a>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 24px 0;">
            <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">The packet includes important forms that help our team understand your loved one&apos;s needs so we can provide the most supportive and personalized experience possible.</p>
            ${optionalMessage ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;"><strong>Additional message:</strong> ${escapeHtml(optionalMessage)}</p>` : ""}
            <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">If you have any questions while completing the forms, please feel free to contact us and we will be happy to assist you.</p>
            <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">We look forward to welcoming you to ${facilityNameEscaped}.</p>
            <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Warm regards,</p>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 24px 24px;border-top:1px solid #d9e4ef;background:#f8fbff;font-size:13px;line-height:1.6;color:#334155;">
            ${signatureHtml}
          </td>
        </tr>
      </table>
      <p style="max-width:640px;margin:12px auto 0;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">
        If the button does not open, copy and paste this secure link into your browser:<br/>
        ${requestUrlEscaped}
      </p>
    </div>
  `.trim();

  const text = [
    `Hello ${recipientName},`,
    "",
    `Thank you for your interest in ${facilityBranding.facilityName}. We are excited to begin the enrollment process and look forward to getting to know you and your loved one.`,
    "",
    "To move forward, please review and complete the enrollment packet using the secure link below.",
    "",
    `Member: ${input.memberName}`,
    "",
    "Open Enrollment Packet:",
    input.requestUrl,
    "",
    "The packet includes important forms that help our team understand your loved one's needs so we can provide the most supportive and personalized experience possible.",
    optionalMessage ? `Additional message: ${optionalMessage}` : null,
    "If you have any questions while completing the forms, please feel free to contact us and we will be happy to assist you.",
    `We look forward to welcoming you to ${facilityBranding.facilityName}.`,
    "",
    "Warm regards,",
    "",
    signatureText
  ]
    .filter(Boolean)
    .join("\n");

  return {
    subject,
    html,
    text,
    fromDisplayName: facilityBranding.facilityName
  };
}
