"use client";

import { useMemo, useState, useTransition } from "react";

import { generateMonthlyMarReportPdfAction } from "@/app/(portal)/health/mar/report-actions";

type MarMonthlyReportType = "summary" | "detail" | "exceptions";

type MarMonthlyReportMemberOption = {
  memberId: string;
  memberName: string;
  memberDob: string | null;
  memberIdentifier: string | null;
  memberStatus: string | null;
};

function defaultMonthValue() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return year && month ? `${year}-${month}` : "";
}

function triggerDownload(dataUrl: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function reportTypeLabel(type: MarMonthlyReportType) {
  if (type === "detail") return "Full MAR Detail";
  if (type === "exceptions") return "Exception-Focused Summary";
  return "Monthly MAR Summary";
}

export function MarMonthlyReportPanel({
  canGenerate,
  memberOptions
}: {
  canGenerate: boolean;
  memberOptions: MarMonthlyReportMemberOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [memberId, setMemberId] = useState(memberOptions[0]?.memberId ?? "");
  const [month, setMonth] = useState(defaultMonthValue());
  const [reportType, setReportType] = useState<MarMonthlyReportType>("summary");
  const [status, setStatus] = useState<string>("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string>("");
  const [previewFileName, setPreviewFileName] = useState<string>("");

  const selectedMember = useMemo(
    () => memberOptions.find((option) => option.memberId === memberId) ?? null,
    [memberId, memberOptions]
  );

  async function runReport(mode: "preview" | "download") {
    setStatus("");
    setWarnings([]);

    if (!memberId) {
      setStatus("Select a member before generating a report.");
      return;
    }
    if (!month) {
      setStatus("Select a report month before generating a report.");
      return;
    }

    const result = await generateMonthlyMarReportPdfAction({
      memberId,
      month,
      reportType,
      saveToMemberFiles: true
    });

    if (result.status === "error") {
      setStatus(`Error: ${result.error}`);
      return;
    }

    const nextWarnings = result.reportMeta?.warnings ?? [];
    const memberFilesFollowUpNeeded = result.status === "follow-up-needed";
    setWarnings(nextWarnings);

    if (mode === "preview") {
      setPreviewDataUrl(result.dataUrl);
      setPreviewFileName(result.fileName);
      setPreviewOpen(true);
      setStatus(
        memberFilesFollowUpNeeded
          ? `Preview ready. ${result.memberFilesMessage}`
          : nextWarnings.length > 0
          ? `Preview ready and saved to member files with ${nextWarnings.length} data-quality warning${nextWarnings.length === 1 ? "" : "s"}.`
          : "Preview ready and saved to member files."
      );
      return;
    }

    triggerDownload(result.dataUrl, result.fileName);
    setStatus(memberFilesFollowUpNeeded ? `Report downloaded. ${result.memberFilesMessage}` : "Report downloaded and saved to member files.");
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Generate Monthly MAR Summary / Detail Report</p>
          <p className="text-xs text-muted">
            Canonical MAR data only. Generate branded, print-ready PDF reports for chart review, caregiver requests, and compliance.
          </p>
        </div>
      </div>

      {memberOptions.length === 0 ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          No medication records found. MAR monthly report generation is unavailable until canonical MAR medication data exists.
        </div>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-xs text-muted">
            Member
            <select
              className="h-10 rounded border border-border px-2 text-sm text-fg"
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
            >
              {memberOptions.map((option) => (
                <option key={option.memberId} value={option.memberId}>
                  {option.memberName}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs text-muted">
            Month / Year
            <input
              type="month"
              className="h-10 rounded border border-border px-2 text-sm text-fg"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>

          <label className="grid gap-1 text-xs text-muted">
            Report Type
            <select
              className="h-10 rounded border border-border px-2 text-sm text-fg"
              value={reportType}
              onChange={(event) => setReportType(event.target.value as MarMonthlyReportType)}
            >
              <option value="summary">Monthly MAR Summary</option>
              <option value="detail">Full Monthly MAR Detail</option>
              <option value="exceptions">Exception-Focused Summary</option>
            </select>
          </label>

          <div className="flex items-center rounded border border-border px-3 text-sm text-muted">
            Reports are always saved to member files
          </div>
        </div>
      )}

      {selectedMember ? (
        <p className="mt-2 text-xs text-muted">
          Selected member: {selectedMember.memberName}
          {selectedMember.memberDob ? ` | DOB ${selectedMember.memberDob}` : ""}
          {selectedMember.memberIdentifier ? ` | ID ${selectedMember.memberIdentifier}` : ""}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canGenerate || isPending || memberOptions.length === 0}
          className="rounded-lg border border-border px-3 py-2 text-sm font-semibold disabled:opacity-60"
          onClick={() =>
            startTransition(async () => {
              await runReport("preview");
            })
          }
        >
          {isPending ? "Generating..." : "Preview Monthly MAR Report"}
        </button>
        <button
          type="button"
          disabled={!canGenerate || isPending || memberOptions.length === 0}
          className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          onClick={() =>
            startTransition(async () => {
              await runReport("download");
            })
          }
        >
          {isPending ? "Generating..." : `Download ${reportTypeLabel(reportType)} PDF`}
        </button>
      </div>

      {warnings.length > 0 ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          {warnings.map((warning, index) => (
            <p key={`${warning}-${index}`}>- {warning}</p>
          ))}
        </div>
      ) : null}

      {status ? <p className="mt-2 text-sm text-muted">{status}</p> : null}
      {!canGenerate ? <p className="mt-2 text-sm text-rose-700">You do not have permission to generate MAR monthly reports.</p> : null}

      {previewOpen && previewDataUrl ? (
        <div className="fixed inset-0 z-50 bg-black/40 p-3 sm:p-6">
          <div className="mx-auto flex h-full max-w-6xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-semibold">MAR Report Preview</p>
                <p className="text-xs text-muted">{previewFileName}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold"
                  onClick={() => triggerDownload(previewDataUrl, previewFileName)}
                >
                  Download PDF
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-border px-3 py-1.5 text-sm"
                  onClick={() => setPreviewOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
            <iframe src={previewDataUrl} className="h-full w-full" title="MAR monthly report preview" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
