"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import { formatDateTime, formatOptionalDate } from "@/lib/utils";

type PhysicianOrderListRow = {
  id: string;
  status: string;
  clinicalSyncStatus: "not_signed" | "pending" | "queued" | "failed" | "synced";
  providerName: string | null;
  completedDate: string | null;
  signedDate: string | null;
  updatedAt: string;
  memberNameSnapshot: string;
};

type ModalState =
  | {
      mode: "send" | "resend";
      physicianOrderId: string;
      physicianOrderStatus: string;
      physicianOrderUpdatedAt: string;
      memberNameSnapshot: string;
      requestId: string | null;
      providerName: string;
      providerEmail: string;
      nurseName: string;
      fromEmail: string;
      optionalMessage: string;
      expiresOnDate: string;
    }
  | null;

type ModalField = "providerName" | "providerEmail" | "nurseName" | "fromEmail" | "expiresOnDate";
type ModalFieldErrors = Partial<Record<ModalField, string>>;

function statusBadgeClass(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "signed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (normalized === "opened") return "border-sky-200 bg-sky-50 text-sky-700";
  if (normalized === "sent") return "border-blue-200 bg-blue-50 text-blue-700";
  if (normalized === "declined") return "border-rose-200 bg-rose-50 text-rose-700";
  if (normalized === "expired") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function statusLabel(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized.length === 0) return "Draft";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
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

function mergeRequestList(current: PofRequestSummary[], nextRequest: PofRequestSummary | null | undefined) {
  if (!nextRequest) return current;
  return [nextRequest, ...current.filter((request) => request.id !== nextRequest.id)];
}

export function MemberCommandCenterPofSection({
  memberId,
  physicianOrders,
  requests,
  defaultNurseName,
  defaultFromEmail,
  canViewPhysicianOrdersModule,
  canCreatePhysicianOrders
}: {
  memberId: string;
  physicianOrders: PhysicianOrderListRow[];
  requests: PofRequestSummary[];
  defaultNurseName: string;
  defaultFromEmail: string;
  canViewPhysicianOrdersModule: boolean;
  canCreatePhysicianOrders: boolean;
}) {
  const router = useRouter();
  const [modalState, setModalState] = useState<ModalState>(null);
  const [localRequests, setLocalRequests] = useState(requests);
  const [fieldErrors, setFieldErrors] = useState<ModalFieldErrors>({});
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const { isSaving, run } = useScopedMutation();

  useEffect(() => {
    setLocalRequests(requests);
  }, [requests]);

  const latestRequestByPofId = useMemo(() => {
    const map = new Map<string, PofRequestSummary>();
    localRequests.forEach((request) => {
      if (!map.has(request.physicianOrderId)) {
        map.set(request.physicianOrderId, request);
      }
    });
    return map;
  }, [localRequests]);

  function openSendModal(row: PhysicianOrderListRow) {
    setStatus(null);
    setFieldErrors({});
    setModalState({
      mode: "send",
      physicianOrderId: row.id,
      physicianOrderStatus: row.status,
      physicianOrderUpdatedAt: row.updatedAt,
      memberNameSnapshot: row.memberNameSnapshot,
      requestId: null,
      providerName: row.providerName ?? "",
      providerEmail: "",
      nurseName: defaultNurseName,
      fromEmail: defaultFromEmail,
      optionalMessage: "",
      expiresOnDate: defaultExpiryDate()
    });
  }

  function openResendModal(row: PhysicianOrderListRow, request: PofRequestSummary) {
    setStatus(null);
    setFieldErrors({});
    setModalState({
      mode: "resend",
      physicianOrderId: row.id,
      physicianOrderStatus: row.status,
      physicianOrderUpdatedAt: row.updatedAt,
      memberNameSnapshot: row.memberNameSnapshot,
      requestId: request.id,
      providerName: request.providerName,
      providerEmail: request.providerEmail,
      nurseName: request.nurseName || defaultNurseName,
      fromEmail: request.fromEmail || defaultFromEmail,
      optionalMessage: request.optionalMessage ?? "",
      expiresOnDate: request.expiresAt.slice(0, 10)
    });
  }

  function validateModal(state: Exclude<ModalState, null>) {
    const nextErrors: ModalFieldErrors = {};
    if (!state.providerName.trim()) nextErrors.providerName = "Provider Name is required.";
    if (!state.providerEmail.trim()) {
      nextErrors.providerEmail = "Provider Email is required.";
    } else if (!isEmail(state.providerEmail)) {
      nextErrors.providerEmail = "Provider Email must be valid.";
    }
    if (!state.nurseName.trim()) nextErrors.nurseName = "Nurse Name is required.";
    if (!state.fromEmail.trim()) {
      nextErrors.fromEmail = "From Email is required.";
    } else if (!isEmail(state.fromEmail)) {
      nextErrors.fromEmail = "From Email must be valid.";
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(state.expiresOnDate.trim())) {
      nextErrors.expiresOnDate = "Expiration Date is required.";
    }
    return nextErrors;
  }

  function submitModal() {
    if (!modalState) return;
    const validationErrors = validateModal(modalState);
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setToast({ kind: "error", message: "Please fix required fields before sending." });
      return;
    }

    const successMessage = modalState.mode === "send" ? "POF signature request sent." : "POF signature request resent.";
    void run(
      async () => {
        const formData = new FormData();
        formData.set("memberId", memberId);
        formData.set("physicianOrderId", modalState.physicianOrderId);
        formData.set("providerName", modalState.providerName);
        formData.set("providerEmail", modalState.providerEmail);
        formData.set("nurseName", modalState.nurseName);
        formData.set("fromEmail", modalState.fromEmail);
        formData.set("optionalMessage", modalState.optionalMessage);
        formData.set("expiresOnDate", modalState.expiresOnDate);
        if (modalState.requestId) {
          formData.set("requestId", modalState.requestId);
        }

        return modalState.mode === "send"
          ? sendPofSignatureRequestAction(formData)
          : resendPofSignatureRequestAction(formData);
      },
      {
        successMessage,
        errorMessage: "Unable to update the POF signature request.",
        fallbackData: { request: null as PofRequestSummary | null },
        onSuccess: async (result) => {
          setLocalRequests((current) => mergeRequestList(current, result.data.request));
          router.refresh();
          setStatus(result.message);
          setToast({ kind: "success", message: result.message });
          setModalState(null);
        },
        onError: async (result) => {
          setStatus(`Error: ${result.error}`);
          setToast({ kind: "error", message: result.error });
        }
      }
    );
  }

  function onVoid(requestId: string, physicianOrderId: string) {
    if (!window.confirm("Void this POF signature request?")) return;
    setStatus(null);
    void run(
      async () =>
        voidPofSignatureRequestAction({
          requestId,
          memberId,
          physicianOrderId,
          reason: "voided_by_staff"
        }),
      {
        successMessage: "POF signature request voided.",
        errorMessage: "Unable to void the POF signature request.",
        fallbackData: { request: null as PofRequestSummary | null },
        onSuccess: async (result) => {
          setLocalRequests((current) => mergeRequestList(current, result.data.request));
          router.refresh();
          setStatus(result.message);
          setToast({ kind: "success", message: result.message });
        },
        onError: async (result) => {
          setStatus(`Error: ${result.error}`);
          setToast({ kind: "error", message: result.error });
        }
      }
    );
  }

  function onDownloadSigned(requestId: string) {
    setStatus(null);
    void run(
      async () => getSignedPofDownloadUrlAction({ requestId, memberId }),
      {
        successMessage: "Signed PDF opened.",
        fallbackData: { signedUrl: "" },
        onSuccess: async (result) => {
          triggerDownload(result.data.signedUrl);
          setStatus(result.message);
          setToast({ kind: "success", message: result.message });
        },
        onError: async (result) => {
          setStatus(`Error: ${result.error}`);
          setToast({ kind: "error", message: result.error });
        }
      }
    );
  }

  async function onCopySignLink(url: string) {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(url);
        setStatus("Secure signing link copied.");
        setToast({ kind: "success", message: "Secure signing link copied." });
        return;
      }
    } catch {
      // fallback handled below
    }
    window.prompt("Copy secure signing link:", url);
    setStatus("Secure signing link ready to copy.");
    setToast({ kind: "success", message: "Secure signing link ready to copy." });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canViewPhysicianOrdersModule ? (
          <Link href={`/health/physician-orders?memberId=${memberId}`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
            Open Full POF List
          </Link>
        ) : null}
        {canCreatePhysicianOrders ? (
          <Link href={`/health/physician-orders/new?memberId=${memberId}`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
            New POF
          </Link>
        ) : null}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>POF</th>
              <th>Order Status</th>
              <th>Clinical Sync</th>
              <th>E-Sign Status</th>
              <th>Provider</th>
              <th>Provider Email</th>
              <th>Sent</th>
              <th>Signed</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {physicianOrders.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-sm text-muted">
                  No physician orders saved for this member yet.
                </td>
              </tr>
            ) : (
              physicianOrders.map((row) => {
                const request = latestRequestByPofId.get(row.id) ?? null;
                const eSignStatus = request ? statusLabel(request.status) : "Not Sent";
                const canSendNew = !request || request.status === "declined" || request.status === "signed";
                const canResend =
                  request && (request.status === "draft" || request.status === "sent" || request.status === "opened" || request.status === "expired");
                const canVoid = request && (request.status === "draft" || request.status === "sent" || request.status === "opened");
                const canDownloadSigned = request && request.status === "signed";
                const canCopySignLink = request && (request.status === "draft" || request.status === "sent" || request.status === "opened");
                const sendWorkflowMode = canSendNew ? "send" : canResend ? "resend" : null;
                return (
                  <tr key={row.id}>
                    <td>
                      {canViewPhysicianOrdersModule ? (
                        <Link href={`/health/physician-orders/${row.id}?from=mcc`} className="font-semibold text-brand">
                          Open POF
                        </Link>
                      ) : (
                        <span className="font-semibold">Saved POF</span>
                      )}
                    </td>
                    <td>{row.status}</td>
                    <td>
                      {row.clinicalSyncStatus === "synced"
                        ? "Synced"
                        : row.clinicalSyncStatus === "failed"
                          ? "Failed"
                          : row.clinicalSyncStatus === "queued"
                            ? "Queued"
                            : row.clinicalSyncStatus === "pending"
                              ? "Pending"
                              : "-"}
                    </td>
                    <td>
                      <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusBadgeClass(eSignStatus)}`}>
                        {eSignStatus}
                      </span>
                    </td>
                    <td>{request?.providerName ?? row.providerName ?? "-"}</td>
                    <td className="text-xs text-muted">{request?.providerEmail ?? "-"}</td>
                    <td>{request?.sentAt ? formatDateTime(request.sentAt) : row.completedDate ? formatOptionalDate(row.completedDate) : "-"}</td>
                    <td>{request?.signedAt ? formatDateTime(request.signedAt) : row.signedDate ? formatOptionalDate(row.signedDate) : "-"}</td>
                    <td>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {sendWorkflowMode ? (
                          <button
                            type="button"
                            className="font-semibold text-brand"
                            onClick={() => {
                              if (sendWorkflowMode === "resend" && request) {
                                openResendModal(row, request);
                                return;
                              }
                              openSendModal(row);
                            }}
                            disabled={isSaving}
                          >
                            Send POF for Signature
                          </button>
                        ) : null}
                        {canResend ? (
                          <button
                            type="button"
                            className="font-semibold text-brand"
                            onClick={() => openResendModal(row, request)}
                            disabled={isSaving}
                          >
                            Resend
                          </button>
                        ) : null}
                        {canVoid ? (
                          <button
                            type="button"
                            className="font-semibold text-red-700"
                            onClick={() => onVoid(request!.id, row.id)}
                            disabled={isSaving}
                          >
                            Void
                          </button>
                        ) : null}
                        {canDownloadSigned ? (
                          <button
                            type="button"
                            className="font-semibold text-brand"
                            onClick={() => onDownloadSigned(request!.id)}
                            disabled={isSaving}
                          >
                            Download Signed PDF
                          </button>
                        ) : null}
                        {canCopySignLink ? (
                          <button
                            type="button"
                            className="font-semibold text-brand"
                            onClick={() => onCopySignLink(request!.signatureRequestUrl)}
                            disabled={isSaving}
                          >
                            Copy Sign Link
                          </button>
                        ) : null}
                        {request?.memberFileId ? (
                          <Link href={`/operations/member-command-center/${memberId}?tab=member-summary#files-documents`} className="font-semibold text-brand">
                            View in Member Files
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <MutationNotice kind={status?.startsWith("Error") ? "error" : "success"} message={status} />

      {toast ? (
        <div
          className={`fixed right-4 top-4 z-[60] max-w-md rounded-lg border px-3 py-2 text-sm font-semibold shadow-lg ${
            toast.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start justify-between gap-3">
            <span>{toast.message}</span>
            <button
              type="button"
              className="text-xs font-bold"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
            >
              x
            </button>
          </div>
        </div>
      ) : null}

      {modalState ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (!isSaving) setModalState(null);
          }}
        >
          <div className="w-full max-w-3xl rounded-xl border border-border bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold">
                {modalState.mode === "send" ? "Send POF for Signature" : "Resend POF Signature Request"}
              </h3>
              <button
                type="button"
                className="rounded border border-border px-2 py-1 text-xs font-semibold"
                onClick={() => setModalState(null)}
                disabled={isSaving}
              >
                Close
              </button>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <label className="text-sm">
                <span className="text-xs font-semibold text-muted">Provider Name</span>
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-border px-3"
                  value={modalState.providerName}
                  onChange={(event) => {
                    setFieldErrors((prev) => ({ ...prev, providerName: undefined }));
                    setModalState((prev) => (prev ? { ...prev, providerName: event.target.value } : prev));
                  }}
                />
                {fieldErrors.providerName ? <p className="mt-1 text-xs text-rose-700">{fieldErrors.providerName}</p> : null}
              </label>
              <label className="text-sm">
                <span className="text-xs font-semibold text-muted">Provider Email</span>
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-border px-3"
                  type="email"
                  value={modalState.providerEmail}
                  onChange={(event) => {
                    setFieldErrors((prev) => ({ ...prev, providerEmail: undefined }));
                    setModalState((prev) => (prev ? { ...prev, providerEmail: event.target.value } : prev));
                  }}
                />
                {fieldErrors.providerEmail ? <p className="mt-1 text-xs text-rose-700">{fieldErrors.providerEmail}</p> : null}
              </label>
              <label className="text-sm">
                <span className="text-xs font-semibold text-muted">From Email</span>
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-border px-3"
                  type="email"
                  value={modalState.fromEmail}
                  onChange={(event) => {
                    setFieldErrors((prev) => ({ ...prev, fromEmail: undefined }));
                    setModalState((prev) => (prev ? { ...prev, fromEmail: event.target.value } : prev));
                  }}
                />
                {fieldErrors.fromEmail ? <p className="mt-1 text-xs text-rose-700">{fieldErrors.fromEmail}</p> : null}
              </label>
              <label className="text-sm">
                <span className="text-xs font-semibold text-muted">Nurse Name</span>
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-border px-3"
                  value={modalState.nurseName}
                  onChange={(event) => {
                    setFieldErrors((prev) => ({ ...prev, nurseName: undefined }));
                    setModalState((prev) => (prev ? { ...prev, nurseName: event.target.value } : prev));
                  }}
                />
                {fieldErrors.nurseName ? <p className="mt-1 text-xs text-rose-700">{fieldErrors.nurseName}</p> : null}
              </label>
              <label className="text-sm md:col-span-2">
                <span className="text-xs font-semibold text-muted">Optional Message</span>
                <textarea
                  className="mt-1 min-h-[84px] w-full rounded-lg border border-border px-3 py-2"
                  value={modalState.optionalMessage}
                  onChange={(event) => setModalState((prev) => (prev ? { ...prev, optionalMessage: event.target.value } : prev))}
                />
              </label>
              <label className="text-sm md:max-w-xs">
                <span className="text-xs font-semibold text-muted">Expiration Date</span>
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-border px-3"
                  type="date"
                  value={modalState.expiresOnDate}
                  onChange={(event) => {
                    setFieldErrors((prev) => ({ ...prev, expiresOnDate: undefined }));
                    setModalState((prev) => (prev ? { ...prev, expiresOnDate: event.target.value } : prev));
                  }}
                />
                {fieldErrors.expiresOnDate ? <p className="mt-1 text-xs text-rose-700">{fieldErrors.expiresOnDate}</p> : null}
              </label>
            </div>

            <div className="mt-3 rounded-lg border border-border bg-slate-50 p-3 text-sm">
              <p className="font-semibold">POF Preview</p>
              <p className="mt-1 text-xs text-muted">
                Member: {modalState.memberNameSnapshot} | POF Status: {modalState.physicianOrderStatus} | Last Updated:{" "}
                {formatDateTime(modalState.physicianOrderUpdatedAt)}
              </p>
              <Link href={`/health/physician-orders/${modalState.physicianOrderId}/print`} target="_blank" className="mt-2 inline-block text-xs font-semibold text-brand">
                Open print preview
              </Link>
              <iframe
                src={`/health/physician-orders/${modalState.physicianOrderId}/print`}
                title="POF print preview"
                className="mt-2 h-[320px] w-full rounded-lg border border-border bg-white"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="h-10 rounded-lg border border-border px-3 text-sm font-semibold"
                onClick={() => setModalState(null)}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white"
                onClick={submitModal}
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : modalState.mode === "send" ? "Send for Signature" : "Resend"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
