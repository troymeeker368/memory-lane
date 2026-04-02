import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireMemberCommandCenterAttendanceBillingEdit } from "@/lib/auth";
import { listCenterBillingSettingsSupabase } from "@/lib/services/member-command-center-read";

import { submitPayorAction } from "@/app/(portal)/operations/payor/actions";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default async function MccAttendanceBillingSettingsPage() {
  await requireMemberCommandCenterAttendanceBillingEdit();
  const centerBillingSettings = await listCenterBillingSettingsSupabase();
  const current = centerBillingSettings.find((row) => row.active) ?? centerBillingSettings[0] ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>MCC Attendance/Billing Settings</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Main coordinator-managed location for center default attendance billing rates and cutoff controls.
        </p>
        <div className="mt-2 text-sm">
          <Link href="/operations/member-command-center" className="font-semibold text-brand">Back to Member Command Center</Link>
          <span className="mx-2 text-muted">|</span>
          <Link href="/operations/payor/center-closures" className="font-semibold text-brand">Manage Center Closures</Link>
        </div>
      </Card>

      <Card>
        <form action={submitPayorAction} className="grid gap-2 md:grid-cols-4">
          <input type="hidden" name="intent" value="saveCenterBillingSetting" />
          <input type="hidden" name="id" value={current?.id ?? ""} />
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Default Daily Rate</span>
            <input name="defaultDailyRate" type="number" min="0" step="0.01" defaultValue={current?.default_daily_rate ?? 0} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Default Extra Day Rate</span>
            <input name="defaultExtraDayRate" type="number" min="0" step="0.01" defaultValue={current?.default_extra_day_rate ?? current?.default_daily_rate ?? 0} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Default One-Way Transport Rate</span>
            <input name="defaultTransportOneWayRate" type="number" min="0" step="0.01" defaultValue={current?.default_transport_one_way_rate ?? 0} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Default Round-Trip Transport Rate</span>
            <input name="defaultTransportRoundTripRate" type="number" min="0" step="0.01" defaultValue={current?.default_transport_round_trip_rate ?? 0} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Billing Cutoff Day</span>
            <input name="billingCutoffDay" type="number" min="1" max="31" step="1" defaultValue={current?.billing_cutoff_day ?? 25} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Default Billing Mode</span>
            <select name="defaultBillingMode" defaultValue={current?.default_billing_mode ?? "Membership"} className="h-10 w-full rounded-lg border border-border px-3">
              <option value="Membership">Membership (Month Ahead)</option>
              <option value="Monthly">Monthly (Month Behind)</option>
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Effective Start Date</span>
            <input name="effectiveStartDate" type="date" defaultValue={current?.effective_start_date ?? todayDate()} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Effective End Date</span>
            <input name="effectiveEndDate" type="date" defaultValue={current?.effective_end_date ?? ""} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="flex items-end gap-2 text-xs">
            <input name="active" type="checkbox" value="true" defaultChecked={current?.active ?? true} />
            <span className="font-semibold text-muted">Active</span>
          </label>
          <div className="md:col-span-4">
            <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white">
              Save Attendance/Billing Defaults
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
