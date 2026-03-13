import { NextResponse } from "next/server";
import { Resend } from "resend";

import { getConfiguredClinicalSenderEmail, getPofRuntimeDiagnostics } from "@/lib/services/pof-esign";

export async function GET() {
  const diagnostics = getPofRuntimeDiagnostics({ requireResend: true });
  if ((process.env.NODE_ENV ?? "").toLowerCase() !== "production") {
    console.info("[POF e-sign diagnostics:api-test-email]", {
      hasResendApiKey: diagnostics.hasResendApiKey,
      hasClinicalSenderEmail: diagnostics.hasClinicalSenderEmail,
      hasSupabaseServiceRoleKey: diagnostics.hasSupabaseServiceRoleKey
    });
  }

  if (diagnostics.missing.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `Missing required environment configuration: ${diagnostics.missing.join(", ")}.`,
        diagnostics
      },
      { status: 500 }
    );
  }

  try {
    const clinicalSenderEmail = getConfiguredClinicalSenderEmail();
    const resend = new Resend(process.env.RESEND_API_KEY);
    const response = await resend.emails.send({
      from: `Memory Lane <${clinicalSenderEmail}>`,
      to: ["delivered@resend.dev"],
      subject: "Memory Lane Email Test",
      html: "<p>Email system working</p>"
    });
    if (response.error) {
      throw new Error(response.error.message);
    }
    return NextResponse.json({
      ok: true,
      messageId: response.data?.id ?? null
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to send test email."
      },
      { status: 500 }
    );
  }
}
