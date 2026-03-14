import { headers } from "next/headers";

import { DocumentBrandHeader } from "@/components/documents/document-brand-header";
import { PofDocumentRender } from "@/components/physician-orders/pof-document-render";
import { PofPublicSignForm } from "@/components/physician-orders/pof-public-sign-form";
import { Card, CardTitle } from "@/components/ui/card";
import { getPublicPofSigningContext } from "@/lib/services/pof-esign";
import { formatDateTime } from "@/lib/utils";

export default async function PublicPofSigningPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const headersList = await headers();
  const forwardedFor = headersList.get("x-forwarded-for");
  const providerIp = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
  const providerUserAgent = headersList.get("user-agent");
  const context = await getPublicPofSigningContext(token, {
    ip: providerIp,
    userAgent: providerUserAgent
  });

  if (context.state === "invalid") {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <DocumentBrandHeader title="Physician Order Form Signature" />
        <Card>
          <CardTitle>Invalid Signature Link</CardTitle>
          <p className="mt-2 text-sm text-muted">This POF signing link is invalid. Contact your care team for a new link.</p>
        </Card>
      </div>
    );
  }

  if (context.state === "expired") {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <DocumentBrandHeader title="Physician Order Form Signature" />
        <Card>
          <CardTitle>Signature Link Expired</CardTitle>
          <p className="mt-2 text-sm text-muted">
            This signing request expired on {formatDateTime(context.request.expiresAt)}. Contact your care team for a new link.
          </p>
        </Card>
      </div>
    );
  }

  if (context.state === "declined") {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <DocumentBrandHeader title="Physician Order Form Signature" />
        <Card>
          <CardTitle>Signature Request Voided</CardTitle>
          <p className="mt-2 text-sm text-muted">This signing request was voided. Contact your care team for guidance.</p>
        </Card>
      </div>
    );
  }

  if (context.state === "signed") {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <DocumentBrandHeader title="Physician Order Form Signature" />
        <Card>
          <CardTitle>Already Signed</CardTitle>
          <p className="mt-2 text-sm text-muted">This POF was already signed on {context.request.signedAt ? formatDateTime(context.request.signedAt) : "a previous date"}.</p>
        </Card>
      </div>
    );
  }

  const { pofPayload, request } = context;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <DocumentBrandHeader
        title="Physician Order Form Signature"
        metaLines={[
          `Provider: ${request.providerName}`,
          `Expires: ${formatDateTime(request.expiresAt)}`
        ]}
      />
      <Card>
        <CardTitle>Physician Order Form Signature</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Member: <span className="font-semibold text-primary-text">{pofPayload.memberNameSnapshot}</span> | Expires:{" "}
          {formatDateTime(request.expiresAt)}
        </p>
      </Card>

      <PofDocumentRender
        form={pofPayload}
        title="Physician Order Form Review"
        metaLines={[
          `Provider: ${request.providerName}`,
          `Sent: ${request.sentAt ? formatDateTime(request.sentAt) : "-"}`,
          `Expires: ${formatDateTime(request.expiresAt)}`
        ]}
      />

      <Card>
        <CardTitle>Sign POF</CardTitle>
        <div className="mt-3">
          <PofPublicSignForm token={token} providerNameDefault={request.providerName} />
        </div>
      </Card>
    </div>
  );
}
