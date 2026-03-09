import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getMockDb } from "@/lib/mock-repo";
import { formatDateTime } from "@/lib/utils";

export default async function AdminAuditTrailPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoles(["admin"]);

  const query = searchParams ? await searchParams : {};
  const actionFilter = typeof query.action === "string" ? query.action.trim() : "";
  const entityFilter = typeof query.entity === "string" ? query.entity.trim() : "";

  const db = getMockDb();
  const rows = [...db.auditLogs]
    .filter((row) => (actionFilter ? row.action === actionFilter : true))
    .filter((row) => (entityFilter ? row.entity_type.toLowerCase().includes(entityFilter.toLowerCase()) : true))
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>System Audit Trail</CardTitle>
        <p className="mt-1 text-sm text-muted">Operational and security event history for key actions in mock mode.</p>
        <form className="mt-3 grid gap-2 md:grid-cols-4" method="get">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="action">
              Action
            </label>
            <select id="action" name="action" defaultValue={actionFilter} className="h-10 w-full rounded-lg border border-border px-3 text-sm">
              <option value="">All</option>
              <option value="clock_in">clock_in</option>
              <option value="clock_out">clock_out</option>
              <option value="create_log">create_log</option>
              <option value="update_log">update_log</option>
              <option value="create_lead">create_lead</option>
              <option value="update_lead">update_lead</option>
              <option value="send_email">send_email</option>
              <option value="upload_photo">upload_photo</option>
              <option value="manager_review">manager_review</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="entity">
              Entity
            </label>
            <input id="entity" name="entity" defaultValue={entityFilter} placeholder="lead, ancillary, time_punch..." className="h-10 w-full rounded-lg border border-border px-3 text-sm" />
          </div>
          <div className="md:col-span-2 flex items-end gap-2">
            <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
              Apply Filters
            </button>
            <a href="/admin-reports/audit-trail" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10">
              Clear Filters
            </a>
          </div>
        </form>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Recent Audit Events</CardTitle>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Role</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Entity ID</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-sm text-muted">
                  No audit events found for selected filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.occurred_at)}</td>
                  <td>{row.actor_name}</td>
                  <td className="uppercase">{row.actor_role}</td>
                  <td>{row.action}</td>
                  <td>{row.entity_type}</td>
                  <td>{row.entity_id ?? "-"}</td>
                  <td className="max-w-[420px] truncate" title={row.details_json}>
                    {row.details_json}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
