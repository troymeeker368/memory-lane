import { Card } from "@/components/ui/card";
import { MccAttendanceForm } from "@/components/forms/mcc-attendance-form";
import type { MemberCommandCenterDetail } from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import { SectionHeading } from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import {
  resolveActiveEnrollmentCommunityFee,
  resolveActiveEnrollmentDailyRate
} from "@/lib/services/enrollment-pricing";
import { toEasternDate } from "@/lib/timezone";

type PricingFormProps = Parameters<typeof MccAttendanceForm>[0];

type ActiveMemberBillingSetting = {
  use_center_default_billing_mode: boolean;
  billing_mode: PricingFormProps["billingMode"];
  monthly_billing_basis: PricingFormProps["monthlyBillingBasis"];
  bill_extra_days: boolean;
  bill_ancillary_arrears: boolean;
} | null;

function money(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `$${value.toFixed(2)}`;
}

export default async function MemberCommandCenterPricingTab({
  canEditAttendanceBilling,
  detail,
  scheduleUpdatedAt,
  scheduleUpdatedBy,
  activeMemberBillingSetting,
  billingPayorName,
  billingPayorStatus
}: {
  canEditAttendanceBilling: boolean;
  detail: MemberCommandCenterDetail;
  scheduleUpdatedAt: string | null;
  scheduleUpdatedBy: string | null;
  activeMemberBillingSetting: ActiveMemberBillingSetting;
  billingPayorName: string;
  billingPayorStatus: string;
}) {
  const effectiveDate = detail.schedule?.billing_rate_effective_date?.slice(0, 10) ?? toEasternDate();
  const scheduledDaysCount = [
    detail.schedule?.monday,
    detail.schedule?.tuesday,
    detail.schedule?.wednesday,
    detail.schedule?.thursday,
    detail.schedule?.friday
  ].filter(Boolean).length;

  const [communityFeeResult, dailyRateResult] = await Promise.allSettled([
    resolveActiveEnrollmentCommunityFee(effectiveDate),
    scheduledDaysCount > 0
      ? resolveActiveEnrollmentDailyRate({ daysPerWeek: scheduledDaysCount, effectiveDate })
      : Promise.resolve(null)
  ]);

  const communityFee = communityFeeResult.status === "fulfilled" ? communityFeeResult.value : null;
  const dailyRate = dailyRateResult.status === "fulfilled" ? dailyRateResult.value : null;
  const pricingIssues = [
    communityFeeResult.status === "rejected" ? communityFeeResult.reason instanceof Error ? communityFeeResult.reason.message : "Unable to load community fee default." : null,
    dailyRateResult.status === "rejected" ? dailyRateResult.reason instanceof Error ? dailyRateResult.reason.message : "Unable to load daily rate default." : null
  ].filter((value): value is string => Boolean(value));

  return (
    <Card id="pricing">
      <SectionHeading title="Pricing" lastUpdatedAt={scheduleUpdatedAt} lastUpdatedBy={scheduleUpdatedBy} />

      <div className="mt-3 grid gap-3 md:grid-cols-5">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Member Daily Rate</p>
          <p className="font-semibold">{money(detail.schedule?.daily_rate ?? null)}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Default Daily Tier</p>
          <p className="font-semibold">{dailyRate ? `${dailyRate.label} (${money(dailyRate.dailyRate)})` : "-"}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Community Fee Default</p>
          <p className="font-semibold">{communityFee ? money(communityFee.amount) : "-"}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Billing Mode</p>
          <p className="font-semibold">
            {activeMemberBillingSetting?.use_center_default_billing_mode
              ? "Center Default"
              : activeMemberBillingSetting?.billing_mode ?? "Membership"}
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Billing Payor</p>
          <p className="font-semibold">{billingPayorName}</p>
        </div>
      </div>

      {pricingIssues.length > 0 ? (
        <div className="mt-3 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {pricingIssues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      ) : null}

      {canEditAttendanceBilling && detail.schedule ? (
        <MccAttendanceForm
          key={`mcc-pricing-${detail.member.id}-${scheduleUpdatedAt ?? "na"}`}
          memberId={detail.member.id}
          mode="pricing"
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
      ) : (
        <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted">
          {billingPayorStatus}
        </div>
      )}
    </Card>
  );
}
