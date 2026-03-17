import type { ComponentProps } from "react";

import { Card } from "@/components/ui/card";
import { MccAttendanceForm } from "@/components/forms/mcc-attendance-form";
import type { MemberCommandCenterDetail } from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import { SectionHeading } from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import { formatOptionalDate } from "@/lib/utils";

type AttendanceFormProps = ComponentProps<typeof MccAttendanceForm>;

type ActiveMemberBillingSetting = {
  use_center_default_billing_mode: boolean;
  billing_mode: AttendanceFormProps["billingMode"];
  monthly_billing_basis: AttendanceFormProps["monthlyBillingBasis"];
  bill_extra_days: boolean;
  bill_ancillary_arrears: boolean;
} | null;

export default function MemberCommandCenterAttendanceTab({
  canEditAttendanceBilling,
  detail,
  scheduleUpdatedAt,
  scheduleUpdatedBy,
  monthsEnrolled,
  scheduleDays,
  transportationSummary,
  effectiveScheduleTodayLabel,
  activeOverrideCount,
  activeMemberBillingSetting,
  billingPayorName,
  billingPayorStatus
}: {
  canEditAttendanceBilling: boolean;
  detail: MemberCommandCenterDetail;
  scheduleUpdatedAt: string | null;
  scheduleUpdatedBy: string | null;
  monthsEnrolled: number | null;
  scheduleDays: string;
  transportationSummary: string;
  effectiveScheduleTodayLabel: string;
  activeOverrideCount: number;
  activeMemberBillingSetting: ActiveMemberBillingSetting;
  billingPayorName: string;
  billingPayorStatus: string;
}) {
  return (
    <Card id="attendance-enrollment">
      <SectionHeading title="Attendance / Enrollment" lastUpdatedAt={scheduleUpdatedAt} lastUpdatedBy={scheduleUpdatedBy} />
      <div className="mt-3 grid gap-3 md:grid-cols-5">
        <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Enrollment Date</p><p className="font-semibold">{formatOptionalDate(detail.schedule?.enrollment_date ?? detail.member.enrollment_date)}</p></div>
        <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Months Enrolled</p><p className="font-semibold">{monthsEnrolled ?? "-"}</p></div>
        <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Scheduled Days</p><p className="font-semibold">{scheduleDays}</p></div>
        <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Transportation</p><p className="font-semibold">{transportationSummary}</p></div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Effective Days (Today)</p>
          <p className="font-semibold">{effectiveScheduleTodayLabel}</p>
          <p className="text-[11px] text-muted">Active schedule changes: {activeOverrideCount}</p>
        </div>
      </div>

      {canEditAttendanceBilling && detail.schedule ? (
        <MccAttendanceForm
          key={`mcc-attendance-${detail.member.id}-${scheduleUpdatedAt ?? "na"}`}
          memberId={detail.member.id}
          enrollmentDate={detail.schedule.enrollment_date ?? ""}
          makeUpDaysAvailable={detail.schedule.make_up_days_available}
          attendanceNotes={detail.schedule.attendance_notes}
          dailyRate={detail.schedule.daily_rate}
          transportationBillingStatus={detail.schedule.transportation_billing_status}
          billingPayorName={billingPayorName}
          billingPayorStatus={billingPayorStatus}
          useCenterDefaultBillingMode={activeMemberBillingSetting?.use_center_default_billing_mode ?? true}
          billingMode={activeMemberBillingSetting?.billing_mode ?? null}
          monthlyBillingBasis={activeMemberBillingSetting?.monthly_billing_basis ?? "ScheduledMonthBehind"}
          billExtraDays={activeMemberBillingSetting?.bill_extra_days ?? true}
          billAncillaryArrears={activeMemberBillingSetting?.bill_ancillary_arrears ?? true}
          billingRateEffectiveDate={detail.schedule.billing_rate_effective_date}
          billingNotes={detail.schedule.billing_notes}
          monday={detail.schedule.monday}
          tuesday={detail.schedule.tuesday}
          wednesday={detail.schedule.wednesday}
          thursday={detail.schedule.thursday}
          friday={detail.schedule.friday}
        />
      ) : null}

      <div className="mt-4 table-wrap">
        <p className="text-sm font-semibold text-primary-text">Makeup Day History</p>
        <table className="mt-2">
          <thead>
            <tr>
              <th>Date</th>
              <th>Delta</th>
              <th>Balance Policy</th>
              <th>Reason</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {detail.makeupLedger.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-sm text-muted">
                  No makeup day activity yet.
                </td>
              </tr>
            ) : (
              detail.makeupLedger.slice(0, 20).map((entry) => (
                <tr key={entry.id}>
                  <td>{formatOptionalDate(entry.effectiveDate)}</td>
                  <td>{entry.deltaDays > 0 ? `+${entry.deltaDays}` : entry.deltaDays}</td>
                  <td>{entry.expiresAt ? `Expires ${formatOptionalDate(entry.expiresAt)}` : "Running total"}</td>
                  <td>{entry.reason}</td>
                  <td>{entry.createdByName}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
