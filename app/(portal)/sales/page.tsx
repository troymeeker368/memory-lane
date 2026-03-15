import type { ReactNode } from "react";
import Link from "next/link";
import { BarChart3, Building2, CirclePlus, Clock3, GitBranch } from "lucide-react";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import { getSalesHomeSnapshotSupabase } from "@/lib/services/sales-crm-supabase";

function SalesMenuCard({ href, label, subtitle, icon }: { href: string; label: string; subtitle: string; icon: ReactNode }) {
  return (
    <Link href={href} className="rounded-lg border border-border bg-white p-4 hover:bg-slate-50">
      <div className="flex items-center gap-2 text-base font-semibold text-brand">{icon}<span>{label}</span></div>
      <p className="mt-1 text-xs text-muted">{subtitle}</p>
    </Link>
  );
}

export default async function SalesPage() {
  const profile = await requireModuleAccess("sales");
  const isAdmin = normalizeRoleKey(profile.role) === "admin";
  const snapshot = await getSalesHomeSnapshotSupabase();

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Sales Activities</CardTitle>
        <p className="mt-1 text-sm text-muted">AppSheet-style grouped navigation: Pipeline, New Entries, Community Partners, and Recent Activity.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SalesMenuCard href="/sales/pipeline" label="Pipeline" subtitle={`${snapshot.openLeadCount} open leads across stage views`} icon={<GitBranch className="h-4 w-4" />} />
          <SalesMenuCard href="/sales/new-entries" label="New Entries" subtitle="New Inquiry, Log Lead Activity, Log Partner Activities, and setup forms" icon={<CirclePlus className="h-4 w-4" />} />
          <SalesMenuCard href="/sales/community-partners" label="Community Partners" subtitle={`${snapshot.partnerCount} organizations, ${snapshot.referralSourceCount} referral sources`} icon={<Building2 className="h-4 w-4" />} />
          <SalesMenuCard href="/sales/activities" label="Recent Lead Activity" subtitle={`${snapshot.leadActivityCount} lead + ${snapshot.partnerActivityCount} partner activities`} icon={<Clock3 className="h-4 w-4" />} />
          {isAdmin ? (
            <SalesMenuCard href="/sales/summary" label="Sales Summary" subtitle="Admin foundation dashboard for lead totals, stages, EIP, and inquiry activity" icon={<BarChart3 className="h-4 w-4" />} />
          ) : null}
        </div>
      </Card>
    </div>
  );
}
