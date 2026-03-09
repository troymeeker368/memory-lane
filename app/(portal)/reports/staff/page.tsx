import { redirect } from "next/navigation";

import { requireModuleAccess } from "@/lib/auth";
import { getStaffSnapshotStaffOptions } from "@/lib/services/activity-snapshots";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function buildStaffHref(staffSlug: string, from?: string, to?: string) {
  const query = new URLSearchParams();
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  const suffix = query.toString();
  return `/reports/staff/${staffSlug}${suffix ? `?${suffix}` : ""}`;
}

export default async function StaffActivityListPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleAccess("reports");

  const [query, staffOptions] = await Promise.all([searchParams, getStaffSnapshotStaffOptions()]);
  const from = firstString(query.from);
  const to = firstString(query.to);
  const requestedStaff = firstString(query.staff);
  const fallbackStaff = staffOptions[0]?.slug;
  const resolvedStaff = staffOptions.find((staff) => staff.slug === requestedStaff)?.slug ?? fallbackStaff;

  if (!resolvedStaff) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-white p-4">
          <h1 className="text-lg font-semibold">Staff Activity</h1>
          <p className="mt-2 text-sm text-muted">No active staff records are available for this report.</p>
        </div>
      </div>
    );
  }

  redirect(buildStaffHref(resolvedStaff, from, to));
}
