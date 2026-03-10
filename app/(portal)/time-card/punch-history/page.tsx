import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { PunchTypeBadge } from "@/components/ui/punch-type-badge";
import { getCurrentProfile, requireModuleAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import { getPunchHistory } from "@/lib/services/time";
import { formatDateTime } from "@/lib/utils";

function formatFenceValue(value: boolean | null | undefined) {
  if (value == null) return "-";
  return value ? "Yes" : "No";
}

function describePunchMeta(punch: { source?: string | null; status?: string | null; note?: string | null }) {
  const tags: string[] = [];
  if (punch.status && punch.status !== "active") tags.push(punch.status);
  if (punch.source && punch.source !== "employee") tags.push(punch.source);
  const prefix = tags.length ? `[${tags.join(" | ")}] ` : "";
  return `${prefix}${punch.note ?? "-"}`;
}

export default async function PunchHistoryPage() {
  await requireModuleAccess("time-card");
  const profile = await getCurrentProfile();
  const normalizedRole = normalizeRoleKey(profile.role);
  const showStaffColumn = normalizedRole !== "program-assistant";
  const punches = await getPunchHistory(profile.id, profile.role);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Punch History</CardTitle>
            <p className="mt-1 text-sm text-muted">{normalizedRole === "admin" || normalizedRole === "manager" || normalizedRole === "director" ? "All staff punches for operational review." : "Your punch history."}</p>
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
                <td>{formatFenceValue(punch.within_fence)}</td>
                <td>{punch.distance_meters ?? "-"}</td>
                <td>{describePunchMeta(punch)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
