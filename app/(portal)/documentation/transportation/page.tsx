import { QuickEditTransportation } from "@/components/forms/record-actions";
import { TransportationLogForm } from "@/components/forms/workflow-forms";
import { Card, CardTitle } from "@/components/ui/card";
import { MobileList } from "@/components/ui/mobile-list";
import { requireModuleAccess } from "@/lib/auth";
import { getMembers } from "@/lib/services/documentation";
import { getDocumentationWorkflows } from "@/lib/services/documentation-workflows";
import { formatDate } from "@/lib/utils";

export default async function TransportationLogPage() {
  const profile = await requireModuleAccess("documentation");
  const canEdit = profile.role === "admin" || profile.role === "manager";
  const showStaffColumn = profile.role !== "staff";
  const [members, workflows] = await Promise.all([getMembers(), getDocumentationWorkflows({ role: profile.role, staffUserId: profile.id })]);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Transportation Log Entry</CardTitle>
        <p className="mt-1 text-sm text-muted">Transport options are workbook-controlled: Door to door, Bus stop, Refused/no show.</p>
        <div className="mt-3"><TransportationLogForm members={members} /></div>
      </Card>

      <MobileList items={workflows.transportation.map((row: any) => ({ id: row.id, title: row.member_name, fields: [{ label: "Date", value: formatDate(row.service_date) }, { label: "AM/PM", value: row.period }, { label: "Type", value: row.transport_type }, ...(showStaffColumn ? [{ label: "Staff", value: row.staff_name }] : [])] }))} />

      <Card className="table-wrap hidden md:block">
        <CardTitle>Recent Transportation Entries</CardTitle>
        <table>
          <thead><tr><th>Date</th><th>AM/PM</th><th>Member</th><th>Type</th>{showStaffColumn ? <th>Staff</th> : null}{canEdit ? <th>Edit</th> : null}</tr></thead>
          <tbody>
            {workflows.transportation.map((row: any) => (
              <tr key={row.id}><td>{formatDate(row.service_date)}</td><td>{row.period}</td><td>{row.member_name}</td><td>{row.transport_type}</td>{showStaffColumn ? <td>{row.staff_name}</td> : null}{canEdit ? <td><QuickEditTransportation id={row.id} period={row.period} transportType={row.transport_type} /></td> : null}</tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

