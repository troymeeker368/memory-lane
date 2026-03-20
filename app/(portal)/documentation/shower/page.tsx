import { QuickEditShower } from "@/components/forms/record-actions";
import { ShowerLogFormShell } from "@/components/forms/workflow-forms-shells";
import { Card, CardTitle } from "@/components/ui/card";
import { MobileList } from "@/components/ui/mobile-list";
import { requireModuleAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import { getMembers } from "@/lib/services/documentation";
import { getDocumentationWorkflows } from "@/lib/services/documentation-workflows";
import { formatDateTime } from "@/lib/utils";

type ShowerWorkflowRow = Awaited<ReturnType<typeof getDocumentationWorkflows>>["showers"][number];

export default async function ShowerLogPage() {
  const profile = await requireModuleAccess("documentation");
  const normalizedRole = normalizeRoleKey(profile.role);
  const canEdit = normalizedRole === "admin" || normalizedRole === "manager" || normalizedRole === "director";
  const showStaffColumn = normalizedRole !== "program-assistant";
  const [members, workflows] = await Promise.all([getMembers(), getDocumentationWorkflows({ role: profile.role, staffUserId: profile.id })]);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Shower Log Entry</CardTitle>
        <p className="mt-1 text-sm text-muted">Capture shower completion, laundry support, and briefs changes.</p>
        <div className="mt-3"><ShowerLogFormShell members={members} /></div>
      </Card>

      <MobileList items={workflows.showers.map((row: ShowerWorkflowRow) => ({ id: row.id, title: row.member_name, fields: [{ label: "When", value: formatDateTime(row.event_at) }, { label: "Laundry", value: row.laundry ? "Yes" : "No" }, { label: "Briefs", value: row.briefs ? "Yes" : "No" }, ...(showStaffColumn ? [{ label: "Staff", value: row.staff_name }] : [])] }))} />

      <Card className="table-wrap hidden md:block">
        <CardTitle>Recent Shower Entries</CardTitle>
        <table>
          <thead><tr><th>When</th><th>Member</th><th>Laundry</th><th>Briefs</th>{showStaffColumn ? <th>Staff</th> : null}<th>Notes</th>{canEdit ? <th>Edit</th> : null}</tr></thead>
          <tbody>
            {workflows.showers.map((row: ShowerWorkflowRow) => (
              <tr key={row.id}><td>{formatDateTime(row.event_at)}</td><td>{row.member_name}</td><td>{row.laundry ? "Yes" : "No"}</td><td>{row.briefs ? "Yes" : "No"}</td>{showStaffColumn ? <td>{row.staff_name}</td> : null}<td>{row.notes ?? "-"}</td>{canEdit ? <td><QuickEditShower id={row.id} laundry={row.laundry} briefs={row.briefs} notes={row.notes} /></td> : null}</tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

