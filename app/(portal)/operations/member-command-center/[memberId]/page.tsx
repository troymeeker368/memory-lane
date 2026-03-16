import Link from "next/link";
import { notFound } from "next/navigation";

import { MemberStatusToggle } from "@/components/forms/member-status-toggle";
import { MccDemographicsForm } from "@/components/forms/mcc-demographics-form";
import { MccAttendanceForm } from "@/components/forms/mcc-attendance-form";
import { MccLegalForm } from "@/components/forms/mcc-legal-form";
import { MccSummaryForm } from "@/components/forms/mcc-summary-form";
import { MccDietForm } from "@/components/forms/mcc-diet-form";
import { MccAllergiesSection } from "@/components/forms/mcc-allergies-section";
import { MccHeaderCards } from "@/components/forms/mcc-header-cards";
import { MccPhotoUploader } from "@/components/forms/mcc-photo-uploader";
import {
  MemberCommandCenterContactManagerShell,
  MemberCommandCenterFileManagerShell,
  MemberCommandCenterPofSectionShell,
  MccTransportationFormShell
} from "@/components/forms/member-command-center-shells";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { canPerformModuleAction, normalizeRoleKey } from "@/lib/permissions";
import { resolveActiveEffectiveMemberRowForDate } from "@/lib/services/billing-effective";
import {
  getAvailableLockerNumbersForMemberSupabase,
  getMemberCommandCenterDetailSupabase,
  listActivePayorsSupabase,
  listMemberBillingSettingsSupabase
} from "@/lib/services/member-command-center-supabase";
import { getConfiguredBusNumbers } from "@/lib/services/operations-settings";
import { getConfiguredClinicalSenderEmail, listPofRequestsByPhysicianOrderIds } from "@/lib/services/pof-read";
import {
  loadExpectedAttendanceSupabaseContext,
  resolveExpectedAttendanceFromSupabaseContext
} from "@/lib/services/expected-attendance-supabase";
import { getScheduledDayAbbreviations } from "@/lib/services/member-schedule-selectors";
import { listScheduleChangesSupabase, SCHEDULE_WEEKDAY_KEYS } from "@/lib/services/schedule-changes-supabase";
import { getPhysicianOrdersForMember } from "@/lib/services/physician-orders-supabase";
import { getManagedUserSignoffLabel } from "@/lib/services/user-management";
import { toEasternDate } from "@/lib/timezone";
import { formatDateTime, formatOptionalDate } from "@/lib/utils";

const DIET_TYPE_OPTIONS = ["Regular", "Diabetic", "Low Sodium", "Pureed", "Renal", "Heart Healthy", "Other"] as const;
const DIET_TEXTURE_OPTIONS = ["Regular", "Mechanical Soft", "Chopped", "Ground", "Pureed", "Nectar Thick", "Honey Thick"] as const;

const MCC_TABS = [
  "member-summary",
  "demographics-contacts",
  "attendance-enrollment",
  "transportation",
  "legal",
  "diet-allergies"
] as const;

type MccTab = (typeof MCC_TABS)[number];

const TAB_LABELS: Record<MccTab, string> = {
  "member-summary": "Member Summary",
  "attendance-enrollment": "Attendance / Enrollment",
  transportation: "Transportation",
  "demographics-contacts": "Demographics & Contacts",
  legal: "Legal",
  "diet-allergies": "Diet / Allergies"
};

const WEEKDAY_LABELS: Record<(typeof SCHEDULE_WEEKDAY_KEYS)[number], string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri"
};

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function resolveTab(raw: string | undefined): MccTab {
  if (raw && MCC_TABS.includes(raw as MccTab)) return raw as MccTab;
  return "member-summary";
}

function boolLabel(value: boolean | null | undefined) {
  if (value == null) return "-";
  return value ? "Yes" : "No";
}

function latestTimestamp(values: Array<string | null | undefined>) {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) return null;
  return valid.reduce((latest, current) => {
    const latestMs = Number.isNaN(Date.parse(latest)) ? 0 : Date.parse(latest);
    const currentMs = Number.isNaN(Date.parse(current)) ? 0 : Date.parse(current);
    return currentMs > latestMs ? current : latest;
  });
}

function latestUpdatedBy<T>(
  rows: T[],
  getTimestamp: (row: T) => string | null | undefined,
  getBy: (row: T) => string | null | undefined
) {
  let latestAt: string | null = null;
  let latestBy: string | null = null;
  rows.forEach((row) => {
    const currentAt = getTimestamp(row);
    if (!currentAt) return;
    if (!latestAt) {
      latestAt = currentAt;
      latestBy = getBy(row) ?? null;
      return;
    }
    const latestMs = Number.isNaN(Date.parse(latestAt)) ? 0 : Date.parse(latestAt);
    const currentMs = Number.isNaN(Date.parse(currentAt)) ? 0 : Date.parse(currentAt);
    if (currentMs > latestMs) {
      latestAt = currentAt;
      latestBy = getBy(row) ?? null;
    }
  });
  return latestBy;
}

function SectionHeading({
  title,
  lastUpdatedAt,
  lastUpdatedBy
}: {
  title: string;
  lastUpdatedAt: string | null | undefined;
  lastUpdatedBy: string | null | undefined;
}) {
  return (
    <div className="flex w-full flex-wrap items-baseline justify-start gap-x-3 gap-y-1 text-left">
      <CardTitle className="text-left">{title}</CardTitle>
      <span className="text-left text-xs font-normal text-muted">
        Last updated: {lastUpdatedAt ? formatDateTime(lastUpdatedAt) : "-"} | Last updated by: {lastUpdatedBy ?? "-"}
      </span>
    </div>
  );
}

export default async function MemberCommandCenterDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireModuleAccess("operations");
  const role = normalizeRoleKey(profile.role);
  const canEdit = role === "admin" || role === "manager";
  const canEditAttendanceBilling =
    role === "admin" ||
    role === "manager" ||
    role === "coordinator" ||
    canPerformModuleAction(role, "operations", "canEdit", profile.permissions);
  const canViewMhpFromMcc = role === "admin" || role === "nurse";
  const canViewFaceSheet = role === "admin" || role === "manager" || role === "nurse";
  const canViewNameBadge = role === "admin" || role === "manager" || role === "nurse";
  const canViewPhysicianOrders = role === "admin" || role === "nurse" || role === "manager";
  const canCreatePhysicianOrders = role === "admin" || role === "nurse";
  const { memberId } = await params;
  const query = await searchParams;
  const tab = resolveTab(firstString(query.tab));

  const detail = await getMemberCommandCenterDetailSupabase(memberId);
  if (!detail) notFound();
  const billingDate = toEasternDate();
  const activeScheduleChangesForToday = await listScheduleChangesSupabase({
    memberId: detail.member.id,
    status: "active",
    effectiveDate: billingDate,
    limit: 25
  });
  const expectedAttendanceContext = await loadExpectedAttendanceSupabaseContext({
    memberIds: [detail.member.id],
    startDate: billingDate,
    endDate: billingDate,
    includeAttendanceRecords: false
  });
  const effectiveScheduleToday = resolveExpectedAttendanceFromSupabaseContext({
    context: expectedAttendanceContext,
    memberId: detail.member.id,
    date: billingDate,
    baseScheduleOverride: detail.schedule,
    scheduleChangesOverride: activeScheduleChangesForToday
  });
  const effectiveScheduleTodayLabel =
    effectiveScheduleToday.effectiveDays.length > 0
      ? effectiveScheduleToday.effectiveDays.map((day) => WEEKDAY_LABELS[day] ?? day).join(", ")
      : "-";
  const activeOverrideCount = activeScheduleChangesForToday.length;
  const memberBillingSettings = await listMemberBillingSettingsSupabase(detail.member.id);
  const activeMemberBillingSetting = resolveActiveEffectiveMemberRowForDate(
    detail.member.id,
    billingDate,
    memberBillingSettings
  );
  const activePayorOptions = (await listActivePayorsSupabase())
    .filter((row) => row.status === "active")
    .sort((left, right) => left.payor_name.localeCompare(right.payor_name, undefined, { sensitivity: "base" }))
    .map((row) => ({ id: row.id, name: row.payor_name }));
  const lockerOptions = await getAvailableLockerNumbersForMemberSupabase(memberId);
  const busNumberOptions = await getConfiguredBusNumbers();

  const scheduleDays = getScheduledDayAbbreviations(detail.schedule);

  const monthsEnrolled = detail.monthsEnrolled;
  const defaultDoorToDoorAddress =
    [detail.profile.street_address, detail.profile.city, detail.profile.state, detail.profile.zip]
      .map((value) => (value ?? "").trim())
      .filter(Boolean)
      .join(", ");
  const slotModes = detail.schedule
    ? [
        ...(detail.schedule.monday ? [detail.schedule.transport_monday_am_mode, detail.schedule.transport_monday_pm_mode] : []),
        ...(detail.schedule.tuesday ? [detail.schedule.transport_tuesday_am_mode, detail.schedule.transport_tuesday_pm_mode] : []),
        ...(detail.schedule.wednesday ? [detail.schedule.transport_wednesday_am_mode, detail.schedule.transport_wednesday_pm_mode] : []),
        ...(detail.schedule.thursday ? [detail.schedule.transport_thursday_am_mode, detail.schedule.transport_thursday_pm_mode] : []),
        ...(detail.schedule.friday ? [detail.schedule.transport_friday_am_mode, detail.schedule.transport_friday_pm_mode] : [])
      ]
    : [];
  const expectedTransportSlots = slotModes.length;
  const configuredTransportTrips = slotModes.filter(Boolean).length;
  const uniqueConfiguredModes = Array.from(new Set(slotModes.filter(Boolean)));
  const formatTransportSlot = (
    mode: "Door to Door" | "Bus Stop" | null | undefined,
    doorToDoorAddress: string | null | undefined,
    busNumber: string | null | undefined,
    busStop: string | null | undefined
  ) => {
    if (!mode) return "None";
    if (mode === "Door to Door") return doorToDoorAddress ? `Door to Door - ${doorToDoorAddress}` : "Door to Door";
    if (busNumber && busStop) return `Bus #${busNumber} - ${busStop}`;
    if (busNumber) return `Bus #${busNumber}`;
    if (busStop) return `Bus Stop - ${busStop}`;
    return "Bus Stop";
  };
  const transportationSummary =
    detail.schedule?.transportation_required === true
      ? configuredTransportTrips === 0
        ? "None"
        : uniqueConfiguredModes.length === 1 && configuredTransportTrips === expectedTransportSlots
          ? String(uniqueConfiguredModes[0])
          : "Mixed"
      : detail.schedule?.transportation_required === false
        ? "No"
        : "-";
  const codeStatus = detail.profile.code_status ?? detail.member.code_status ?? "-";
  const memberTrack = detail.member.latest_assessment_track ?? null;
  const rawDietType = detail.profile.diet_type ?? "Regular";
  const dietTypeDefault = DIET_TYPE_OPTIONS.includes(rawDietType as (typeof DIET_TYPE_OPTIONS)[number]) ? rawDietType : "Other";
  const dietTypeOtherDefault = dietTypeDefault === "Other" ? (detail.profile.diet_type ?? "") : "";
  const dietTextureDefault = detail.profile.diet_texture ?? "Regular";
  const profileUpdatedAt = detail.profile.updated_at ?? null;
  const profileUpdatedBy = detail.profile.updated_by_name ?? null;
  const scheduleUpdatedAt = detail.schedule?.updated_at ?? null;
  const scheduleUpdatedBy = detail.schedule?.updated_by_name ?? null;
  const contactsUpdatedAt = latestTimestamp(detail.contacts.map((row) => row.updated_at));
  const contactsUpdatedBy = latestUpdatedBy(detail.contacts, (row) => row.updated_at, (row) => row.created_by_name);
  const filesUpdatedAt = latestTimestamp(detail.files.map((row) => row.updated_at));
  const filesUpdatedBy = latestUpdatedBy(detail.files, (row) => row.updated_at, (row) => row.uploaded_by_name);
  const allergiesUpdatedAt = latestTimestamp(detail.mhpAllergies.map((row) => row.updated_at));
  const allergiesUpdatedBy = latestUpdatedBy(detail.mhpAllergies, (row) => row.updated_at, (row) => row.created_by_name);
  const physicianOrders = await getPhysicianOrdersForMember(detail.member.id);
  const pofRequests = await listPofRequestsByPhysicianOrderIds(
    detail.member.id,
    physicianOrders.map((row) => row.id)
  );
  const defaultNurseName = await getManagedUserSignoffLabel(profile.id, profile.full_name);
  const defaultFromEmail = getConfiguredClinicalSenderEmail();
  const physicianOrdersUpdatedAt = latestTimestamp(physicianOrders.map((row) => row.updatedAt));
  const physicianOrdersUpdatedBy = latestUpdatedBy(physicianOrders, (row) => row.updatedAt, (row) => row.updatedByName);

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-4 flex flex-col items-center gap-2">
          <MccPhotoUploader
            key={`mcc-photo-${detail.member.id}-${profileUpdatedAt ?? "na"}`}
            memberId={detail.member.id}
            returnTo={`/operations/member-command-center/${detail.member.id}?tab=${tab}`}
            profileImageUrl={detail.profile.profile_image_url ?? null}
            displayName={detail.member.display_name}
          />
          <div className="text-center">
            <p className="text-2xl font-bold text-primary-text">{detail.member.display_name}</p>
            <p className="text-sm font-semibold text-muted">Member Command Center</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <BackArrowButton
            fallbackHref="/operations/member-command-center"
            forceFallback
            ariaLabel="Back to member command center list"
          />
          <Link href={`/members/${detail.member.id}`} className="font-semibold text-brand">Member Detail</Link>
          {canViewMhpFromMcc ? (
            <Link href={`/health/member-health-profiles/${detail.member.id}`} className="font-semibold text-brand">Member Health Profile</Link>
          ) : null}
          {canViewPhysicianOrders ? (
            <Link href={`/health/physician-orders?memberId=${detail.member.id}`} className="font-semibold text-brand">Physician Orders</Link>
          ) : null}
        </div>
        {canViewFaceSheet || canEdit ? (
          <div id="discharge-actions" className="mt-2 flex justify-center gap-2">
            {canViewPhysicianOrders ? (
              <Link
                href={`/health/physician-orders?memberId=${detail.member.id}`}
                className="inline-flex h-9 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-[#12357e]"
              >
                Physician Orders
              </Link>
            ) : null}
            {canCreatePhysicianOrders ? (
              <Link
                href={`/health/physician-orders/new?memberId=${detail.member.id}`}
                className="inline-flex h-9 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-[#12357e]"
              >
                New POF
              </Link>
            ) : null}
            {canViewFaceSheet ? (
              <Link
                href={`/members/${detail.member.id}/face-sheet?from=mcc`}
                className="inline-flex h-9 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-[#12357e]"
              >
                Face Sheet
              </Link>
            ) : null}
            {canViewNameBadge ? (
              <Link
                href={`/members/${detail.member.id}/name-badge?from=mcc`}
                className="inline-flex h-9 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-[#12357e]"
              >
                Generate Name Badge
              </Link>
            ) : null}
            {canEdit ? (
            <MemberStatusToggle memberId={detail.member.id} memberName={detail.member.display_name} status={detail.member.status} />
            ) : null}
          </div>
        ) : null}
        <MccHeaderCards
          key={`mcc-header-${detail.member.id}-${profileUpdatedAt ?? "na"}-${scheduleUpdatedAt ?? "na"}`}
          memberId={detail.member.id}
          lockerNumber={detail.member.locker_number ?? null}
          dob={formatOptionalDate(detail.member.dob)}
          enrollment={formatOptionalDate(detail.schedule?.enrollment_date ?? detail.member.enrollment_date)}
          initialCodeStatus={codeStatus}
          initialPhotoConsent={detail.profile.photo_consent ?? null}
          initialTransportation={transportationSummary}
          trackLabel={memberTrack ? memberTrack.replace("Track ", "") : "-"}
          trackSource={detail.assessmentsCount > 0 ? "From MHP / latest intake assessment" : "No intake assessment"}
        />
      </Card>

      {canViewMhpFromMcc && detail.enrollmentPacketIntakeAlert?.reviewRequired ? (
        <Card className="border-amber-300 bg-amber-50" id="enrollment-intake-alert">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-amber-900">
              Enrollment packet completed by caregiver. Review intake details before finalizing MHP.
            </p>
            <p className="text-xs text-amber-900">
              Source: {detail.enrollmentPacketIntakeAlert.sourceLabel}
              {detail.enrollmentPacketIntakeAlert.caregiverName ? ` | Caregiver: ${detail.enrollmentPacketIntakeAlert.caregiverName}` : ""}
              {detail.enrollmentPacketIntakeAlert.importedAt ? ` | Completed: ${formatDateTime(detail.enrollmentPacketIntakeAlert.importedAt)}` : ""}
              {detail.enrollmentPacketIntakeAlert.initiatedByName ? ` | Initiated by: ${detail.enrollmentPacketIntakeAlert.initiatedByName}` : ""}
            </p>
            {detail.enrollmentPacketIntakeAlert.riskSignals.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {detail.enrollmentPacketIntakeAlert.riskSignals.map((signal) => (
                  <span key={signal} className="rounded-full border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900">
                    {signal}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3 text-xs font-semibold">
              <Link href={`/operations/member-command-center/${detail.member.id}?tab=demographics-contacts`} className="text-brand">
                View packet in Member Files
              </Link>
              <Link href={`/health/physician-orders/new?memberId=${detail.member.id}`} className="text-brand">
                Review imported data in POF
              </Link>
              {canViewMhpFromMcc ? (
                <Link href={`/health/member-health-profiles/${detail.member.id}`} className="text-brand">
                  Review MHP imported fields
                </Link>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-wrap gap-2">
          {MCC_TABS.map((item) => (
            <Link
              key={item}
              href={`/operations/member-command-center/${detail.member.id}?tab=${item}`}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${item === tab ? "border-brand bg-brand text-white" : "border-border text-primary-text"}`}
            >
              {TAB_LABELS[item]}
            </Link>
          ))}
        </div>
      </Card>

      {tab === "member-summary" ? (
        <Card id="member-summary">
          <SectionHeading title="Member Summary" lastUpdatedAt={profileUpdatedAt} lastUpdatedBy={profileUpdatedBy} />
          <div className="mt-3 grid gap-3 md:grid-cols-6">
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Age</p><p className="font-semibold">{detail.age ?? "-"}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Months Enrolled</p><p className="font-semibold">{monthsEnrolled ?? "-"}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Current Status</p><p className="font-semibold capitalize">{detail.member.status}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Locker #</p><p className="font-semibold">{detail.member.locker_number ?? "-"}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Makeup Days</p><p className="font-semibold">{detail.makeupBalance}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Photo Consent</p><p className="font-semibold">{boolLabel(detail.profile.photo_consent)}</p></div>
          </div>

          {canEdit ? (
            <MccSummaryForm
              key={`mcc-summary-${detail.member.id}-${profileUpdatedAt ?? "na"}`}
              memberId={detail.member.id}
              lockerNumber={detail.member.locker_number ?? ""}
              lockerOptions={lockerOptions}
              payor={detail.profile.payor ?? ""}
              originalReferralSource={detail.profile.original_referral_source ?? ""}
              photoConsent={detail.profile.photo_consent}
            />
          ) : null}
        </Card>
      ) : null}

      {tab === "attendance-enrollment" ? (
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
              payorId={activeMemberBillingSetting?.payor_id ?? null}
              payorOptions={activePayorOptions}
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
      ) : null}

      {tab === "transportation" ? (
        <Card id="transportation">
          <SectionHeading title="Transportation" lastUpdatedAt={scheduleUpdatedAt} lastUpdatedBy={scheduleUpdatedBy} />

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Transportation</p>
              <p className="font-semibold">{detail.schedule?.transportation_required == null ? "-" : detail.schedule.transportation_required ? "Yes" : "No"}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Transport Type</p>
              <p className="font-semibold">{transportationSummary}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Configured Trips</p>
              <p className="font-semibold">{configuredTransportTrips} / {expectedTransportSlots}</p>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-5 text-sm">
            {detail.schedule?.monday ? (
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">Monday</p>
                <p className="font-semibold">AM: {formatTransportSlot(detail.schedule.transport_monday_am_mode, detail.schedule.transport_monday_am_door_to_door_address, detail.schedule.transport_monday_am_bus_number, detail.schedule.transport_monday_am_bus_stop)}</p>
                <p className="font-semibold">PM: {formatTransportSlot(detail.schedule.transport_monday_pm_mode, detail.schedule.transport_monday_pm_door_to_door_address, detail.schedule.transport_monday_pm_bus_number, detail.schedule.transport_monday_pm_bus_stop)}</p>
              </div>
            ) : null}
            {detail.schedule?.tuesday ? (
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">Tuesday</p>
                <p className="font-semibold">AM: {formatTransportSlot(detail.schedule.transport_tuesday_am_mode, detail.schedule.transport_tuesday_am_door_to_door_address, detail.schedule.transport_tuesday_am_bus_number, detail.schedule.transport_tuesday_am_bus_stop)}</p>
                <p className="font-semibold">PM: {formatTransportSlot(detail.schedule.transport_tuesday_pm_mode, detail.schedule.transport_tuesday_pm_door_to_door_address, detail.schedule.transport_tuesday_pm_bus_number, detail.schedule.transport_tuesday_pm_bus_stop)}</p>
              </div>
            ) : null}
            {detail.schedule?.wednesday ? (
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">Wednesday</p>
                <p className="font-semibold">AM: {formatTransportSlot(detail.schedule.transport_wednesday_am_mode, detail.schedule.transport_wednesday_am_door_to_door_address, detail.schedule.transport_wednesday_am_bus_number, detail.schedule.transport_wednesday_am_bus_stop)}</p>
                <p className="font-semibold">PM: {formatTransportSlot(detail.schedule.transport_wednesday_pm_mode, detail.schedule.transport_wednesday_pm_door_to_door_address, detail.schedule.transport_wednesday_pm_bus_number, detail.schedule.transport_wednesday_pm_bus_stop)}</p>
              </div>
            ) : null}
            {detail.schedule?.thursday ? (
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">Thursday</p>
                <p className="font-semibold">AM: {formatTransportSlot(detail.schedule.transport_thursday_am_mode, detail.schedule.transport_thursday_am_door_to_door_address, detail.schedule.transport_thursday_am_bus_number, detail.schedule.transport_thursday_am_bus_stop)}</p>
                <p className="font-semibold">PM: {formatTransportSlot(detail.schedule.transport_thursday_pm_mode, detail.schedule.transport_thursday_pm_door_to_door_address, detail.schedule.transport_thursday_pm_bus_number, detail.schedule.transport_thursday_pm_bus_stop)}</p>
              </div>
            ) : null}
            {detail.schedule?.friday ? (
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">Friday</p>
                <p className="font-semibold">AM: {formatTransportSlot(detail.schedule.transport_friday_am_mode, detail.schedule.transport_friday_am_door_to_door_address, detail.schedule.transport_friday_am_bus_number, detail.schedule.transport_friday_am_bus_stop)}</p>
                <p className="font-semibold">PM: {formatTransportSlot(detail.schedule.transport_friday_pm_mode, detail.schedule.transport_friday_pm_door_to_door_address, detail.schedule.transport_friday_pm_bus_number, detail.schedule.transport_friday_pm_bus_stop)}</p>
              </div>
            ) : null}
          </div>

          {canEdit && detail.schedule ? (
            <MccTransportationFormShell
              key={`mcc-transport-${detail.member.id}-${scheduleUpdatedAt ?? "na"}`}
              memberId={detail.member.id}
              transportationRequired={detail.schedule.transportation_required}
              defaultDoorToDoorAddress={defaultDoorToDoorAddress}
              monday={detail.schedule.monday}
              tuesday={detail.schedule.tuesday}
              wednesday={detail.schedule.wednesday}
              thursday={detail.schedule.thursday}
              friday={detail.schedule.friday}
              transportMondayAmMode={detail.schedule.transport_monday_am_mode}
              transportMondayAmDoorToDoorAddress={detail.schedule.transport_monday_am_door_to_door_address}
              transportMondayAmBusNumber={detail.schedule.transport_monday_am_bus_number}
              transportMondayAmBusStop={detail.schedule.transport_monday_am_bus_stop}
              transportMondayPmMode={detail.schedule.transport_monday_pm_mode}
              transportMondayPmDoorToDoorAddress={detail.schedule.transport_monday_pm_door_to_door_address}
              transportMondayPmBusNumber={detail.schedule.transport_monday_pm_bus_number}
              transportMondayPmBusStop={detail.schedule.transport_monday_pm_bus_stop}
              transportTuesdayAmMode={detail.schedule.transport_tuesday_am_mode}
              transportTuesdayAmDoorToDoorAddress={detail.schedule.transport_tuesday_am_door_to_door_address}
              transportTuesdayAmBusNumber={detail.schedule.transport_tuesday_am_bus_number}
              transportTuesdayAmBusStop={detail.schedule.transport_tuesday_am_bus_stop}
              transportTuesdayPmMode={detail.schedule.transport_tuesday_pm_mode}
              transportTuesdayPmDoorToDoorAddress={detail.schedule.transport_tuesday_pm_door_to_door_address}
              transportTuesdayPmBusNumber={detail.schedule.transport_tuesday_pm_bus_number}
              transportTuesdayPmBusStop={detail.schedule.transport_tuesday_pm_bus_stop}
              transportWednesdayAmMode={detail.schedule.transport_wednesday_am_mode}
              transportWednesdayAmDoorToDoorAddress={detail.schedule.transport_wednesday_am_door_to_door_address}
              transportWednesdayAmBusNumber={detail.schedule.transport_wednesday_am_bus_number}
              transportWednesdayAmBusStop={detail.schedule.transport_wednesday_am_bus_stop}
              transportWednesdayPmMode={detail.schedule.transport_wednesday_pm_mode}
              transportWednesdayPmDoorToDoorAddress={detail.schedule.transport_wednesday_pm_door_to_door_address}
              transportWednesdayPmBusNumber={detail.schedule.transport_wednesday_pm_bus_number}
              transportWednesdayPmBusStop={detail.schedule.transport_wednesday_pm_bus_stop}
              transportThursdayAmMode={detail.schedule.transport_thursday_am_mode}
              transportThursdayAmDoorToDoorAddress={detail.schedule.transport_thursday_am_door_to_door_address}
              transportThursdayAmBusNumber={detail.schedule.transport_thursday_am_bus_number}
              transportThursdayAmBusStop={detail.schedule.transport_thursday_am_bus_stop}
              transportThursdayPmMode={detail.schedule.transport_thursday_pm_mode}
              transportThursdayPmDoorToDoorAddress={detail.schedule.transport_thursday_pm_door_to_door_address}
              transportThursdayPmBusNumber={detail.schedule.transport_thursday_pm_bus_number}
              transportThursdayPmBusStop={detail.schedule.transport_thursday_pm_bus_stop}
              transportFridayAmMode={detail.schedule.transport_friday_am_mode}
              transportFridayAmDoorToDoorAddress={detail.schedule.transport_friday_am_door_to_door_address}
              transportFridayAmBusNumber={detail.schedule.transport_friday_am_bus_number}
              transportFridayAmBusStop={detail.schedule.transport_friday_am_bus_stop}
              transportFridayPmMode={detail.schedule.transport_friday_pm_mode}
              transportFridayPmDoorToDoorAddress={detail.schedule.transport_friday_pm_door_to_door_address}
              transportFridayPmBusNumber={detail.schedule.transport_friday_pm_bus_number}
              transportFridayPmBusStop={detail.schedule.transport_friday_pm_bus_stop}
              busStopOptions={detail.busStopDirectory.map((entry) => entry.bus_stop_name)}
              busNumberOptions={busNumberOptions}
            />
          ) : null}
        </Card>
      ) : null}

      {tab === "demographics-contacts" ? (
        <div className="space-y-4">
          <Card id="demographics">
            <SectionHeading title="Demographics" lastUpdatedAt={profileUpdatedAt} lastUpdatedBy={profileUpdatedBy} />
            {canEdit ? (
              <MccDemographicsForm
                key={`mcc-demographics-${detail.member.id}-${profileUpdatedAt ?? "na"}`}
                memberId={detail.member.id}
                memberDisplayName={detail.member.display_name}
                memberDob={detail.member.dob ?? ""}
                gender={detail.profile.gender ?? ""}
                streetAddress={detail.profile.street_address ?? ""}
                city={detail.profile.city ?? detail.member.city ?? ""}
                state={detail.profile.state ?? ""}
                zip={detail.profile.zip ?? ""}
                maritalStatus={detail.profile.marital_status ?? ""}
                primaryLanguage={detail.profile.primary_language ?? ""}
                secondaryLanguage={detail.profile.secondary_language ?? ""}
                religion={detail.profile.religion ?? ""}
                ethnicity={detail.profile.ethnicity ?? ""}
                isVeteran={detail.profile.is_veteran}
                veteranBranch={detail.profile.veteran_branch ?? ""}
              />
            ) : (
              <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                <p>Name: {detail.member.display_name}</p>
                <p>DOB: {formatOptionalDate(detail.member.dob)}</p>
                <p>Gender: {detail.profile.gender ?? "-"}</p>
                <p>Address: {[detail.profile.street_address, detail.profile.city, detail.profile.state, detail.profile.zip].filter(Boolean).join(", ") || "-"}</p>
                <p>Marital: {detail.profile.marital_status ?? "-"}</p>
                <p>Primary Language: {detail.profile.primary_language ?? "-"}</p>
                <p>Secondary Language: {detail.profile.secondary_language ?? "-"}</p>
                <p>Religion: {detail.profile.religion ?? "-"}</p>
                <p>Ethnicity: {detail.profile.ethnicity ?? "-"}</p>
                <p>Veteran: {boolLabel(detail.profile.is_veteran)}</p>
                <p>Veteran Branch: {detail.profile.veteran_branch ?? "-"}</p>
              </div>
            )}
          </Card>

          <Card id="contacts">
            <SectionHeading title="Contacts" lastUpdatedAt={contactsUpdatedAt} lastUpdatedBy={contactsUpdatedBy} />
            <div className="mt-3">
              <MemberCommandCenterContactManagerShell
                key={`mcc-contacts-${detail.member.id}-${contactsUpdatedAt ?? "na"}`}
                memberId={detail.member.id}
                rows={detail.contacts}
                canEdit={canEdit}
              />
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "legal" ? (
        <Card id="legal-info">
          <SectionHeading title="Legal" lastUpdatedAt={profileUpdatedAt} lastUpdatedBy={profileUpdatedBy} />
          {canEdit ? (
            <MccLegalForm
              key={`mcc-legal-${detail.member.id}-${profileUpdatedAt ?? "na"}`}
              memberId={detail.member.id}
              codeStatus={detail.profile.code_status ?? ""}
              dnr={detail.profile.dnr}
              dni={detail.profile.dni}
              polstMolstColst={detail.profile.polst_molst_colst ?? ""}
              hospice={detail.profile.hospice}
              advancedDirectivesObtained={detail.profile.advanced_directives_obtained}
              powerOfAttorney={detail.profile.power_of_attorney ?? ""}
              legalComments={detail.profile.legal_comments ?? ""}
            />
          ) : (
            <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
              <p>Code Status: {detail.profile.code_status ?? "-"}</p>
              <p>DNR: {boolLabel(detail.profile.dnr)}</p>
              <p>DNI: {boolLabel(detail.profile.dni)}</p>
              <p>POLST/MOLST/COLST: {detail.profile.polst_molst_colst ?? "-"}</p>
              <p>Hospice: {boolLabel(detail.profile.hospice)}</p>
              <p>Advanced Directives: {boolLabel(detail.profile.advanced_directives_obtained)}</p>
              <p>Power of Attorney: {detail.profile.power_of_attorney ?? "-"}</p>
              <p className="md:col-span-2">Comments: {detail.profile.legal_comments ?? "-"}</p>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "diet-allergies" ? (
        <Card id="diet-allergies">
          <SectionHeading title="Diet / Allergies" lastUpdatedAt={profileUpdatedAt} lastUpdatedBy={profileUpdatedBy} />
          {canEdit ? (
            <MccDietForm
              key={`mcc-diet-${detail.member.id}-${profileUpdatedAt ?? "na"}`}
              memberId={detail.member.id}
              dietCardHref={`/members/${detail.member.id}/diet-card?from=mcc`}
              dietTypeDefault={dietTypeDefault}
              dietTypeOtherDefault={dietTypeOtherDefault}
              textureDefault={dietTextureDefault}
              dietTypeOptions={DIET_TYPE_OPTIONS}
              dietTextureOptions={DIET_TEXTURE_OPTIONS}
              swallowingDifficulty={detail.profile.swallowing_difficulty ?? ""}
              supplements={detail.profile.supplements ?? ""}
              dietaryPreferencesRestrictions={detail.profile.dietary_preferences_restrictions ?? ""}
              foodDislikes={detail.profile.food_dislikes ?? ""}
              foodsToOmit={detail.profile.foods_to_omit ?? ""}
              commandCenterNotes={detail.profile.command_center_notes ?? ""}
            />
          ) : (
            <>
              <div className="mt-3 flex justify-end">
                <a
                  href={`/members/${detail.member.id}/diet-card?from=mcc`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
                >
                  Print Diet Card
                </a>
              </div>
              <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                <p>Diet: {detail.profile.diet_type ?? "-"}</p>
                <p>Texture: {detail.profile.diet_texture ?? "-"}</p>
                <p>Restrictions: {detail.profile.dietary_preferences_restrictions ?? "-"}</p>
                <p>Swallowing Difficulty: {detail.profile.swallowing_difficulty ?? "-"}</p>
                <p>Supplements: {detail.profile.supplements ?? "-"}</p>
                <p>Food Dislikes: {detail.profile.food_dislikes ?? "-"}</p>
                <p>Foods to Omit: {detail.profile.foods_to_omit ?? "-"}</p>
                <p className="md:col-span-2">Notes: {detail.profile.command_center_notes ?? "-"}</p>
              </div>
            </>
          )}
          <div className="mt-4">
            <SectionHeading title="Allergies" lastUpdatedAt={allergiesUpdatedAt} lastUpdatedBy={allergiesUpdatedBy} />
          </div>
          <MccAllergiesSection
            key={`mcc-allergies-${detail.member.id}-${allergiesUpdatedAt ?? "na"}`}
            memberId={detail.member.id}
            canEdit={canEdit}
            initialRows={detail.mhpAllergies.map((row) => ({
              id: row.id,
              allergy_group: row.allergy_group,
              allergy_name: row.allergy_name,
              severity: row.severity,
              comments: row.comments,
              updated_at: row.updated_at
            }))}
          />
        </Card>
      ) : null}

      <Card id="files-documents">
        <SectionHeading title="Files / Documents" lastUpdatedAt={filesUpdatedAt} lastUpdatedBy={filesUpdatedBy} />
        <div className="mt-3">
          <MemberCommandCenterFileManagerShell
            key={`mcc-files-${detail.member.id}-${filesUpdatedAt ?? "na"}`}
            memberId={detail.member.id}
            rows={detail.files}
            canEdit={canEdit}
          />
        </div>
      </Card>

      {canViewPhysicianOrders ? (
        <Card id="physician-orders" className="table-wrap">
          <SectionHeading
            title="Physician Orders / POF"
            lastUpdatedAt={physicianOrdersUpdatedAt}
            lastUpdatedBy={physicianOrdersUpdatedBy}
          />
          <div className="mt-3">
            <MemberCommandCenterPofSectionShell
              memberId={detail.member.id}
              physicianOrders={physicianOrders}
              requests={pofRequests}
              defaultNurseName={defaultNurseName}
              defaultFromEmail={defaultFromEmail}
              canCreatePhysicianOrders={canCreatePhysicianOrders}
            />
          </div>
        </Card>
      ) : null}

      <Card id="related-links">
        <CardTitle>Related Navigation</CardTitle>
        <div className="mt-3 grid gap-2 md:grid-cols-3 text-sm">
          {canViewMhpFromMcc ? (
            <Link href={`/health/member-health-profiles/${detail.member.id}`} className="rounded-lg border border-border px-3 py-2 font-semibold text-brand">Member Health Profile</Link>
          ) : null}
          <Link href={`/health/assessment?memberId=${detail.member.id}`} className="rounded-lg border border-border px-3 py-2 font-semibold text-brand">Assessments</Link>
          <Link href={detail.carePlanSummary.actionHref} className="rounded-lg border border-border px-3 py-2 font-semibold text-brand">Care Plans</Link>
          {canViewPhysicianOrders ? (
            <Link href={`/health/physician-orders?memberId=${detail.member.id}`} className="rounded-lg border border-border px-3 py-2 font-semibold text-brand">Orders / Physician Order Forms</Link>
          ) : null}
          <Link href={`/members/${detail.member.id}`} className="rounded-lg border border-border px-3 py-2 font-semibold text-brand">Documentation</Link>
          <Link href={`/operations/member-command-center/${detail.member.id}?tab=diet-allergies#diet-allergies`} className="rounded-lg border border-border px-3 py-2 font-semibold text-brand">Notes</Link>
        </div>
      </Card>
    </div>
  );
}

