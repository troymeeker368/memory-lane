"use client";

import { FormEvent, useMemo } from "react";

import { saveMemberCommandCenterAttendanceAction } from "@/app/(portal)/operations/member-command-center/summary-actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { usePropSyncedState, usePropSyncedStatus } from "@/components/forms/use-prop-synced-state";
import { MutationNotice } from "@/components/ui/mutation-notice";
import { emitClientMutationEvent } from "@/lib/mutations/client-events";

export function MccAttendanceForm({
  memberId,
  enrollmentDate,
  makeUpDaysAvailable,
  attendanceNotes,
  dailyRate,
  transportationBillingStatus,
  billingPayorName,
  billingPayorStatus,
  useCenterDefaultBillingMode,
  billingMode,
  monthlyBillingBasis,
  billExtraDays,
  billAncillaryArrears,
  billingRateEffectiveDate,
  billingNotes,
  monday,
  tuesday,
  wednesday,
  thursday,
  friday
}: {
  memberId: string;
  enrollmentDate: string;
  makeUpDaysAvailable: number | null;
  attendanceNotes: string | null;
  dailyRate: number | null;
  transportationBillingStatus: "BillNormally" | "Waived" | "IncludedInProgramRate";
  billingPayorName: string;
  billingPayorStatus: string;
  useCenterDefaultBillingMode: boolean;
  billingMode: "Membership" | "Monthly" | "Custom" | null;
  monthlyBillingBasis: "ScheduledMonthBehind" | "ActualAttendanceMonthBehind";
  billExtraDays: boolean;
  billAncillaryArrears: boolean;
  billingRateEffectiveDate: string | null;
  billingNotes: string | null;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
}) {
  const [status, setStatus] = usePropSyncedStatus([memberId, monday, tuesday, wednesday, thursday, friday]);
  const { isSaving, run } = useScopedMutation();
  const [isMonday, setIsMonday] = usePropSyncedState(monday, [memberId, monday, tuesday, wednesday, thursday, friday]);
  const [isTuesday, setIsTuesday] = usePropSyncedState(tuesday, [memberId, monday, tuesday, wednesday, thursday, friday]);
  const [isWednesday, setIsWednesday] = usePropSyncedState(wednesday, [memberId, monday, tuesday, wednesday, thursday, friday]);
  const [isThursday, setIsThursday] = usePropSyncedState(thursday, [memberId, monday, tuesday, wednesday, thursday, friday]);
  const [isFriday, setIsFriday] = usePropSyncedState(friday, [memberId, monday, tuesday, wednesday, thursday, friday]);

  const daysPerWeek = useMemo(
    () => [isMonday, isTuesday, isWednesday, isThursday, isFriday].filter(Boolean).length,
    [isMonday, isTuesday, isWednesday, isThursday, isFriday]
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    const payload = new FormData(event.currentTarget);
    void run(() => saveMemberCommandCenterAttendanceAction(payload), {
      successMessage: "Attendance and billing settings saved.",
      errorMessage: "Unable to save attendance.",
      onSuccess: () => {
        setStatus("Attendance and billing settings saved.");
        emitClientMutationEvent("mcc:header-update", {
          enrollment: String(payload.get("enrollmentDate") ?? "")
        });
      },
      onError: (result) => {
        setStatus(`Error: ${result.error}`);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3">
      <input type="hidden" name="memberId" value={memberId} />
      <div className="grid gap-2 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Enrollment Date</span>
          <input name="enrollmentDate" type="date" defaultValue={enrollmentDate} className="h-10 w-full rounded-lg border border-border px-3" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Make-up Days Available</span>
          <input
            name="makeUpDaysAvailable"
            type="number"
            min={0}
            defaultValue={makeUpDaysAvailable ?? 0}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Attendance Days Per Week</span>
          <input
            name="attendanceDaysPerWeek"
            value={String(daysPerWeek)}
            readOnly
            className="h-10 w-full rounded-lg border border-border bg-muted px-3"
          />
        </label>
      </div>

      <div className="grid gap-2 md:grid-cols-5 text-sm">
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <input type="checkbox" name="monday" checked={isMonday} onChange={(event) => setIsMonday(event.currentTarget.checked)} disabled={isSaving} /> Monday
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <input type="checkbox" name="tuesday" checked={isTuesday} onChange={(event) => setIsTuesday(event.currentTarget.checked)} disabled={isSaving} /> Tuesday
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <input type="checkbox" name="wednesday" checked={isWednesday} onChange={(event) => setIsWednesday(event.currentTarget.checked)} disabled={isSaving} /> Wednesday
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <input type="checkbox" name="thursday" checked={isThursday} onChange={(event) => setIsThursday(event.currentTarget.checked)} disabled={isSaving} /> Thursday
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <input type="checkbox" name="friday" checked={isFriday} onChange={(event) => setIsFriday(event.currentTarget.checked)} disabled={isSaving} /> Friday
        </label>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-xs font-semibold text-muted">
          Billing driver settings: these values are used by membership billing, monthly billing, extra day billing, and prorated custom invoices.
        </p>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Billing Payor Contact</span>
            <input value={billingPayorName} readOnly className="h-10 w-full rounded-lg border border-border bg-white px-3 text-muted" />
            <p className="text-[11px] text-muted">{billingPayorStatus}</p>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Billing Mode</span>
            <select
              name="billingMode"
              defaultValue={billingMode ?? "Membership"}
              className="h-10 w-full rounded-lg border border-border bg-white px-3"
              disabled={isSaving}
            >
              <option value="Membership">Membership (Month Ahead)</option>
              <option value="Monthly">Monthly (Month Behind)</option>
              <option value="Custom">Custom / Ad Hoc</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Monthly Billing Basis</span>
            <select
              name="monthlyBillingBasis"
              defaultValue={monthlyBillingBasis}
              className="h-10 w-full rounded-lg border border-border bg-white px-3"
              disabled={isSaving}
            >
              <option value="ScheduledMonthBehind">Scheduled Month Behind</option>
              <option value="ActualAttendanceMonthBehind">Actual Attendance Month Behind</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Daily Rate</span>
            <input
              name="dailyRate"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={dailyRate != null ? dailyRate.toFixed(2) : ""}
              className="h-10 w-full rounded-lg border border-border bg-white px-3"
              disabled={isSaving}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Transportation Billing Status</span>
            <select
              name="transportationBillingStatus"
              defaultValue={transportationBillingStatus}
              className="h-10 w-full rounded-lg border border-border bg-white px-3"
              disabled={isSaving}
            >
              <option value="BillNormally">Bill Normally</option>
              <option value="Waived">Waived</option>
              <option value="IncludedInProgramRate">Included In Program Rate</option>
            </select>
          </label>
          <label className="flex items-end gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm">
            <input
              type="checkbox"
              name="useCenterDefaultBillingMode"
              defaultChecked={useCenterDefaultBillingMode}
              disabled={isSaving}
            />
            <span className="text-xs font-semibold text-muted">Use Center Default Billing Mode</span>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Billing Rate Effective Date</span>
            <input
              name="billingRateEffectiveDate"
              type="date"
              defaultValue={billingRateEffectiveDate?.slice(0, 10) ?? enrollmentDate?.slice(0, 10) ?? ""}
              className="h-10 w-full rounded-lg border border-border bg-white px-3"
              disabled={isSaving}
            />
          </label>
          <label className="flex items-end gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm">
            <input type="checkbox" name="billExtraDays" defaultChecked={billExtraDays} disabled={isSaving} />
            <span className="text-xs font-semibold text-muted">Bill Extra Unscheduled Days</span>
          </label>
          <label className="flex items-end gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm">
            <input type="checkbox" name="billAncillaryArrears" defaultChecked={billAncillaryArrears} disabled={isSaving} />
            <span className="text-xs font-semibold text-muted">Bill Ancillary In Arrears</span>
          </label>
          <label className="space-y-1 text-sm md:col-span-3">
            <span className="text-xs font-semibold text-muted">Billing Notes</span>
            <textarea
              name="billingNotes"
              defaultValue={billingNotes ?? ""}
              className="min-h-16 w-full rounded-lg border border-border bg-white p-3 text-sm"
              disabled={isSaving}
            />
          </label>
        </div>
      </div>

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Attendance Notes</span>
        <textarea name="attendanceNotes" defaultValue={attendanceNotes ?? ""} className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" disabled={isSaving} />
      </label>

      <button type="submit" disabled={isSaving} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70">
        {isSaving ? "Saving..." : "Save Attendance / Billing"}
      </button>
      <MutationNotice kind={status?.startsWith("Error") ? "error" : "success"} message={status} />
    </form>
  );
}
