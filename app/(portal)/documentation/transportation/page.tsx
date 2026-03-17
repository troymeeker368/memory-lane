import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { MobileList } from "@/components/ui/mobile-list";
import { requireModuleAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import { getDocumentationWorkflows } from "@/lib/services/documentation-workflows";
import { formatDate } from "@/lib/utils";

export default async function TransportationLogPage() {
  const profile = await requireModuleAccess("documentation");
  const normalizedRole = normalizeRoleKey(profile.role);
  const showStaffColumn = normalizedRole !== "program-assistant";
  const workflows = await getDocumentationWorkflows({ role: profile.role, staffUserId: profile.id });

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Transportation Posting History</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Transportation is now posted from Transportation Station as one batch run per date, shift, and bus. Individual documentation entry is disabled to prevent duplicate transport facts and billing drift.
        </p>
        <div className="mt-3">
          <Link href="/operations/transportation-station" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
            Open Transportation Station
          </Link>
        </div>
      </Card>

      <MobileList
        items={workflows.transportation.map((row: any) => ({
          id: row.id,
          title: row.member_name,
          fields: [
            { label: "Date", value: formatDate(row.service_date) },
            { label: "AM/PM", value: row.period },
            { label: "Type", value: row.transport_type },
            ...(showStaffColumn ? [{ label: "Staff", value: row.staff_name }] : [])
          ]
        }))}
      />

      <Card className="table-wrap hidden md:block">
        <CardTitle>Recent Transportation Facts</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>AM/PM</th>
              <th>Member</th>
              <th>Type</th>
              {showStaffColumn ? <th>Staff</th> : null}
            </tr>
          </thead>
          <tbody>
            {workflows.transportation.map((row: any) => (
              <tr key={row.id}>
                <td>{formatDate(row.service_date)}</td>
                <td>{row.period}</td>
                <td>{row.member_name}</td>
                <td>{row.transport_type}</td>
                {showStaffColumn ? <td>{row.staff_name}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
