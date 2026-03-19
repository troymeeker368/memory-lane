"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { saveProgressNoteDraftAction, signProgressNoteAction } from "@/app/progress-note-actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { EsignaturePad } from "@/components/signature/esignature-pad";
import { ProgressNoteStatusBadge } from "@/components/progress-notes/progress-note-status-badge";
import { MutationNotice } from "@/components/ui/mutation-notice";
import { getProgressNoteComplianceLabel, type ProgressNoteComplianceStatus } from "@/lib/services/progress-note-model";
import { formatDate, formatDateTime } from "@/lib/utils";

type Summary = {
  enrollmentDate: string | null;
  lastSignedProgressNoteDate: string | null;
  nextProgressNoteDueDate: string | null;
  complianceStatus: ProgressNoteComplianceStatus;
  dataIssue: string | null;
};

export function ProgressNoteForm({
  memberId,
  memberName,
  noteId,
  initialNoteDate,
  initialNoteBody,
  initialStatus,
  signedAt,
  signedByName,
  hasStoredSignature = false,
  summary,
  backHref = "/health/progress-notes",
  afterSignHref
}: {
  memberId: string;
  memberName: string;
  noteId?: string | null;
  initialNoteDate: string;
  initialNoteBody: string;
  initialStatus: "draft" | "signed";
  signedAt?: string | null;
  signedByName?: string | null;
  hasStoredSignature?: boolean;
  summary: Summary | null;
  backHref?: string;
  afterSignHref?: string;
}) {
  const router = useRouter();
  const { isSaving, run } = useScopedMutation();
  const [noteDate, setNoteDate] = useState(initialNoteDate);
  const [noteBody, setNoteBody] = useState(initialNoteBody);
  const [signatureAttested, setSignatureAttested] = useState(false);
  const [signatureImageDataUrl, setSignatureImageDataUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const isSigned = initialStatus === "signed";
  const signRedirectHref = afterSignHref ?? backHref;

  function payload() {
    return {
      noteId: noteId ?? "",
      memberId,
      noteDate,
      noteBody
    };
  }

  function saveDraft() {
    setNotice(null);
    void run(async () => saveProgressNoteDraftAction(payload()), {
      successMessage: "Progress note draft saved.",
      fallbackData: { id: "", memberId: "" },
      onSuccess: async (result) => {
        setNotice({ kind: "success", message: result.message });
        if (!noteId && result.data?.id) {
          router.replace(`/health/progress-notes/${result.data.id}`);
          router.refresh();
          return;
        }
        router.refresh();
      },
      onError: async (result) => {
        setNotice({ kind: "error", message: result.error });
      }
    });
  }

  function signNote() {
    setNotice(null);
    void run(
      async () =>
        signProgressNoteAction({
          ...payload(),
          signatureAttested,
          signatureImageDataUrl: signatureImageDataUrl ?? ""
        }),
      {
        successMessage: "Progress note signed.",
        fallbackData: { id: "", memberId: "", status: "draft" },
        onSuccess: async (result) => {
          setNotice({ kind: "success", message: result.message });
          router.replace(signRedirectHref);
          router.refresh();
        },
        onError: async (result) => {
          setNotice({ kind: "error", message: result.error });
        }
      }
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Member</p>
          <p className="text-lg font-semibold">{memberName}</p>
        </div>
        <Link href={backHref} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-brand">
          Back to Tracker
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Enrollment Date</p>
          <p className="font-semibold">{summary?.enrollmentDate ? formatDate(summary.enrollmentDate) : "-"}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Last Signed Note</p>
          <p className="font-semibold">{summary?.lastSignedProgressNoteDate ? formatDate(summary.lastSignedProgressNoteDate) : "-"}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Next Due Date</p>
          <p className="font-semibold">{summary?.nextProgressNoteDueDate ? formatDate(summary.nextProgressNoteDueDate) : "-"}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Current Status</p>
          <div className="mt-1">
            <ProgressNoteStatusBadge status={summary?.complianceStatus ?? "data_issue"} />
          </div>
        </div>
      </div>

      {summary?.dataIssue ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          {summary.dataIssue}. Due tracking will stay flagged until enrollment date is present or a signed progress note exists.
        </div>
      ) : null}

      {isSigned ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-semibold">Signed / Finalized</p>
          <p className="mt-1">
            Signed by {signedByName ?? "-"} on {signedAt ? formatDateTime(signedAt) : "-"}.
          </p>
          <p className="mt-1">
            The next due date is now {summary?.nextProgressNoteDueDate ? formatDate(summary.nextProgressNoteDueDate) : getProgressNoteComplianceLabel("data_issue")}.
          </p>
          <p className="mt-1">
            {hasStoredSignature ? "Electronic signature is on file for this note." : "This signed note predates progress-note e-sign capture, so no signature image is stored."}
          </p>
        </div>
      ) : null}

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Progress Note Date</span>
        <input
          type="date"
          value={noteDate}
          onChange={(event) => setNoteDate(event.target.value)}
          disabled={isSigned || isSaving}
          className="h-10 w-full rounded-lg border border-border px-3"
        />
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Progress Note</span>
        <textarea
          value={noteBody}
          onChange={(event) => setNoteBody(event.target.value)}
          disabled={isSigned || isSaving}
          className="min-h-56 w-full rounded-lg border border-border p-3 text-sm"
          placeholder="Document the member's current progress, relevant clinical observations, and any follow-up needed."
        />
      </label>

      {!isSigned ? (
        <div className="rounded-lg border border-border bg-slate-50 p-3">
          <p className="text-sm font-semibold">Nurse/Admin E-Sign</p>
          <p className="mt-1 text-sm text-muted">
            Signing finalizes this note, immediately refreshes compliance, and returns you to the tracker.
          </p>
          <div className="mt-3 space-y-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={signatureAttested}
                onChange={(event) => setSignatureAttested(event.target.checked)}
                className="mt-1"
                disabled={isSaving}
              />
              <span>I attest this is my electronic signature and I approve this progress note.</span>
            </label>
            <EsignaturePad disabled={isSaving} onSignatureChange={setSignatureImageDataUrl} />
          </div>
        </div>
      ) : null}

      {notice ? <MutationNotice kind={notice.kind} message={notice.message} /> : null}

      {!isSigned ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveDraft}
            disabled={isSaving}
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
          >
            {isSaving ? "Saving..." : "Save Draft"}
          </button>
          <button
            type="button"
            onClick={signNote}
            disabled={isSaving}
            className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
          >
            {isSaving ? "Signing..." : "E-Sign & Finalize"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/health/progress-notes/new?memberId=${memberId}`}
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-brand"
          >
            Start New Progress Note
          </Link>
        </div>
      )}
    </div>
  );
}
