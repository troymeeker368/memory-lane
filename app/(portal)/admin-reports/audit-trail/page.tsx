import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getMockDb } from "@/lib/mock-repo";
import { formatDateTime } from "@/lib/utils";

function parseDetails(detailsJson: string) {
  try {
    const parsed = JSON.parse(detailsJson);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function firstText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function yesNo(value: unknown) {
  return value === true ? "Yes" : "No";
}

function friendlyArea(entityType: string) {
  const normalized = entityType.toLowerCase();
  if (normalized.includes("time")) return "Time & Attendance";
  if (normalized.includes("lead")) return "Sales";
  if (normalized.includes("photo")) return "Documentation";
  if (normalized.includes("transport")) return "Transportation";
  if (normalized.includes("member")) return "Member";
  if (normalized.includes("charge") || normalized.includes("ancillary")) return "Charges";
  return "General";
}

function buildSummary(row: ReturnType<typeof getMockDb>["auditLogs"][number]) {
  const details = parseDetails(row.details_json);

  if (row.action === "clock_in") {
    const site = firstText(details.site) || "the center";
    const withinFence = details.withinFence === false ? "outside fence" : "inside fence";
    return `Clocked in at ${site} (${withinFence}).`;
  }

  if (row.action === "clock_out") {
    const site = firstText(details.site) || "the center";
    return `Clocked out at ${site}.`;
  }

  if (row.action === "create_log") {
    const logType = firstText(details.logType) || "documentation entry";
    const memberName = firstText(details.memberName);
    return memberName ? `Created ${logType} for ${memberName}.` : `Created ${logType}.`;
  }

  if (row.action === "update_log") {
    const logType = firstText(details.logType) || "documentation entry";
    const memberName = firstText(details.memberName);
    return memberName ? `Updated ${logType} for ${memberName}.` : `Updated ${logType}.`;
  }

  if (row.action === "create_lead") {
    const memberName = firstText(details.memberName) || "lead";
    const stage = firstText(details.stage);
    return stage ? `Created lead for ${memberName} at stage ${stage}.` : `Created lead for ${memberName}.`;
  }

  if (row.action === "update_lead") {
    const fromStage = firstText(details.fromStage);
    const toStage = firstText(details.toStage);
    const fromStatus = firstText(details.fromStatus);
    const toStatus = firstText(details.toStatus);
    if (fromStage || toStage) {
      return `Lead stage updated from ${fromStage || "N/A"} to ${toStage || "N/A"}.`;
    }
    if (fromStatus || toStatus) {
      return `Lead status updated from ${fromStatus || "N/A"} to ${toStatus || "N/A"}.`;
    }
    return "Updated lead details.";
  }

  if (row.action === "send_email") {
    const recipient = firstText(details.recipient) || firstText(details.to);
    return recipient ? `Sent email to ${recipient}.` : "Sent email.";
  }

  if (row.action === "upload_photo") {
    const memberName = firstText(details.memberName);
    return memberName ? `Uploaded photo for ${memberName}.` : "Uploaded member photo.";
  }

  if (row.action === "manager_review") {
    const reviewType = firstText(details.reviewType) || "review";
    const approved = details.approved === undefined ? "" : ` Approved: ${yesNo(details.approved)}.`;
    return `Completed ${reviewType}.${approved}`;
  }

  return "Recorded system activity.";
}

export default async function AdminAuditTrailPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoles(["admin"]);

  const query = searchParams ? await searchParams : {};
  const actionFilter = typeof query.action === "string" ? query.action.trim() : "";
  const areaFilter = typeof query.area === "string" ? query.area.trim().toLowerCase() : "";

  const db = getMockDb();
  const rows = [...db.auditLogs]
    .filter((row) => (actionFilter ? row.action === actionFilter : true))
    .filter((row) => (areaFilter ? friendlyArea(row.entity_type).toLowerCase().includes(areaFilter) : true))
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>System Activity History</CardTitle>
        <p className="mt-1 text-sm text-muted">Plain-language timeline of operational and security events.</p>
        <form className="mt-3 grid gap-2 md:grid-cols-4" method="get">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="action">
              Action
            </label>
            <select id="action" name="action" defaultValue={actionFilter} className="h-10 w-full rounded-lg border border-border px-3 text-sm">
              <option value="">All actions</option>
              <option value="clock_in">Clock In</option>
              <option value="clock_out">Clock Out</option>
              <option value="create_log">Create Log</option>
              <option value="update_log">Update Log</option>
              <option value="create_lead">Create Lead</option>
              <option value="update_lead">Update Lead</option>
              <option value="send_email">Send Email</option>
              <option value="upload_photo">Upload Photo</option>
              <option value="manager_review">Manager Review</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="area">
              Area
            </label>
            <input id="area" name="area" defaultValue={areaFilter} placeholder="attendance, sales, charges..." className="h-10 w-full rounded-lg border border-border px-3 text-sm" />
          </div>
          <div className="md:col-span-2 flex items-end gap-2">
            <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
              Apply Filters
            </button>
            <Link href="/admin-reports/audit-trail" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10">
              Clear Filters
            </Link>
          </div>
        </form>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Recent Activity</CardTitle>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Role</th>
              <th>Activity</th>
              <th>Area</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-sm text-muted">
                  No events found for selected filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.occurred_at)}</td>
                  <td>{row.actor_name}</td>
                  <td className="uppercase">{row.actor_role}</td>
                  <td>{buildSummary(row)}</td>
                  <td>{friendlyArea(row.entity_type)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
