import {
  facilityBranding,
  getFacilitySignatureLines,
  resolveFacilityLogoUrl
} from "@/lib/config/facility-branding";

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
  const subject = `Care Plan Signature Request - ${facilityBranding.facilityName}`;
  const expiresOn = formatExpirationDate(input.expiresAt);
  const optionalMessage = clean(input.optionalMessage);
  const signatureLines = getFacilitySignatureLines();
  const signatureHtml = signatureLines.map((line) => escapeHtml(line)).join("<br/>");
  const signatureText = signatureLines.join("\n");
  const caregiverName = escapeHtml(input.caregiverName);
  const nurseName = escapeHtml(input.nurseName);
  const memberName = escapeHtml(input.memberName);
  const requestUrl = escapeHtml(input.requestUrl);
  const facilityName = escapeHtml(facilityBranding.facilityName);
  const logoUrl = resolveFacilityLogoUrl();

  const html = `
    <div style="background:#f3f8fc;padding:24px;font-family:Arial,sans-serif;color:#0f172a;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d9e4ef;border-radius:14px;overflow:hidden;">
        ${logoUrl ? `
        <tr>
          <td style="padding:24px 24px 12px;">
            <img src="${escapeHtml(logoUrl)}" alt="${facilityName}" width="180" style="display:block;width:180px;max-width:100%;height:auto;"/>
          </td>
        </tr>
        ` : ""}
        <tr>
          <td style="padding:0 24px 0;">
            <h1 style="margin:0;font-size:24px;line-height:1.3;font-weight:700;color:#0f2943;">Care Plan Signature Request</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 24px 0;">
            <p style="margin:0 0 12px;font-size:16px;line-height:1.6;">Hello ${caregiverName},</p>
            <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">A care plan for the following member requires your review and signature.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:2px 24px 0;">
            <div style="background:#eef6ff;border:1px solid #c8ddf4;border-radius:10px;padding:14px 16px;">
              <p style="margin:0;font-size:12px;line-height:1.2;text-transform:uppercase;letter-spacing:0.06em;color:#45617c;">Member</p>
              <p style="margin:8px 0 0;font-size:20px;line-height:1.3;font-weight:700;color:#0f2943;">${memberName}</p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 24px 0;">
            <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">This request was sent by ${nurseName} from ${facilityName}.</p>
            <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Please review and sign the care plan securely using the link below.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 24px 0;">
            <a href="${requestUrl}" style="display:inline-block;background:#005f9f;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 18px;border-radius:8px;">Open Secure Care Plan</a>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 24px 0;">
            <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155;">This secure link expires on ${expiresOn}.</p>
            ${optionalMessage ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;"><strong>Additional message:</strong> ${escapeHtml(optionalMessage)}</p>` : ""}
            <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">If you have any questions regarding this request, please contact our team.</p>
            <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">Thank you,</p>
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
        ${requestUrl}
      </p>
    </div>
  `.trim();

  const text = [
    `Hello ${input.caregiverName},`,
    "A care plan for the following member requires your review and signature.",
    `Member: ${input.memberName}`,
    `This request was sent by ${input.nurseName} from ${facilityBranding.facilityName}.`,
    "Please review and sign the care plan securely using the link below.",
    "Open Secure Care Plan",
    input.requestUrl,
    `This secure link expires on ${expiresOn}.`,
    optionalMessage ? `Additional message: ${optionalMessage}` : null,
    "If you have any questions regarding this request, please contact our team.",
    "Thank you,",
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
