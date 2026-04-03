import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { listMemberNameLookupSupabase } from "@/lib/services/member-command-center-read";
import { listMemberBillingSettings, listPayors } from "@/lib/services/billing-read";

import { submitPayorAction } from "@/app/(portal)/operations/payor/actions";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default async function BillingSettingsPage() {
  const [payors, memberBilling, members] = await Promise.all([
    listPayors(),
    listMemberBillingSettings(),
    listMemberNameLookupSupabase({ status: "active" })
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Billing Settings</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Keep payor directory details and member-level billing overrides here. Center defaults and recurring billing schedules are managed from Member Command Center so staff only edit those rules in one place.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link href="/operations/member-command-center/attendance-billing" className="font-semibold text-brand">
            Open MCC Attendance / Billing
          </Link>
          <Link href="/operations/payor" className="font-semibold text-brand">
            Back to Billing Hub
          </Link>
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Payor Directory</CardTitle>
        <p className="mt-1 text-xs text-muted">
          Member billing recipient selection comes from the member contact marked as payor in Member Command Center. Keep external payor metadata here only when it is still operationally useful.
        </p>
        <form action={submitPayorAction} className="mt-3 grid gap-2 md:grid-cols-6">
          <input type="hidden" name="intent" value="savePayor" />
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
        <CardTitle>Member Billing Overrides</CardTitle>
        <p className="mt-1 text-xs text-muted">
          Use this only when a member needs billing logic that differs from the center defaults already configured in MCC Attendance / Billing.
        </p>
        <form action={submitPayorAction} className="mt-3 grid gap-2 md:grid-cols-6">
          <input type="hidden" name="intent" value="saveMemberBillingSetting" />
          <select name="memberId" className="h-10 rounded-lg border border-border px-3" required>
            <option value="">Member</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.display_name}
              </option>
            ))}
          </select>
          <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted">
            Billing recipient comes from the member contact marked <span className="font-semibold text-fg">Is Payor</span> in Member Command Center.
          </div>
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
            Add Billing Override
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
                  <td>{row.use_center_default_billing_mode ? "Center Default" : row.billing_mode ?? "-"}</td>
                  <td>{row.monthly_billing_basis}</td>
                  <td>{row.use_center_default_rate ? "Yes" : "No"}</td>
                  <td>{row.custom_daily_rate != null ? `$${row.custom_daily_rate.toFixed(2)}` : "-"}</td>
                  <td>{row.flat_monthly_rate != null ? `$${row.flat_monthly_rate.toFixed(2)}` : "-"}</td>
                  <td>{row.transportation_billing_status}</td>
                  <td>
                    {row.effective_start_date} - {row.effective_end_date ?? "Open"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
