import { QuickEditToilet } from "@/components/forms/record-actions";
import { ToiletLogFormShell } from "@/components/forms/workflow-forms-shells";
import { Card, CardTitle } from "@/components/ui/card";
import { MobileList } from "@/components/ui/mobile-list";
import { requireModuleAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import { getDocumentationWorkflows } from "@/lib/services/documentation-workflows";
import { formatDateTime } from "@/lib/utils";

function briefsLabel(briefs: boolean, memberSupplied: boolean) {
  if (!briefs) return "No";
  return memberSupplied ? "Yes (member supplied - no charge)" : "Yes";
}

type ToiletWorkflowRow = Awaited<ReturnType<typeof getDocumentationWorkflows>>["toilets"][number];

export default async function ToiletLogPage() {
  const profile = await requireModuleAccess("documentation");
  const normalizedRole = normalizeRoleKey(profile.role);
  const canEdit = normalizedRole === "admin" || normalizedRole === "manager" || normalizedRole === "director";
  const showStaffColumn = normalizedRole !== "program-assistant";
  const workflows = await getDocumentationWorkflows({ role: profile.role, staffUserId: profile.id });
  const toiletRows = workflows.toilets ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Toilet Log Entry</CardTitle>
        <p className="mt-1 text-sm text-muted">Record toileting type and briefs/member-supplied values from the AppSheet workflow.</p>
        <div className="mt-3"><ToiletLogFormShell /></div>
      </Card>

      <MobileList items={toiletRows.map((row: ToiletWorkflowRow) => ({ id: row.id, title: row.member_name, fields: [{ label: "When", value: formatDateTime(row.event_at) }, { label: "Type of Use", value: row.use_type }, { label: "Briefs", value: briefsLabel(row.briefs, row.member_supplied) }] }))} />

      <Card className="table-wrap hidden md:block">
        <CardTitle>Recent Toilet Entries</CardTitle>
        <table>
          <thead><tr><th>When</th><th>Member</th><th>Type of Use</th><th>Briefs</th>{showStaffColumn ? <th>Staff</th> : null}<th>Notes</th>{canEdit ? <th>Edit</th> : null}</tr></thead>
          <tbody>
            {toiletRows.map((row: ToiletWorkflowRow) => (
              <tr key={row.id}><td>{formatDateTime(row.event_at)}</td><td>{row.member_name}</td><td>{row.use_type}</td><td>{briefsLabel(row.briefs, row.member_supplied)}</td>{showStaffColumn ? <td>{row.staff_name}</td> : null}<td>{row.notes ?? "-"}</td>{canEdit ? <td><QuickEditToilet id={row.id} useType={row.use_type} briefs={row.briefs} memberSupplied={row.member_supplied} notes={row.notes} /></td> : null}</tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

