"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  getSignedPofDownloadUrlAction,
  resendPofSignatureRequestAction,
  sendPofSignatureRequestAction,
  voidPofSignatureRequestAction
} from "@/app/(portal)/operations/member-command-center/pof-actions";
import type { PofRequestStatus, PofRequestSummary } from "@/lib/services/pof-esign";
import { formatDateTime } from "@/lib/utils";

export type PofWorkflowStatus = "draft" | "sent" | "opened" | "signed" | "expired" | "declined";

function normalizeWorkflowStatus(status: string | null | undefined): PofWorkflowStatus {
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized === "sent") return "sent";
  if (normalized === "opened") return "opened";
  if (normalized === "signed") return "signed";
  if (normalized === "expired") return "expired";
  if (normalized === "declined") return "declined";
  return "draft";
}

function statusBadgeClass(status: PofWorkflowStatus) {
  if (status === "signed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "opened") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "sent") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "declined") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "expired") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function defaultExpiryDate() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function triggerDownload(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function canResendStatus(status: PofRequestStatus) {
  return status === "draft" || status === "sent" || status === "opened" || status === "expired";
}

function canVoidStatus(status: PofRequestStatus) {
  return status === "draft" || status === "sent" || status === "opened";
}

function canSendNewStatus(status: PofRequestStatus) {
  return status === "declined" || status === "signed";
}

export function PofEsignWorkflowCard({
  memberId,
  physicianOrderId,
  latestRequest,
  defaultProviderName,
  defaultProviderEmail,
  defaultNurseName,
  defaultFromEmail,
  defaultOptionalMessage,
  signedProviderName,
  signedAt,
  showProviderNameInput = true
}: {
  memberId: string;
  physicianOrderId: string | null;
  latestRequest: PofRequestSummary | null;
  defaultProviderName: string;
  defaultProviderEmail: string;
  defaultNurseName: string;
  defaultFromEmail: string;
  defaultOptionalMessage?: string;
  signedProviderName?: string | null;
  signedAt?: string | null;
  showProviderNameInput?: boolean;
}) {
  const [providerName, setProviderName] = useState(defaultProviderName);
  const [providerEmail, setProviderEmail] = useState(defaultProviderEmail);
  const [nurseName, setNurseName] = useState(defaultNurseName);
  const [fromEmail, setFromEmail] = useState(defaultFromEmail);
  const [optionalMessage, setOptionalMessage] = useState(defaultOptionalMessage ?? latestRequest?.optionalMessage ?? "");
  const [expiresOnDate, setExpiresOnDate] = useState(latestRequest?.expiresAt?.slice(0, 10) ?? defaultExpiryDate());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const workflowStatus = useMemo<PofWorkflowStatus>(() => normalizeWorkflowStatus(latestRequest?.status), [latestRequest?.status]);
  const canSend = Boolean(physicianOrderId) && (!latestRequest || canSendNewStatus(latestRequest.status));
  const canResend = Boolean(physicianOrderId) && Boolean(latestRequest && canResendStatus(latestRequest.status));
  const canVoid = Boolean(physicianOrderId) && Boolean(latestRequest && canVoidStatus(latestRequest.status));
  const canDownloadSigned = Boolean(latestRequest && latestRequest.status === "signed");
  const viewInFilesHref = latestRequest?.memberFileId
    ? `/operations/member-command-center/${memberId}?tab=member-summary#files-documents`
    : null;

  function validateSendFields() {
    if (!physicianOrderId) return "Save draft first before sending for provider signature.";
    if (!providerName.trim()) return "Provider Name is required.";
    if (!providerEmail.trim()) return "Provider Email is required.";
    if (!isEmail(providerEmail)) return "Provider Email must be valid.";
    if (!nurseName.trim()) return "Nurse Name is required.";
    if (!fromEmail.trim()) return "From Email is required.";
    if (!isEmail(fromEmail)) return "From Email must be valid.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOnDate.trim())) return "Expiration Date is required.";
    return null;
  }

  function submitRequest(mode: "send" | "resend") {
    const validationError = validateSendFields();
    if (validationError) {
      setStatusMessage(validationError);
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("physicianOrderId", physicianOrderId!);
      formData.set("providerName", providerName.trim());
      formData.set("providerEmail", providerEmail.trim());
      formData.set("nurseName", nurseName.trim());
      formData.set("fromEmail", fromEmail.trim());
      formData.set("optionalMessage", optionalMessage.trim());
      formData.set("expiresOnDate", expiresOnDate.trim());
      if (mode === "resend" && latestRequest) {
        formData.set("requestId", latestRequest.id);
      }

      const result = mode === "send" ? await sendPofSignatureRequestAction(formData) : await resendPofSignatureRequestAction(formData);
      if (!result.ok) {
        setStatusMessage(result.error);
        return;
      }
      setStatusMessage(mode === "send" ? "POF signature request sent." : "POF signature request resent.");
      router.refresh();
    });
  }

  function voidRequest() {
    if (!latestRequest || !physicianOrderId) return;
    if (!window.confirm("Void this POF signature request?")) return;
    startTransition(async () => {
      const result = await voidPofSignatureRequestAction({
        requestId: latestRequest.id,
        memberId,
        physicianOrderId,
        reason: "voided_by_staff"
      });
      if (!result.ok) {
        setStatusMessage(result.error);
        return;
      }
      setStatusMessage("POF signature request voided.");
      router.refresh();
    });
  }

  function downloadSignedPdf() {
    if (!latestRequest) return;
    startTransition(async () => {
      const result = await getSignedPofDownloadUrlAction({
        requestId: latestRequest.id,
        memberId
      });
      if (!result.ok) {
        setStatusMessage(result.error);
        return;
      }
      triggerDownload(result.signedUrl);
      setStatusMessage("Signed PDF opened.");
    });
  }

  const signedSummaryName = (signedProviderName ?? "").trim() || (latestRequest?.providerName ?? "").trim() || "-";
  const signedSummaryDate = signedAt ?? latestRequest?.signedAt ?? null;
  const sendDisabledReason = !physicianOrderId
    ? "Save draft first before sending for provider signature."
    : latestRequest && !canSend
      ? latestRequest.status === "draft" || latestRequest.status === "sent" || latestRequest.status === "opened"
        ? "A signature request is already active. Use Resend to deliver it again."
        : latestRequest.status === "expired"
          ? "This request has expired. Use Resend to send a refreshed link."
          : "A new send is unavailable for the current workflow state."
      : null;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">System-Managed Workflow Status</p>
        <div className="mt-2">
          <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusBadgeClass(workflowStatus)}`}>{workflowStatus}</span>
        </div>
        <p className="mt-2 text-xs text-muted">Status is derived from the provider e-sign workflow and cannot be manually edited on this form.</p>
      </div>

      {workflowStatus === "signed" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-semibold text-emerald-800">Signed Summary (Read-only)</p>
          <p className="mt-1">
            <span className="font-semibold">Provider Typed Name:</span> {signedSummaryName}
          </p>
          <p>
            <span className="font-semibold">Signed Date:</span> {signedSummaryDate ? formatDateTime(signedSummaryDate) : "-"}
          </p>
          <p>
            <span className="font-semibold">Signed Status:</span> signed
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {showProviderNameInput ? (
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Provider Name</span>
            <input
              name="providerName"
              value={providerName}
              onChange={(event) => setProviderName(event.target.value)}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>
        ) : (
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Provider Name</span>
            <input
              value={providerName}
              onChange={(event) => setProviderName(event.target.value)}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>
        )}
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Provider Email</span>
          <input
            type="email"
            value={providerEmail}
            onChange={(event) => setProviderEmail(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Nurse Name</span>
          <input
            value={nurseName}
            onChange={(event) => setNurseName(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">From Email</span>
          <input
            type="email"
            value={fromEmail}
            onChange={(event) => setFromEmail(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs font-semibold text-muted">Optional Message</span>
          <textarea
            value={optionalMessage}
            onChange={(event) => setOptionalMessage(event.target.value)}
            className="min-h-20 w-full rounded-lg border border-border p-3 text-sm"
          />
        </label>
        <label className="space-y-1 text-sm md:max-w-sm">
          <span className="text-xs font-semibold text-muted">Expiration Date</span>
          <input
            type="date"
            value={expiresOnDate}
            onChange={(event) => setExpiresOnDate(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => submitRequest("send")}
          disabled={isPending || !canSend}
          title={sendDisabledReason ?? undefined}
        >
          Send POF for Signature
        </button>
        {canResend ? (
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={() => submitRequest("resend")}
            disabled={isPending}
          >
            Resend
          </button>
        ) : null}
        {canVoid ? (
          <button
            type="button"
            className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700"
            onClick={voidRequest}
            disabled={isPending}
          >
            Void
          </button>
        ) : null}
        {canDownloadSigned ? (
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={downloadSignedPdf}
            disabled={isPending}
          >
            Download Signed PDF
          </button>
        ) : null}
        {viewInFilesHref ? (
          <a href={viewInFilesHref} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
            View in Member Files
          </a>
        ) : null}
      </div>

      {!isPending && sendDisabledReason ? <p className="text-xs text-muted">{sendDisabledReason}</p> : null}
      {statusMessage ? <p className="text-sm text-muted">{statusMessage}</p> : null}
    </div>
  );
}
