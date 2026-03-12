"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  getSignedPofDownloadUrlAction,
  resendPofSignatureRequestAction,
  sendPofSignatureRequestAction,
  voidPofSignatureRequestAction
} from "@/app/(portal)/operations/member-command-center/pof-actions";
import type { PofRequestSummary } from "@/lib/services/pof-esign";
import { formatDateTime, formatOptionalDate } from "@/lib/utils";

type PhysicianOrderListRow = {
  id: string;
  status: string;
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

export function MemberCommandCenterPofSection({
  memberId,
  physicianOrders,
  requests,
  defaultNurseName,
  defaultFromEmail,
  canCreatePhysicianOrders
}: {
  memberId: string;
  physicianOrders: PhysicianOrderListRow[];
  requests: PofRequestSummary[];
  defaultNurseName: string;
  defaultFromEmail: string;
  canCreatePhysicianOrders: boolean;
}) {
  const [modalState, setModalState] = useState<ModalState>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const latestRequestByPofId = useMemo(() => {
    const map = new Map<string, PofRequestSummary>();
    requests.forEach((request) => {
      if (!map.has(request.physicianOrderId)) {
        map.set(request.physicianOrderId, request);
      }
    });
    return map;
  }, [requests]);

  function openSendModal(row: PhysicianOrderListRow) {
    setStatus(null);
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

  function submitModal() {
    if (!modalState) return;
    startTransition(async () => {
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

      const result =
        modalState.mode === "send"
          ? await sendPofSignatureRequestAction(formData)
          : await resendPofSignatureRequestAction(formData);

      if (!result.ok) {
        setStatus(`Error: ${result.error}`);
        return;
      }
      setStatus(modalState.mode === "send" ? "POF signature request sent." : "POF signature request resent.");
      setModalState(null);
      router.refresh();
    });
  }

  function onVoid(requestId: string, physicianOrderId: string) {
    if (!window.confirm("Void this POF signature request?")) return;
    setStatus(null);
    startTransition(async () => {
      const result = await voidPofSignatureRequestAction({
        requestId,
        memberId,
        physicianOrderId,
        reason: "voided_by_staff"
      });
      if (!result.ok) {
        setStatus(`Error: ${result.error}`);
        return;
      }
      setStatus("POF signature request voided.");
      router.refresh();
    });
  }

  function onDownloadSigned(requestId: string) {
    setStatus(null);
    startTransition(async () => {
      const result = await getSignedPofDownloadUrlAction({ requestId, memberId });
      if (!result.ok) {
        setStatus(`Error: ${result.error}`);
        return;
      }
      triggerDownload(result.signedUrl);
      setStatus("Signed PDF opened.");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Link href={`/health/physician-orders?memberId=${memberId}`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
          Open Full POF List
        </Link>
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
              <th>E-Sign Status</th>
              <th>Provider</th>
              <th>Sent</th>
              <th>Signed</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {physicianOrders.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-sm text-muted">
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
                return (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/health/physician-orders/${row.id}?from=mcc`} className="font-semibold text-brand">
                        Open POF
                      </Link>
                    </td>
                    <td>{row.status}</td>
                    <td>
                      <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusBadgeClass(eSignStatus)}`}>
                        {eSignStatus}
                      </span>
                    </td>
                    <td>{request?.providerName ?? row.providerName ?? "-"}</td>
                    <td>{request?.sentAt ? formatDateTime(request.sentAt) : row.completedDate ? formatOptionalDate(row.completedDate) : "-"}</td>
                    <td>{request?.signedAt ? formatDateTime(request.signedAt) : row.signedDate ? formatOptionalDate(row.signedDate) : "-"}</td>
                    <td>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {canSendNew ? (
                          <button
                            type="button"
                            className="font-semibold text-brand"
                            onClick={() => openSendModal(row)}
                            disabled={isPending}
                          >
                            Send for Signature
                          </button>
                        ) : null}
                        {canResend ? (
                          <button
                            type="button"
                            className="font-semibold text-brand"
                            onClick={() => openResendModal(row, request)}
                            disabled={isPending}
                          >
                            Resend
                          </button>
                        ) : null}
                        {canVoid ? (
                          <button
                            type="button"
                            className="font-semibold text-red-700"
                            onClick={() => onVoid(request!.id, row.id)}
                            disabled={isPending}
                          >
                            Void
                          </button>
                        ) : null}
                        {canDownloadSigned ? (
                          <button
                            type="button"
                            className="font-semibold text-brand"
                            onClick={() => onDownloadSigned(request!.id)}
                            disabled={isPending}
                          >
                            Download Signed PDF
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

      {status ? <p className="text-sm text-muted">{status}</p> : null}

      {modalState ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setModalState(null)}
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
                  onChange={(event) => setModalState((prev) => (prev ? { ...prev, providerName: event.target.value } : prev))}
                />
              </label>
              <label className="text-sm">
                <span className="text-xs font-semibold text-muted">Provider Email</span>
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-border px-3"
                  type="email"
                  value={modalState.providerEmail}
                  onChange={(event) => setModalState((prev) => (prev ? { ...prev, providerEmail: event.target.value } : prev))}
                />
              </label>
              <label className="text-sm">
                <span className="text-xs font-semibold text-muted">From Email</span>
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-border px-3"
                  type="email"
                  value={modalState.fromEmail}
                  onChange={(event) => setModalState((prev) => (prev ? { ...prev, fromEmail: event.target.value } : prev))}
                />
              </label>
              <label className="text-sm">
                <span className="text-xs font-semibold text-muted">Nurse Name</span>
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-border px-3"
                  value={modalState.nurseName}
                  onChange={(event) => setModalState((prev) => (prev ? { ...prev, nurseName: event.target.value } : prev))}
                />
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
                  onChange={(event) => setModalState((prev) => (prev ? { ...prev, expiresOnDate: event.target.value } : prev))}
                />
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
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="h-10 rounded-lg border border-border px-3 text-sm font-semibold"
                onClick={() => setModalState(null)}
                disabled={isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white"
                onClick={submitModal}
                disabled={isPending}
              >
                {isPending ? "Saving..." : modalState.mode === "send" ? "Send for Signature" : "Resend"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
