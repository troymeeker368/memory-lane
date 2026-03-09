import { DailyActivityForm } from "@/components/forms/daily-activity-form";
import { QuickEditDailyActivity } from "@/components/forms/record-actions";
import { Card, CardTitle } from "@/components/ui/card";
import { MobileList } from "@/components/ui/mobile-list";
import { requireModuleAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import { getMembers } from "@/lib/services/documentation";
import { getDocumentationWorkflows } from "@/lib/services/documentation-workflows";
import { formatDate } from "@/lib/utils";

function missingReasons(row: any) {
  return [
    row.reason_missing_activity_1,
    row.reason_missing_activity_2,
    row.reason_missing_activity_3,
    row.reason_missing_activity_4,
    row.reason_missing_activity_5
  ].filter(Boolean).join(" | ");
}

export default async function DocumentationActivityPage() {
  const profile = await requireModuleAccess("documentation");
  const normalizedRole = normalizeRoleKey(profile.role);
  const canEdit = normalizedRole === "admin" || normalizedRole === "manager" || normalizedRole === "director";
  const showStaffColumn = normalizedRole !== "program-assistant";
  const [members, workflows] = await Promise.all([getMembers(), getDocumentationWorkflows({ role: profile.role, staffUserId: profile.id })]);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Participation Log</CardTitle>
        <p className="mt-1 text-sm text-muted">Use Activity 1-5 levels. Any activity set to 0% requires a reason from the workbook reason list.</p>
        <div className="mt-4"><DailyActivityForm members={members} /></div>
      </Card>

      <MobileList
        items={workflows.dailyActivities.map((row: any) => ({
          id: row.id,
          title: row.member_name,
          fields: [
            { label: "Date", value: formatDate(row.activity_date) },
            { label: "Participation", value: `${row.participation}%` },
            { label: "A1-A5", value: `${row.activity_1_level}/${row.activity_2_level}/${row.activity_3_level}/${row.activity_4_level}/${row.activity_5_level}` },
            { label: "Missing Reasons", value: missingReasons(row) || "-" },
            ...(showStaffColumn ? [{ label: "Staff", value: row.staff_name }] : [])
          ]
        }))}
      />

      <Card className="table-wrap hidden md:block">
        <CardTitle>Recent Participation Log Entries</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Member</th>
              <th>Participation</th>
              <th>A1</th>
              <th>A2</th>
              <th>A3</th>
              <th>A4</th>
              <th>A5</th>
              <th>Missing Reasons</th>
              {showStaffColumn ? <th>Staff</th> : null}
              {canEdit ? <th>Edit</th> : null}
            </tr>
          </thead>
          <tbody>
            {workflows.dailyActivities.map((row: any) => (
              <tr key={row.id}>
                <td>{formatDate(row.activity_date)}</td>
                <td>{row.member_name}</td>
                <td>{row.participation}%</td>
                <td>{row.activity_1_level}</td>
                <td>{row.activity_2_level}</td>
                <td>{row.activity_3_level}</td>
                <td>{row.activity_4_level}</td>
                <td>{row.activity_5_level}</td>
                <td>{missingReasons(row) || "-"}</td>
                {showStaffColumn ? <td>{row.staff_name}</td> : null}
                {canEdit ? <td><QuickEditDailyActivity id={row.id} a1={row.activity_1_level} a2={row.activity_2_level} a3={row.activity_3_level} a4={row.activity_4_level} a5={row.activity_5_level} r1={row.reason_missing_activity_1} r2={row.reason_missing_activity_2} r3={row.reason_missing_activity_3} r4={row.reason_missing_activity_4} r5={row.reason_missing_activity_5} notes={row.notes} /></td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}


