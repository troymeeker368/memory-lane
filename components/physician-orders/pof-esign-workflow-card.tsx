"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  getSignedPofDownloadUrlAction,
  resendPofSignatureRequestAction,
  sendPofSignatureRequestAction,
  voidPofSignatureRequestAction
} from "@/app/(portal)/operations/member-command-center/pof-actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { MutationNotice } from "@/components/ui/mutation-notice";
import type { PofRequestSummary } from "@/lib/services/pof-esign";
import type { PhysicianOrderClinicalSyncDetail } from "@/lib/services/physician-order-clinical-sync";
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

function canResendStatus(status: PofWorkflowStatus) {
  return status === "draft" || status === "sent" || status === "opened" || status === "expired";
}

function canVoidStatus(status: PofWorkflowStatus) {
  return status === "draft" || status === "sent" || status === "opened";
}

function canSendNewStatus(status: PofWorkflowStatus) {
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
  clinicalSyncDetail,
  showProviderNameInput = true,
  saveAndDispatchAction
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
  clinicalSyncDetail?: PhysicianOrderClinicalSyncDetail | null;
  showProviderNameInput?: boolean;
  saveAndDispatchAction?: (formData: FormData) => Promise<{ ok: boolean; error?: string; pofId?: string; request?: PofRequestSummary | null }>;
}) {
  const router = useRouter();
  const { isSaving, run } = useScopedMutation();

  const [currentRequest, setCurrentRequest] = useState<PofRequestSummary | null>(latestRequest);
  const [providerName, setProviderName] = useState(defaultProviderName);
  const [providerEmail, setProviderEmail] = useState(defaultProviderEmail);
  const [nurseName, setNurseName] = useState(defaultNurseName);
  const [fromEmail, setFromEmail] = useState(defaultFromEmail);
  const [optionalMessage, setOptionalMessage] = useState(defaultOptionalMessage ?? latestRequest?.optionalMessage ?? "");
  const [expiresOnDate, setExpiresOnDate] = useState(latestRequest?.expiresAt?.slice(0, 10) ?? defaultExpiryDate());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setCurrentRequest(latestRequest);
  }, [latestRequest]);

  useEffect(() => {
    setProviderName(defaultProviderName);
  }, [defaultProviderName]);

  useEffect(() => {
    setProviderEmail(currentRequest?.providerEmail ?? defaultProviderEmail);
  }, [currentRequest?.providerEmail, defaultProviderEmail]);

  useEffect(() => {
    setNurseName(currentRequest?.nurseName || defaultNurseName);
  }, [currentRequest?.nurseName, defaultNurseName]);

  useEffect(() => {
    setFromEmail(currentRequest?.fromEmail || defaultFromEmail);
  }, [currentRequest?.fromEmail, defaultFromEmail]);

  useEffect(() => {
    setOptionalMessage(defaultOptionalMessage ?? currentRequest?.optionalMessage ?? "");
  }, [currentRequest?.optionalMessage, defaultOptionalMessage]);

  useEffect(() => {
    setExpiresOnDate(currentRequest?.expiresAt?.slice(0, 10) ?? defaultExpiryDate());
  }, [currentRequest?.expiresAt]);

  const workflowStatus = useMemo<PofWorkflowStatus>(() => normalizeWorkflowStatus(currentRequest?.status), [currentRequest?.status]);
  const canSend = !currentRequest || canSendNewStatus(currentRequest.status);
  const canResend = Boolean(physicianOrderId) && Boolean(currentRequest && canResendStatus(currentRequest.status));
  const canVoid = Boolean(physicianOrderId) && Boolean(currentRequest && canVoidStatus(currentRequest.status));
  const canDownloadSigned = Boolean(currentRequest && currentRequest.status === "signed");
  const viewInFilesHref = currentRequest?.memberFileId
    ? `/operations/member-command-center/${memberId}?tab=member-summary#files-documents`
    : null;

  function validateSendFields() {
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
      setStatusMessage(`Error: ${validationError}`);
      return;
    }

    const successMessage = mode === "send" ? "POF signature request sent." : "POF signature request resent.";
    void run(
      async () => {
        const activeElement = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
        const editorForm = activeElement?.closest("form");

        if (editorForm && saveAndDispatchAction) {
          const draftAndSendData = new FormData(editorForm);
          draftAndSendData.set("esignDispatchMode", mode);
          draftAndSendData.set("esignProviderEmail", providerEmail.trim());
          draftAndSendData.set("esignNurseName", nurseName.trim());
          draftAndSendData.set("esignFromEmail", fromEmail.trim());
          draftAndSendData.set("esignOptionalMessage", optionalMessage.trim());
          draftAndSendData.set("esignExpiresOnDate", expiresOnDate.trim());
          if (mode === "resend" && currentRequest) {
            draftAndSendData.set("esignRequestId", currentRequest.id);
          }
          return saveAndDispatchAction(draftAndSendData);
        }

        if (!physicianOrderId) {
          return { ok: false, error: "Save draft first before sending for provider signature." };
        }

        const formData = new FormData();
        formData.set("memberId", memberId);
        formData.set("physicianOrderId", physicianOrderId);
        formData.set("providerName", providerName.trim());
        formData.set("providerEmail", providerEmail.trim());
        formData.set("nurseName", nurseName.trim());
        formData.set("fromEmail", fromEmail.trim());
        formData.set("optionalMessage", optionalMessage.trim());
        formData.set("expiresOnDate", expiresOnDate.trim());
        if (mode === "resend" && currentRequest) {
          formData.set("requestId", currentRequest.id);
        }

        return mode === "send" ? sendPofSignatureRequestAction(formData) : resendPofSignatureRequestAction(formData);
      },
      {
        successMessage,
        fallbackData: { request: null as PofRequestSummary | null, pofId: physicianOrderId ?? null },
        onSuccess: async (result) => {
          if (result.data.request) {
            setCurrentRequest(result.data.request);
          }
          router.refresh();
          setStatusMessage(result.message);
          if (result.data.pofId && result.data.pofId !== physicianOrderId) {
            router.replace(`/health/physician-orders/${result.data.pofId}`);
          }
        },
        onError: async (result) => {
          setStatusMessage(`Error: ${result.error}`);
        }
      }
    );
  }

  function voidRequest() {
    if (!currentRequest || !physicianOrderId) return;
    if (!window.confirm("Void this POF signature request?")) return;

    void run(
      async () =>
        voidPofSignatureRequestAction({
          requestId: currentRequest.id,
          memberId,
          physicianOrderId,
          reason: "voided_by_staff"
        }),
      {
        successMessage: "POF signature request voided.",
        fallbackData: { request: null as PofRequestSummary | null },
        onSuccess: async (result) => {
          if (result.data.request) {
            setCurrentRequest(result.data.request);
          }
          router.refresh();
          setStatusMessage(result.message);
        },
        onError: async (result) => {
          setStatusMessage(`Error: ${result.error}`);
        }
      }
    );
  }

  function downloadSignedPdf() {
    if (!currentRequest) return;

    void run(
      async () =>
        getSignedPofDownloadUrlAction({
          requestId: currentRequest.id,
          memberId
        }),
      {
        successMessage: "Signed PDF opened.",
        fallbackData: { signedUrl: "" },
        onSuccess: async (result) => {
          triggerDownload(result.data.signedUrl);
          setStatusMessage(result.message);
        },
        onError: async (result) => {
          setStatusMessage(`Error: ${result.error}`);
        }
      }
    );
  }

  const signedSummaryName = (signedProviderName ?? "").trim() || (currentRequest?.providerName ?? "").trim() || "-";
  const signedSummaryDate = signedAt ?? currentRequest?.signedAt ?? null;
  const sendDisabledReason = currentRequest && !canSend
      ? currentRequest.status === "draft" || currentRequest.status === "sent" || currentRequest.status === "opened"
        ? "A signature request is already active. Use Resend to deliver it again."
        : currentRequest.status === "expired"
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
          {clinicalSyncDetail ? (
            <div className={`mt-3 rounded-lg border p-3 ${clinicalSyncDetail.actionNeeded ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-800"}`}>
              <p className="font-semibold">Clinical Sync: {clinicalSyncDetail.label}</p>
              {clinicalSyncDetail.message ? <p className="mt-1 text-xs">{clinicalSyncDetail.message}</p> : null}
              {clinicalSyncDetail.nextRetryAt ? (
                <p className="mt-1 text-xs">
                  <span className="font-semibold">Next Retry:</span> {formatDateTime(clinicalSyncDetail.nextRetryAt)}
                </p>
              ) : null}
              {typeof clinicalSyncDetail.attemptCount === "number" ? (
                <p className="mt-1 text-xs">
                  <span className="font-semibold">Attempts:</span> {clinicalSyncDetail.attemptCount}
                </p>
              ) : null}
              {clinicalSyncDetail.lastError ? (
                <p className="mt-1 text-xs">
                  <span className="font-semibold">Latest Error:</span> {clinicalSyncDetail.lastError}
                </p>
              ) : null}
            </div>
          ) : null}
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
            name="esignProviderEmail"
            value={providerEmail}
            onChange={(event) => setProviderEmail(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Nurse Name</span>
          <input
            name="esignNurseName"
            value={nurseName}
            onChange={(event) => setNurseName(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">From Email</span>
          <input
            type="email"
            name="esignFromEmail"
            value={fromEmail}
            onChange={(event) => setFromEmail(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs font-semibold text-muted">Optional Message</span>
          <textarea
            name="esignOptionalMessage"
            value={optionalMessage}
            onChange={(event) => setOptionalMessage(event.target.value)}
            className="min-h-20 w-full rounded-lg border border-border p-3 text-sm"
          />
        </label>
        <label className="space-y-1 text-sm md:max-w-sm">
          <span className="text-xs font-semibold text-muted">Expiration Date</span>
          <input
            type="date"
            name="esignExpiresOnDate"
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
          disabled={isSaving || !canSend}
          title={sendDisabledReason ?? undefined}
        >
          Send POF for Signature
        </button>
        {canResend ? (
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={() => submitRequest("resend")}
            disabled={isSaving}
          >
            Resend
          </button>
        ) : null}
        {canVoid ? (
          <button
            type="button"
            className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700"
            onClick={voidRequest}
            disabled={isSaving}
          >
            Void
          </button>
        ) : null}
        {canDownloadSigned ? (
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={downloadSignedPdf}
            disabled={isSaving}
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

      {!isSaving && sendDisabledReason ? <p className="text-xs text-muted">{sendDisabledReason}</p> : null}
      <MutationNotice kind={statusMessage?.startsWith("Error") ? "error" : "success"} message={statusMessage} />
    </div>
  );
}
