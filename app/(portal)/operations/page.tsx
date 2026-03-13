import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import type { AppRole } from "@/types/app";

const SECTIONS = [
  { href: "/operations/attendance", label: "Attendance", description: "Operational attendance scheduling and enrollment cadence." },
  { href: "/operations/member-command-center", label: "Member Command Center", description: "Coordinator-focused member master record and linked operations." },
  { href: "/operations/schedule-changes", label: "Schedule Changes", description: "Create temporary or permanent attendance schedule exceptions without destroying recurring history." },
  { href: "/operations/pricing", label: "Pricing", description: "Canonical enrollment pricing defaults for Enrollment Packet workflows.", roles: ["admin", "director"] as AppRole[] },
  { href: "/operations/additional-charges", label: "Additional Charges", description: "Quick bridge into ancillary/additional charges oversight." },
  { href: "/operations/holds", label: "Holds", description: "Date-aware hold management that feeds attendance, census, and transportation manifests." },
  { href: "/operations/payor", label: "Billing", description: "Hybrid billing module for agreements, schedule-based prebilling, arrears, batch review, and exports." },
  { href: "/operations/locker-assignments", label: "Locker Assignments", description: "Manage controlled locker resources and member assignments with conflict checks." },
  { href: "/operations/transportation-station", label: "Transportation Station", description: "Generate daily AM/PM manifests grouped by bus with one-day add/exclude overrides." }
] as const;

export default async function OperationsHomePage() {
  const profile = await requireModuleAccess("operations");
  const role = normalizeRoleKey(profile.role);
  const visibleSections = SECTIONS.filter((section) => {
    if (!("roles" in section) || !section.roles?.length) return true;
    return section.roles.map((item) => normalizeRoleKey(item)).includes(role);
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Operations</CardTitle>
        <p className="mt-1 text-sm text-muted">Xcite-style operational menu with Member Command Center as the member master hub.</p>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visibleSections.map((section) => (
          <Link key={section.href} href={section.href} className="rounded-xl border border-border bg-white p-4 shadow-[0_1px_4px_rgba(27,62,147,0.08)] hover:border-brand">
            <p className="text-sm font-semibold text-fg">{section.label}</p>
            <p className="mt-1 text-xs text-muted">{section.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
