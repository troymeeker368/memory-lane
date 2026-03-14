import { headers } from "next/headers";

import { EnrollmentPacketPublicForm } from "@/components/enrollment-packets/enrollment-packet-public-form";
import { Card, CardTitle } from "@/components/ui/card";
import { getPublicEnrollmentPacketContext } from "@/lib/services/enrollment-packets";

export default async function PublicEnrollmentPacketPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const headerMap = await headers();
  const forwardedFor = headerMap.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
  const userAgent = headerMap.get("user-agent");
  const context = await getPublicEnrollmentPacketContext(token, { ip, userAgent });

  if (context.state === "invalid") {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Card>
          <CardTitle>Invalid Enrollment Packet Link</CardTitle>
          <p className="mt-2 text-sm text-muted">This enrollment packet link is invalid. Contact your care team for a new secure link.</p>
        </Card>
      </div>
    );
  }

  if (context.state === "expired") {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Card>
          <CardTitle>Enrollment Packet Link Expired</CardTitle>
          <p className="mt-2 text-sm text-muted">This secure link has expired. Contact your care team for a new enrollment packet link.</p>
        </Card>
      </div>
    );
  }

  if (context.state === "completed") {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Card>
          <CardTitle>Enrollment Packet Already Submitted</CardTitle>
          <p className="mt-2 text-sm text-muted">This enrollment packet has already been completed. You may close this page.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <Card>
        <CardTitle>Enrollment Packet for {context.memberName}</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Complete each enrollment section, upload insurance/legal documents, and sign electronically. No login is required.
        </p>
      </Card>
      <Card>
        <EnrollmentPacketPublicForm token={token} fields={context.fields} />
      </Card>
    </div>
  );
}
