import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions/core";
import type { AppRole } from "@/types/app";

const SECTIONS = [
  { href: "/operations/member-command-center", label: "Member Command Center", description: "Canonical member workspace for overview, attendance, schedule changes, pricing, charges, holds, and locker assignments." },
  { href: "/operations/attendance", label: "Attendance Board", description: "Center-wide daily and weekly attendance, census, and track-sheet operations." },
  { href: "/operations/pricing", label: "Pricing Defaults", description: "Canonical center-wide enrollment pricing defaults for Enrollment Packet workflows.", roles: ["admin", "director"] as AppRole[] },
  { href: "/operations/payor", label: "Billing", description: "Hybrid billing module for agreements, schedule-based prebilling, arrears, batch review, and exports." },
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
        <p className="mt-1 text-sm text-muted">Member Command Center is the canonical member operations hub. Center-wide boards stay here only when they serve cross-member workflows.</p>
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
