import { NextResponse } from "next/server";

import { MEMBER_DOCUMENTS_BUCKET, safeFileName } from "@/lib/services/member-files";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function buildAttachmentDisposition(fileName: string) {
  const normalized = safeFileName(fileName) || "enrollment-packet.pdf";
  return `attachment; filename="${normalized.replace(/"/g, "")}"`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  try {
    const { getPublicCompletedEnrollmentPacketArtifact } = await import("@/lib/services/enrollment-packets-public");
    const artifact = await getPublicCompletedEnrollmentPacketArtifact({ token });
    const admin = createSupabaseAdminClient("enrollment_packet_artifact_download");
    const { data, error } = await admin.storage
      .from(MEMBER_DOCUMENTS_BUCKET)
      .download(artifact.objectPath);
    if (error || !data) {
      throw new Error(error?.message ?? "Completed enrollment packet PDF download failed.");
    }

    return new NextResponse(data, {
      headers: {
        "Content-Type": artifact.fileType,
        "Content-Disposition": buildAttachmentDisposition(artifact.fileName),
        "Cache-Control": "private, no-store, max-age=0"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Completed enrollment packet PDF is unavailable.";
    const status =
      message.includes("not available") || message.includes("could not be found") || message.includes("invalid")
        ? 404
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
