import { notFound } from "next/navigation";

import { ProgressNoteForm } from "@/components/progress-notes/progress-note-form";
import { Card, CardTitle } from "@/components/ui/card";
import { requireProgressNoteAuthorizedUser } from "@/lib/services/progress-note-authorization";
import { getProgressNoteById } from "@/lib/services/progress-notes";

export default async function ProgressNoteDetailPage({
  params
}: {
  params: Promise<{ noteId: string }>;
}) {
  await requireProgressNoteAuthorizedUser();
  const { noteId } = await params;
  const detail = await getProgressNoteById(noteId);
  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>{detail.note.status === "signed" ? "Signed Progress Note" : "Progress Note Draft"}</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Draft notes do not reset compliance. E-signing/finalizing immediately advances the next due date by 90 days and returns you to the tracker.
        </p>
      </Card>

      <Card>
        <ProgressNoteForm
          noteId={detail.note.id}
          memberId={detail.note.memberId}
          memberName={detail.note.memberName ?? "Member"}
          initialNoteDate={detail.note.noteDate}
          initialNoteBody={detail.note.noteBody}
          initialStatus={detail.note.status}
          signedAt={detail.note.signedAt}
          signedByName={detail.note.signedByName}
          hasStoredSignature={Boolean(detail.note.signatureBlob)}
          summary={
            detail.summary ?? {
              enrollmentDate: null,
              lastSignedProgressNoteDate: null,
              nextProgressNoteDueDate: null,
              complianceStatus: "data_issue",
              dataIssue: "Enrollment date missing"
            }
          }
          backHref={`/health/progress-notes?memberId=${detail.note.memberId}`}
          afterSignHref={`/health/progress-notes?memberId=${detail.note.memberId}`}
        />
      </Card>
    </div>
  );
}
