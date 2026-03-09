import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { PunchTypeBadge } from "@/components/ui/punch-type-badge";
import { getCurrentProfile, requireModuleAccess } from "@/lib/auth";
import { getPunchHistory } from "@/lib/services/time";
import { formatDateTime } from "@/lib/utils";

export default async function PunchHistoryPage() {
  await requireModuleAccess("time-card");
  const profile = await getCurrentProfile();
  const showStaffColumn = profile.role !== "staff";
  const punches = await getPunchHistory(profile.id, profile.role);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Punch History</CardTitle>
            <p className="mt-1 text-sm text-muted">{profile.role === "admin" || profile.role === "manager" ? "All staff punches for operational review." : "Your punch history."}</p>
          </div>
          <BackArrowButton fallbackHref="/time-card" ariaLabel="Back to time clock" />
        </div>
      </Card>

      <Card className="table-wrap">
        <table>
          <thead>
            <tr>
              {showStaffColumn ? <th>Staff</th> : null}
              <th>Date/Time</th>
              <th>Punch Type</th>
              <th>Within Fence</th>
              <th>Distance (m)</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {punches.map((punch: any) => (
              <tr key={punch.id}>
                {showStaffColumn ? <td>{punch.staff_name}</td> : null}
                <td>{formatDateTime(punch.punch_at)}</td>
                <td><PunchTypeBadge punchType={punch.punch_type} /></td>
                <td>{punch.within_fence ? "Yes" : "No"}</td>
                <td>{punch.distance_meters ?? "-"}</td>
                <td>{punch.note ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
