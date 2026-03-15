import Link from "next/link";
import { notFound } from "next/navigation";

import { PofDocumentRender } from "@/components/physician-orders/pof-document-render";
import { PofEsignWorkflowCard } from "@/components/physician-orders/pof-esign-workflow-card";
import { PhysicianOrderPdfActions } from "@/components/physician-orders/pof-pdf-actions";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getConfiguredClinicalSenderEmail, listPofTimelineForPhysicianOrder } from "@/lib/services/pof-esign";
import {
  getPhysicianOrderById,
  getPhysicianOrdersForMember
} from "@/lib/services/physician-orders-supabase";
import { formatDate, formatDateTime, formatOptionalDate } from "@/lib/utils";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function toDisplayNameFromEmail(email: string | null | undefined) {
  const local = String(email ?? "").trim().split("@")[0] ?? "";
  const withSpaces = local.replace(/[._-]+/g, " ").trim();
  if (!withSpaces) return "";
  return withSpaces
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveNurseDefaultName(fullName: string | null | undefined, email: string | null | undefined) {
  const normalizedFullName = String(fullName ?? "").trim();
  if (normalizedFullName && normalizedFullName.includes(" ")) return normalizedFullName;
  const fromEmail = toDisplayNameFromEmail(email);
  if (fromEmail) return fromEmail;
  return normalizedFullName || "Nurse";
}

export default async function PhysicianOrderDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ pofId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireRoles(["admin", "nurse"]);
  const canEdit = profile.role === "admin" || profile.role === "nurse";
  const { pofId } = await params;
  const query = await searchParams;
  const source = firstString(query.from);
  const pdfSaveFailed = firstString(query.pdfSave) === "failed";

  const form = await getPhysicianOrderById(pofId);
  if (!form) notFound();

  const history = await getPhysicianOrdersForMember(form.memberId);
  const pofTimeline = await listPofTimelineForPhysicianOrder(form.id);
  const latestRequest = pofTimeline.requests[0] ?? null;
  const currentNurseName = resolveNurseDefaultName(profile.full_name, profile.email);
  const defaultFromEmail = profile.email?.trim() || getConfiguredClinicalSenderEmail();
  const backHref =
    source === "mhp"
      ? `/health/member-health-profiles/${form.memberId}`
      : source === "mcc"
        ? `/operations/member-command-center/${form.memberId}`
        : `/health/physician-orders?memberId=${form.memberId}`;

  const canEditThisOrder = canEdit && form.status !== "Signed" && form.status !== "Superseded" && form.status !== "Expired";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <BackArrowButton fallbackHref={backHref} forceFallback ariaLabel="Back to physician orders" />
          <CardTitle>Physician Order Form</CardTitle>
        </div>
        <p className="mt-1 text-sm text-muted">
          Member: <span className="font-semibold">{form.memberNameSnapshot}</span> | DOB: {formatOptionalDate(form.memberDobSnapshot)}
        </p>
        {form.intakeAssessmentId ? (
          <p className="mt-1 text-xs text-muted">
            Intake Source: <span className="font-semibold">{form.intakeAssessmentId}</span>
          </p>
        ) : null}
        <div className="mt-2 grid gap-2 text-xs text-muted sm:grid-cols-2 lg:grid-cols-4">
          <p>Status: <span className="font-semibold text-primary-text">{form.status}</span></p>
          <p>Workflow Status: <span className="font-semibold text-primary-text">{latestRequest?.status ?? "draft"}</span></p>
          <p>Clinical Sync: <span className="font-semibold text-primary-text">{form.clinicalSyncStatus === "synced" ? "Synced" : form.clinicalSyncStatus === "pending" ? "Pending Clinical Sync" : "-"}</span></p>
          <p>Sent: <span className="font-semibold text-primary-text">{form.completedDate ? formatDate(form.completedDate) : "-"}</span></p>
          <p>Next Renewal Due: <span className="font-semibold text-primary-text">{form.nextRenewalDueDate ? formatDate(form.nextRenewalDueDate) : "-"}</span></p>
          <p>Signed: <span className="font-semibold text-primary-text">{form.signedDate ? formatDate(form.signedDate) : "-"}</span></p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {canEditThisOrder ? (
            <Link href={`/health/physician-orders/new?pofId=${form.id}`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
              Edit / Update Form
            </Link>
          ) : null}
          <Link href={`/health/physician-orders/${form.id}/print`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
            Print-Friendly View
          </Link>
          {canEdit ? (
            <Link href={`/health/physician-orders/new?memberId=${form.memberId}`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
              New Order for Member
            </Link>
          ) : null}
        </div>
        <div className="mt-3">
          <PhysicianOrderPdfActions pofId={form.id} />
        </div>
      </Card>

      {pdfSaveFailed ? (
        <Card>
          <p className="text-sm font-semibold text-amber-700">POF was saved, but automatic PDF save to member files did not complete.</p>
          <p className="mt-1 text-xs text-muted">Use Download PDF to regenerate and save the document.</p>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Provider E-Sign Workflow</CardTitle>
        <div className="mt-3">
          <PofEsignWorkflowCard
            memberId={form.memberId}
            physicianOrderId={form.id}
            latestRequest={latestRequest}
            defaultProviderName={form.providerName ?? ""}
            defaultProviderEmail={latestRequest?.providerEmail ?? ""}
            defaultNurseName={currentNurseName}
            defaultFromEmail={defaultFromEmail}
            defaultOptionalMessage={latestRequest?.optionalMessage ?? ""}
            signedProviderName={form.providerName}
            signedAt={latestRequest?.signedAt ?? null}
            showProviderNameInput={false}
          />
        </div>
      </Card>

      <PofDocumentRender
        form={form}
        title="POF Read-Only Review"
        metaLines={[
          `Status: ${form.status}`,
          `Workflow: ${latestRequest?.status ?? "draft"}`,
          `Updated: ${formatDateTime(form.updatedAt)}`
        ]}
      />

      <Card className="table-wrap">
        <CardTitle>Member POF History</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Status</th>
              <th>Provider</th>
              <th>Sent</th>
              <th>Signed</th>
              <th>Updated</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => (
              <tr key={row.id}>
                <td>{row.status}</td>
                <td>{row.providerName ?? "-"}</td>
                <td>{row.completedDate ? formatDate(row.completedDate) : "-"}</td>
                <td>{row.signedDate ? formatDate(row.signedDate) : "-"}</td>
                <td>{formatDateTime(row.updatedAt)}</td>
                <td>
                  <Link href={`/health/physician-orders/${row.id}`} className="font-semibold text-brand">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>POF E-Sign Timeline</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Request</th>
              <th>Status</th>
              <th>Provider</th>
              <th>Expires</th>
              <th>Signed File</th>
            </tr>
          </thead>
          <tbody>
            {pofTimeline.requests.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-sm text-muted">
                  No e-sign requests have been sent for this POF yet.
                </td>
              </tr>
            ) : (
              pofTimeline.requests.map((request) => (
                <tr key={request.id}>
                  <td className="text-xs">{request.id}</td>
                  <td>{request.status}</td>
                  <td>{request.providerName}</td>
                  <td>{formatDateTime(request.expiresAt)}</td>
                  <td>{request.memberFileId ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <CardTitle className="mt-4">Document Events</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>When</th>
              <th>Request</th>
              <th>Event</th>
              <th>Actor</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {pofTimeline.events.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-sm text-muted">
                  No document events recorded yet.
                </td>
              </tr>
            ) : (
              pofTimeline.events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDateTime(event.createdAt)}</td>
                  <td className="text-xs">{event.documentId}</td>
                  <td>{event.eventType}</td>
                  <td>{event.actorName ?? event.actorType}</td>
                  <td>{event.actorIp ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
