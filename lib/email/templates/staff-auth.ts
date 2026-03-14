import {
  facilityBranding,
  getFacilitySignatureLines,
  resolveFacilityLogoUrl
} from "@/lib/config/facility-branding";

type BuildStaffAuthEmailTemplateInput = {
  recipientName?: string | null;
  actionUrl: string;
  mode: "set-password" | "reset-password";
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

export function buildStaffAuthEmailTemplate(input: BuildStaffAuthEmailTemplateInput) {
  const recipientName = clean(input.recipientName) ?? "Team Member";
  const actionLabel = input.mode === "set-password" ? "Set Your Password" : "Reset Your Password";
  const introTitle = input.mode === "set-password" ? "Staff Portal Access Setup" : "Staff Portal Password Reset";
  const subject =
    input.mode === "set-password"
      ? `Set Your Password - ${facilityBranding.facilityName}`
      : `Reset Your Password - ${facilityBranding.facilityName}`;
  const signatureLines = getFacilitySignatureLines();
  const signatureHtml = signatureLines.map((line) => escapeHtml(line)).join("<br/>");
  const signatureText = signatureLines.join("\n");
  const logoUrl = resolveFacilityLogoUrl();
  const actionUrlEscaped = escapeHtml(input.actionUrl);

  const html = `
    <div style="background:#f3f8fc;padding:24px;font-family:Arial,sans-serif;color:#0f172a;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d9e4ef;border-radius:14px;overflow:hidden;">
        ${
          logoUrl
            ? `<tr><td style="padding:24px 24px 12px;"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(
                facilityBranding.facilityName
              )}" width="180" style="display:block;width:180px;max-width:100%;height:auto;"/></td></tr>`
            : ""
        }
        <tr>
          <td style="padding:0 24px 0;">
            <h1 style="margin:0;font-size:24px;line-height:1.3;font-weight:700;color:#0f2943;">${escapeHtml(introTitle)}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 24px 0;">
            <p style="margin:0 0 12px;font-size:16px;line-height:1.6;">Hello ${escapeHtml(recipientName)},</p>
            <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
              ${
                input.mode === "set-password"
                  ? `Your staff account is ready. Use the secure link below to set your password and activate your access to ${escapeHtml(
                      facilityBranding.facilityName
                    )}.`
                  : `A password reset was requested for your staff account. Use the secure link below to choose a new password.`
              }
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 24px 0;">
            <a href="${actionUrlEscaped}" style="display:inline-block;background:#005f9f;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 18px;border-radius:8px;">${escapeHtml(
              actionLabel
            )}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 24px 0;">
            <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155;">
              This link is single-use and expires automatically for your security.
            </p>
            <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">
              If you did not expect this email, please contact your administrator.
            </p>
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
        ${actionUrlEscaped}
      </p>
    </div>
  `.trim();

  const text = [
    `Hello ${recipientName},`,
    "",
    input.mode === "set-password"
      ? `Your staff account is ready. Use the secure link below to set your password and activate your access to ${facilityBranding.facilityName}.`
      : "A password reset was requested for your staff account. Use the secure link below to choose a new password.",
    "",
    `${actionLabel}:`,
    input.actionUrl,
    "",
    "This link is single-use and expires automatically for your security.",
    "If you did not expect this email, please contact your administrator.",
    "",
    signatureText
  ].join("\n");

  return {
    subject,
    html,
    text,
    fromDisplayName: facilityBranding.facilityName
  };
}
