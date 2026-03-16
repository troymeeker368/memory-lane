import { Card, CardTitle } from "@/components/ui/card";
import { listCenterBillingSettingsSupabase } from "@/lib/services/member-command-center-supabase";
import { listMembersSupabase } from "@/lib/services/member-command-center-supabase";
import { listMemberBillingSettings, listPayors } from "@/lib/services/billing-read";

import {
  saveCenterBillingSettingAction,
  saveMemberBillingSettingAction,
  savePayorAction
} from "@/app/(portal)/operations/payor/actions";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default async function BillingAgreementsPage() {
  const centerBillingSettings = await listCenterBillingSettingsSupabase();
  const [payors, memberBilling, members] = await Promise.all([
    listPayors(),
    listMemberBillingSettings(),
    listMembersSupabase({ status: "active" })
  ]);
  const centerSetting = centerBillingSettings.find((row) => row.active) ?? centerBillingSettings[0] ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Center Attendance/Billing Defaults</CardTitle>
        <p className="mt-1 text-xs text-muted">
          Coordinator-managed defaults used unless a member has an active override.
        </p>
        <form action={saveCenterBillingSettingAction} className="mt-3 grid gap-2 md:grid-cols-4">
          <input type="hidden" name="id" value={centerSetting?.id ?? ""} />
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Default Daily Rate</span>
            <input
              name="defaultDailyRate"
              type="number"
              min="0"
              step="0.01"
              defaultValue={centerSetting?.default_daily_rate ?? 0}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Default Extra Day Rate</span>
            <input
              name="defaultExtraDayRate"
              type="number"
              min="0"
              step="0.01"
              defaultValue={centerSetting?.default_extra_day_rate ?? centerSetting?.default_daily_rate ?? 0}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">One-Way Transport Rate</span>
            <input
              name="defaultTransportOneWayRate"
              type="number"
              min="0"
              step="0.01"
              defaultValue={centerSetting?.default_transport_one_way_rate ?? 0}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Round-Trip Transport Rate</span>
            <input
              name="defaultTransportRoundTripRate"
              type="number"
              min="0"
              step="0.01"
              defaultValue={centerSetting?.default_transport_round_trip_rate ?? 0}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Billing Cutoff Day</span>
            <input
              name="billingCutoffDay"
              type="number"
              min="1"
              max="31"
              step="1"
              defaultValue={centerSetting?.billing_cutoff_day ?? 25}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Default Billing Mode</span>
            <select
              name="defaultBillingMode"
              defaultValue={centerSetting?.default_billing_mode ?? "Membership"}
              className="h-10 w-full rounded-lg border border-border px-3"
            >
              <option value="Membership">Membership (Month Ahead)</option>
              <option value="Monthly">Monthly (Month Behind)</option>
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Effective Start Date</span>
            <input
              name="effectiveStartDate"
              type="date"
              defaultValue={centerSetting?.effective_start_date ?? todayDate()}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Effective End Date</span>
            <input
              name="effectiveEndDate"
              type="date"
              defaultValue={centerSetting?.effective_end_date ?? ""}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>
          <label className="flex items-end gap-2 text-xs">
            <input name="active" type="checkbox" value="true" defaultChecked={centerSetting?.active ?? true} />
            <span className="font-semibold text-muted">Active</span>
          </label>
          <div className="md:col-span-4">
            <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white">
              Save Center Defaults
            </button>
          </div>
        </form>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Payors</CardTitle>
        <form action={savePayorAction} className="mt-3 grid gap-2 md:grid-cols-6">
          <input name="payorName" placeholder="Payor Name" className="h-10 rounded-lg border border-border px-3" />
          <input name="payorType" placeholder="Payor Type" defaultValue="Private" className="h-10 rounded-lg border border-border px-3" />
          <input name="billingContactName" placeholder="Billing Contact" className="h-10 rounded-lg border border-border px-3" />
          <input name="billingEmail" placeholder="Billing Email" className="h-10 rounded-lg border border-border px-3" />
          <select name="billingMethod" className="h-10 rounded-lg border border-border px-3">
            <option value="InvoiceEmail">Invoice Email</option>
            <option value="ACHDraft">ACH Draft</option>
            <option value="CardOnFile">Card On File</option>
            <option value="Manual">Manual</option>
            <option value="External">External</option>
          </select>
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
            Add Payor
          </button>
        </form>

        <table className="mt-3">
          <thead>
            <tr>
              <th>Payor</th>
              <th>Type</th>
              <th>Method</th>
              <th>Email</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {payors.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-sm text-muted">No payors available.</td>
              </tr>
            ) : (
              payors.map((payor) => (
                <tr key={payor.id}>
                  <td>{payor.payor_name}</td>
                  <td>{payor.payor_type}</td>
                  <td>{payor.billing_method}</td>
                  <td>{payor.billing_email ?? "-"}</td>
                  <td className="capitalize">{payor.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Member Billing Settings</CardTitle>
        <form action={saveMemberBillingSettingAction} className="mt-3 grid gap-2 md:grid-cols-6">
          <select name="memberId" className="h-10 rounded-lg border border-border px-3" required>
            <option value="">Member</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>{member.display_name}</option>
            ))}
          </select>
          <select name="payorId" className="h-10 rounded-lg border border-border px-3">
            <option value="">Payor</option>
            {payors.map((payor) => (
              <option key={payor.id} value={payor.id}>{payor.payor_name}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted">
            <input name="useCenterDefaultBillingMode" type="checkbox" value="true" defaultChecked />
            Use Center Default Billing Mode
          </label>
          <select name="billingMode" className="h-10 rounded-lg border border-border px-3">
            <option value="">Member Billing Mode Override</option>
            <option value="Membership">Membership</option>
            <option value="Monthly">Monthly</option>
            <option value="Custom">Custom</option>
          </select>
          <select name="monthlyBillingBasis" className="h-10 rounded-lg border border-border px-3">
            <option value="ScheduledMonthBehind">Monthly Basis: Scheduled Month Behind</option>
            <option value="ActualAttendanceMonthBehind">Monthly Basis: Actual Attendance Month Behind</option>
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted">
            <input name="useCenterDefaultRate" type="checkbox" value="true" defaultChecked />
            Use Center Default Rate
          </label>
          <input name="customDailyRate" type="number" min="0" step="0.01" placeholder="Custom Daily Rate" className="h-10 rounded-lg border border-border px-3" />
          <input name="flatMonthlyRate" type="number" min="0" step="0.01" placeholder="Flat Monthly Rate" className="h-10 rounded-lg border border-border px-3" />
          <select name="transportationBillingStatus" className="h-10 rounded-lg border border-border px-3">
            <option value="BillNormally">Transport: Bill Normally</option>
            <option value="Waived">Transport: Waived</option>
            <option value="IncludedInProgramRate">Transport: Included in Program Rate</option>
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted">
            <input name="billExtraDays" type="checkbox" value="true" defaultChecked />
            Bill Extra Days
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted">
            <input name="billAncillaryArrears" type="checkbox" value="true" defaultChecked />
            Bill Ancillary Arrears
          </label>
          <input name="effectiveStartDate" type="date" defaultValue={todayDate()} className="h-10 rounded-lg border border-border px-3" />
          <input name="effectiveEndDate" type="date" className="h-10 rounded-lg border border-border px-3" />
          <input name="billingNotes" placeholder="Notes" className="h-10 rounded-lg border border-border px-3 md:col-span-2" />
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
            Add Member Billing Setting
          </button>
        </form>

        <table className="mt-3">
          <thead>
            <tr>
              <th>Member</th>
              <th>Payor</th>
              <th>Billing Mode</th>
              <th>Month-Behind Basis</th>
              <th>Use Default</th>
              <th>Custom Rate</th>
              <th>Flat Monthly</th>
              <th>Transport Rule</th>
              <th>Active Range</th>
            </tr>
          </thead>
          <tbody>
            {memberBilling.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-sm text-muted">No member billing settings available.</td>
              </tr>
            ) : (
              memberBilling.map((row) => (
                <tr key={row.id}>
                  <td>{row.member_name}</td>
                  <td>{row.payor_name}</td>
                  <td>{row.use_center_default_billing_mode ? `Default (${centerSetting?.default_billing_mode ?? "Membership"})` : row.billing_mode ?? "-"}</td>
                  <td>{row.monthly_billing_basis}</td>
                  <td>{row.use_center_default_rate ? "Yes" : "No"}</td>
                  <td>{row.custom_daily_rate != null ? `$${row.custom_daily_rate.toFixed(2)}` : "-"}</td>
                  <td>{row.flat_monthly_rate != null ? `$${row.flat_monthly_rate.toFixed(2)}` : "-"}</td>
                  <td>{row.transportation_billing_status}</td>
                  <td>{row.effective_start_date} - {row.effective_end_date ?? "Open"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
