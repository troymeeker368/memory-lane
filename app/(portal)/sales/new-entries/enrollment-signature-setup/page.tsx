import { EnrollmentPacketSignatureSetup } from "@/components/sales/enrollment-packet-signature-setup";
import { Card, CardTitle } from "@/components/ui/card";
import { getCurrentProfile, requireModuleAccess } from "@/lib/auth";
import { getEnrollmentPacketSenderSignatureProfile } from "@/lib/services/enrollment-packets-sender";

export const dynamic = "force-dynamic";

export default async function EnrollmentSignatureSetupPage() {
  await requireModuleAccess("sales");
  const profile = await getCurrentProfile();
  const existing = await getEnrollmentPacketSenderSignatureProfile(profile.id);
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
          initialSignatureName={existing?.signature_name ?? ""}
          initialSignatureImageDataUrl={existing?.signature_blob ?? null}
        />
      </Card>
    </div>
  );
}
