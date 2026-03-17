import { getEnrollmentPacketSenderSignatureProfileAction } from "@/app/sales-enrollment-actions";
import { EnrollmentPacketSignatureSetup } from "@/components/sales/enrollment-packet-signature-setup";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function EnrollmentSignatureSetupPage() {
  await requireModuleAccess("sales");
  const existing = await getEnrollmentPacketSenderSignatureProfileAction();
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Enrollment Packet Signature Setup</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Configure your saved admin signature before sending enrollment packets.
        </p>
      </Card>
      <Card>
        <EnrollmentPacketSignatureSetup
          initialSignatureName={existing?.signatureName ?? ""}
          initialSignatureImageDataUrl={existing?.signatureImageDataUrl ?? null}
        />
      </Card>
    </div>
  );
}
