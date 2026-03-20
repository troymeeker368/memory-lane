import { QuickEditBloodSugar } from "@/components/forms/record-actions";
import { BloodSugarFormShell } from "@/components/forms/workflow-forms-shells";
import { Card, CardTitle } from "@/components/ui/card";
import { MobileList } from "@/components/ui/mobile-list";
import { requireModuleAccess } from "@/lib/auth";
import { getMembers } from "@/lib/services/documentation";
import { getHealthSnapshot } from "@/lib/services/health-workflows";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
type BloodSugarHistoryRow = Awaited<ReturnType<typeof getHealthSnapshot>>["bloodSugarHistory"][number];

export default async function BloodSugarPage() {
  const profile = await requireModuleAccess("health");
  const canEdit = profile.role === "admin" || profile.role === "manager";
  const [members, snapshot] = await Promise.all([getMembers(), getHealthSnapshot()]);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Blood Sugar Testing</CardTitle>
        <p className="mt-1 text-sm text-muted">Nurse-focused entry workflow with member lookup and timestamped clinical logs.</p>
        <div className="mt-3"><BloodSugarFormShell members={members} /></div>
      </Card>

      <MobileList items={snapshot.bloodSugarHistory.map((row: BloodSugarHistoryRow) => ({ id: row.id, title: row.member_name, fields: [{ label: "Checked", value: formatDateTime(row.checked_at) }, { label: "Reading", value: row.reading_mg_dl }, { label: "Nurse", value: row.nurse_name }] }))} />

      <Card className="table-wrap hidden md:block">
        <CardTitle>Recent Blood Sugar Logs</CardTitle>
        <table>
          <thead><tr><th>Checked At</th><th>Member</th><th>Reading</th><th>Nurse</th><th>Notes</th>{canEdit ? <th>Edit</th> : null}</tr></thead>
          <tbody>
            {snapshot.bloodSugarHistory.map((row: BloodSugarHistoryRow) => (
              <tr key={row.id}><td>{formatDateTime(row.checked_at)}</td><td>{row.member_name}</td><td>{row.reading_mg_dl}</td><td>{row.nurse_name}</td><td>{row.notes ?? "-"}</td>{canEdit ? <td><QuickEditBloodSugar id={row.id} reading={row.reading_mg_dl} notes={row.notes} /></td> : null}</tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
