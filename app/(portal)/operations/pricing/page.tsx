import nextDynamic from "next/dynamic";
import Link from "next/link";

import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireNavItemAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions/core";
import { getAncillarySummary } from "@/lib/services/ancillary";
import { getEnrollmentPricingOverview, listEnrollmentPricingAuditRows } from "@/lib/services/enrollment-pricing";
import { toEasternDate } from "@/lib/timezone";

type PricingTab = "overview" | "community-fee" | "daily-rates" | "ancillary-rates" | "history";
export const dynamic = "force-dynamic";

const PricingCommunityFeeManager = nextDynamic(
  () => import("@/components/operations/pricing/pricing-community-fee-manager").then((mod) => mod.PricingCommunityFeeManager),
  {
    loading: () => <p className="text-sm text-muted">Loading community fee manager...</p>
  }
);

const PricingDailyRatesManager = nextDynamic(
  () => import("@/components/operations/pricing/pricing-daily-rates-manager").then((mod) => mod.PricingDailyRatesManager),
  {
    loading: () => <p className="text-sm text-muted">Loading daily rates manager...</p>
  }
);

const AncillaryPricingManager = nextDynamic(
  () => import("@/components/forms/ancillary-pricing-manager").then((mod) => mod.AncillaryPricingManager),
  {
    loading: () => <p className="text-sm text-muted">Loading ancillary rates manager...</p>
  }
);

const TAB_ITEMS: Array<{ key: PricingTab; label: string }> = [
  { key: "overview", label: "Pricing Overview" },
  { key: "community-fee", label: "Community Fee" },
  { key: "daily-rates", label: "Daily Rates" },
  { key: "ancillary-rates", label: "Ancillary Charges" },
  { key: "history", label: "History / Audit" }
];

function toTab(value: string | string[] | undefined): PricingTab {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (normalized === "community-fee") return "community-fee";
  if (normalized === "daily-rates") return "daily-rates";
  if (normalized === "ancillary-rates") return "ancillary-rates";
  if (normalized === "history") return "history";
  return "overview";
}

function money(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `$${value.toFixed(2)}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export default async function OperationsPricingPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireNavItemAccess("/operations/pricing");
  const params = await searchParams;
  const selectedTab = toTab(params.tab);
  const todayDate = toEasternDate();

  const [overview, auditRows, ancillarySummary] = await Promise.all([
    getEnrollmentPricingOverview(),
    listEnrollmentPricingAuditRows(100),
    selectedTab === "ancillary-rates" ? getAncillarySummary() : Promise.resolve(null)
  ]);

  const normalizedRole = normalizeRoleKey(profile.role);
  const canEdit = normalizedRole === "admin" || normalizedRole === "director";
  const canEditAncillary = normalizedRole === "admin";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <BackArrowButton fallbackHref="/operations" forceFallback ariaLabel="Back to operations" />
          <div>
            <CardTitle>Pricing Defaults</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Center-wide enrollment pricing defaults used by Enrollment Packet send workflow.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap gap-2">
          {TAB_ITEMS.map((tab) => (
            <Link
              key={tab.key}
              href={`/operations/pricing?tab=${tab.key}`}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                selectedTab === tab.key ? "border-brand bg-brand text-white" : "border-border text-brand"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </Card>

      {selectedTab === "overview" ? (
        <>
          <Card>
            <CardTitle>Active Defaults</CardTitle>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded border border-border px-3 py-2">
                <p className="text-muted">Effective Date</p>
                <p className="text-lg font-semibold text-fg">{overview.effectiveDate}</p>
              </div>
              <div className="rounded border border-border px-3 py-2">
                <p className="text-muted">Active Community Fee</p>
                <p className="text-lg font-semibold text-fg">{money(overview.activeCommunityFee?.amount ?? null)}</p>
              </div>
              <div className="rounded border border-border px-3 py-2">
                <p className="text-muted">Active Daily Rate Tiers</p>
                <p className="text-lg font-semibold text-fg">{overview.activeDailyRates.length}</p>
              </div>
              <div className="rounded border border-border px-3 py-2">
                <p className="text-muted">Edit Access</p>
                <p className="text-lg font-semibold text-fg">{canEdit ? "Admin/Director" : "Read-only"}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <Link href="/operations/pricing?tab=community-fee" className="font-semibold text-brand">
                Edit Community Fee
              </Link>
              <Link href="/operations/pricing?tab=daily-rates" className="font-semibold text-brand">
                Edit Daily Rates
              </Link>
              <Link href="/operations/pricing?tab=ancillary-rates" className="font-semibold text-brand">
                Manage Ancillary Charges
              </Link>
            </div>
            {overview.issues.length > 0 ? (
              <div className="mt-3 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                {overview.issues.map((issue) => (
                  <p key={issue}>{issue}</p>
                ))}
              </div>
            ) : null}
          </Card>

          <Card className="table-wrap">
            <CardTitle>Active Daily Rate Tiers</CardTitle>
            <table className="mt-3">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Days/Week</th>
                  <th>Rate</th>
                  <th>Effective Start</th>
                  <th>Effective End</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {overview.activeDailyRates.map((tier) => (
                  <tr key={tier.id}>
                    <td>{tier.label}</td>
                    <td>
                      {tier.minDaysPerWeek}
                      {tier.maxDaysPerWeek === tier.minDaysPerWeek ? "" : `-${tier.maxDaysPerWeek}`}
                    </td>
                    <td>{money(tier.dailyRate)}</td>
                    <td>{tier.effectiveStartDate}</td>
                    <td>{tier.effectiveEndDate ?? "-"}</td>
                    <td>{tier.isActive ? "Active" : "Inactive"}</td>
                  </tr>
                ))}
                {overview.activeDailyRates.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-sm text-muted">
                      No active daily rate tiers configured.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}

      {selectedTab === "community-fee" ? (
        <Card>
          <CardTitle>Community Fee Defaults</CardTitle>
          <p className="mt-1 text-sm text-muted">
            Manage default community fee records with effective dates and activation status.
          </p>
          <div className="mt-3">
            <PricingCommunityFeeManager
              canEdit={canEdit}
              todayDate={todayDate}
              rows={overview.communityFees.map((row) => ({
                id: row.id,
                amount: row.amount,
                effectiveStartDate: row.effectiveStartDate,
                effectiveEndDate: row.effectiveEndDate,
                isActive: row.isActive,
                notes: row.notes,
                updatedAt: row.updatedAt
              }))}
            />
          </div>
        </Card>
      ) : null}

      {selectedTab === "daily-rates" ? (
        <Card>
          <CardTitle>Daily Rate Defaults</CardTitle>
          <p className="mt-1 text-sm text-muted">
            Manage day-per-week daily rate tiers used by Enrollment Packet pricing resolution.
          </p>
          <div className="mt-3">
            <PricingDailyRatesManager
              canEdit={canEdit}
              todayDate={todayDate}
              rows={overview.dailyRates.map((row) => ({
                id: row.id,
                label: row.label,
                minDaysPerWeek: row.minDaysPerWeek,
                maxDaysPerWeek: row.maxDaysPerWeek,
                dailyRate: row.dailyRate,
                effectiveStartDate: row.effectiveStartDate,
                effectiveEndDate: row.effectiveEndDate,
                isActive: row.isActive,
                displayOrder: row.displayOrder,
                notes: row.notes,
                updatedAt: row.updatedAt
              }))}
            />
          </div>
        </Card>
      ) : null}

      {selectedTab === "history" ? (
        <Card className="table-wrap">
          <CardTitle>Pricing Audit History</CardTitle>
          <p className="mt-1 text-sm text-muted">
            Recent pricing changes captured in audit logs.
          </p>
          <table className="mt-3">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Entity</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {auditRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.created_at)}</td>
                  <td>{row.entity_type}</td>
                  <td>{row.action}</td>
                  <td>{row.actor_role ?? "-"}</td>
                  <td>
                    <pre className="max-w-xl overflow-x-auto whitespace-pre-wrap text-xs text-muted">
                      {JSON.stringify(row.details ?? {}, null, 2)}
                    </pre>
                  </td>
                </tr>
              ))}
              {auditRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-sm text-muted">
                    No pricing audit entries yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
      ) : null}

      {selectedTab === "ancillary-rates" ? (
        <Card>
          <CardTitle>Ancillary Charge Defaults</CardTitle>
          <p className="mt-1 text-sm text-muted">
            Configure default ancillary charge rates used by the canonical ancillary entry workflow.
          </p>
          {!canEditAncillary ? (
            <p className="mt-2 rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm text-muted">
              Read-only for directors. Admin access is required to change ancillary rates.
            </p>
          ) : null}
          <div className="mt-3">
            <AncillaryPricingManager
              categories={(ancillarySummary?.categories as Array<{ id: string; name: string; price_cents: number }> | undefined) ?? []}
              canEdit={canEditAncillary}
            />
          </div>
          <div className="mt-3">
            <Link href="/ancillary" className="text-sm font-semibold text-brand">
              Open Ancillary Charges
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
