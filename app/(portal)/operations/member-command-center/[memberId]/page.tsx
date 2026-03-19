import Link from "next/link";
import { notFound } from "next/navigation";

import { MemberStatusToggle } from "@/components/forms/member-status-toggle";
import { MccLegalForm } from "@/components/forms/mcc-legal-form";
import { MccSummaryForm } from "@/components/forms/mcc-summary-form";
import { MccHeaderCards } from "@/components/forms/mcc-header-cards";
import { MccPhotoUploader } from "@/components/forms/mcc-photo-uploader";
import {
  MemberCommandCenterFileManagerShell,
  MemberCommandCenterPofSectionShell
} from "@/components/forms/member-command-center-shells";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import {
  MCC_TABS,
  TAB_LABELS,
  SectionHeading,
  boolLabel,
  firstString,
  latestTimestamp,
  latestUpdatedBy,
  resolveTab,
  type MccTab
} from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import { requireModuleAccess } from "@/lib/auth";
import {
  canManagePofSignatureWorkflowForRole,
  canCreatePhysicianOrdersModuleForRole,
  canGenerateMemberDocumentForRole,
  canPerformModuleAction,
  canViewPhysicianOrdersModuleForRole,
  normalizeRoleKey
} from "@/lib/permissions";
import { resolveActiveEffectiveMemberRowForDate } from "@/lib/services/billing-effective";
import {
  getAvailableLockerNumbersForMemberSupabase,
  getMemberCommandCenterDetailSupabase,
  listMemberBillingSettingsSupabase
} from "@/lib/services/member-command-center-supabase";
import { getConfiguredBusNumbers } from "@/lib/services/operations-settings";
import type { PhysicianOrderMemberHistoryRow } from "@/lib/services/physician-order-model";
import type { PofRequestSummary } from "@/lib/services/pof-types";
import {
  loadExpectedAttendanceSupabaseContext,
  resolveExpectedAttendanceFromSupabaseContext
} from "@/lib/services/expected-attendance-supabase";
import { getScheduledDayAbbreviations } from "@/lib/services/member-schedule-selectors";
import { listScheduleChangesSupabase, SCHEDULE_WEEKDAY_KEYS } from "@/lib/services/schedule-changes-supabase";
import { toEasternDate } from "@/lib/timezone";
import { formatDateTime, formatOptionalDate } from "@/lib/utils";

const DIET_TYPE_OPTIONS = ["Regular", "Diabetic", "Low Sodium", "Pureed", "Renal", "Heart Healthy", "Other"] as const;
const WEEKDAY_LABELS: Record<(typeof SCHEDULE_WEEKDAY_KEYS)[number], string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri"
};

async function renderTabSection(input: {
  tab: MccTab;
  canEdit: boolean;
  canEditAttendanceBilling: boolean;
  detail: Awaited<ReturnType<typeof getMemberCommandCenterDetailSupabase>>;
  profileUpdatedAt: string | null;
  profileUpdatedBy: string | null;
  scheduleUpdatedAt: string | null;
  scheduleUpdatedBy: string | null;
  monthsEnrolled: number | null;
  scheduleDays: string;
  transportationSummary: string;
  effectiveScheduleTodayLabel: string;
  activeOverrideCount: number;
  activeMemberBillingSetting: {
    use_center_default_billing_mode: boolean;
    billing_mode: "Membership" | "Monthly" | "Custom" | null;
    monthly_billing_basis: "ScheduledMonthBehind" | "ActualAttendanceMonthBehind";
    bill_extra_days: boolean;
    bill_ancillary_arrears: boolean;
  } | null;
  billingPayorName: string;
  billingPayorStatus: string;
  defaultDoorToDoorAddress: string;
  configuredTransportTrips: number;
  expectedTransportSlots: number;
  busNumberOptions: string[];
  contactsUpdatedAt: string | null;
  contactsUpdatedBy: string | null;
  dietTypeDefault: string;
  dietTypeOtherDefault: string;
  dietTextureDefault: string;
  allergiesUpdatedAt: string | null;
  allergiesUpdatedBy: string | null;
}) {
  if (!input.detail) return null;

  switch (input.tab) {
    case "attendance-enrollment": {
      const { default: AttendanceTab } = await import("@/app/(portal)/operations/member-command-center/attendance-tab");
      return (
        <AttendanceTab
          canEditAttendanceBilling={input.canEditAttendanceBilling}
          detail={input.detail}
          scheduleUpdatedAt={input.scheduleUpdatedAt}
          scheduleUpdatedBy={input.scheduleUpdatedBy}
          monthsEnrolled={input.monthsEnrolled}
          scheduleDays={input.scheduleDays}
          transportationSummary={input.transportationSummary}
          effectiveScheduleTodayLabel={input.effectiveScheduleTodayLabel}
          activeOverrideCount={input.activeOverrideCount}
          activeMemberBillingSetting={input.activeMemberBillingSetting}
          billingPayorName={input.billingPayorName}
          billingPayorStatus={input.billingPayorStatus}
        />
      );
    }
    case "transportation": {
      const { default: TransportationTab } = await import("@/app/(portal)/operations/member-command-center/transportation-tab");
      return (
        <TransportationTab
          canEdit={input.canEdit}
          detail={input.detail}
          scheduleUpdatedAt={input.scheduleUpdatedAt}
          scheduleUpdatedBy={input.scheduleUpdatedBy}
          transportationSummary={input.transportationSummary}
          configuredTransportTrips={input.configuredTransportTrips}
          expectedTransportSlots={input.expectedTransportSlots}
          defaultDoorToDoorAddress={input.defaultDoorToDoorAddress}
          busNumberOptions={input.busNumberOptions}
        />
      );
    }
    case "demographics-contacts": {
      const { default: DemographicsTab } = await import("@/app/(portal)/operations/member-command-center/demographics-tab");
      return (
        <DemographicsTab
          canEdit={input.canEdit}
          detail={input.detail}
          profileUpdatedAt={input.profileUpdatedAt}
          profileUpdatedBy={input.profileUpdatedBy}
          contactsUpdatedAt={input.contactsUpdatedAt}
          contactsUpdatedBy={input.contactsUpdatedBy}
        />
      );
    }
    case "diet-allergies": {
      const { default: DietTab } = await import("@/app/(portal)/operations/member-command-center/diet-tab");
      return (
        <DietTab
          canEdit={input.canEdit}
          detail={input.detail}
          profileUpdatedAt={input.profileUpdatedAt}
          profileUpdatedBy={input.profileUpdatedBy}
          dietTypeDefault={input.dietTypeDefault}
          dietTypeOtherDefault={input.dietTypeOtherDefault}
          dietTextureDefault={input.dietTextureDefault}
          allergiesUpdatedAt={input.allergiesUpdatedAt}
          allergiesUpdatedBy={input.allergiesUpdatedBy}
        />
      );
    }
    default:
      return null;
  }
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
  const canViewFaceSheet = canGenerateMemberDocumentForRole(role);
  const canViewNameBadge = canGenerateMemberDocumentForRole(role);
  const canAccessPofWorkflow = canManagePofSignatureWorkflowForRole(role);
  const canViewPhysicianOrders = canViewPhysicianOrdersModuleForRole(role);
  const canCreatePhysicianOrders = canCreatePhysicianOrdersModuleForRole(role);
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
  const lockerOptions = await getAvailableLockerNumbersForMemberSupabase(memberId);
  const busNumberOptions = await getConfiguredBusNumbers();
  const currentBillingPayor = detail.contacts.find((row) => row.is_payor) ?? null;
  const billingPayorName = currentBillingPayor?.contact_name ?? "No payor contact designated";
  const billingPayorStatus = currentBillingPayor
    ? "Managed in Contacts. Update the designated payor contact there."
    : "No payor contact designated. Set one in Contacts before billing.";

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
  let physicianOrders: PhysicianOrderMemberHistoryRow[] = [];
  let pofRequests: PofRequestSummary[] = [];
  let defaultNurseName = profile.full_name;
  let defaultFromEmail = "";
  let physicianOrdersUpdatedAt: string | null = null;
  let physicianOrdersUpdatedBy: string | null = null;

  if (canAccessPofWorkflow) {
    const [
      physicianOrdersModule,
      pofReadModule,
      userManagementModule
    ] = await Promise.all([
      import("@/lib/services/physician-orders-supabase"),
      import("@/lib/services/pof-read"),
      import("@/lib/services/user-management")
    ]);

    physicianOrders = await physicianOrdersModule.getPhysicianOrdersForMember(detail.member.id);
    pofRequests = await pofReadModule.listPofRequestsByPhysicianOrderIds(
      detail.member.id,
      physicianOrders.map((row) => row.id)
    );
    defaultNurseName = await userManagementModule.getManagedUserSignoffLabel(profile.id, profile.full_name);
    defaultFromEmail = pofReadModule.getConfiguredClinicalSenderEmail();
    physicianOrdersUpdatedAt = latestTimestamp(physicianOrders.map((row) => row.updatedAt));
    physicianOrdersUpdatedBy = latestUpdatedBy(
      physicianOrders,
      (row) => row.updatedAt,
      (row) => row.updatedByName
    );
  }
  const tabSection = await renderTabSection({
    tab,
    canEdit,
    canEditAttendanceBilling,
    detail,
    profileUpdatedAt,
    profileUpdatedBy,
    scheduleUpdatedAt,
    scheduleUpdatedBy,
    monthsEnrolled,
    scheduleDays,
    transportationSummary,
    effectiveScheduleTodayLabel,
    activeOverrideCount,
    activeMemberBillingSetting,
    billingPayorName,
    billingPayorStatus,
    defaultDoorToDoorAddress,
    configuredTransportTrips,
    expectedTransportSlots,
    busNumberOptions,
    contactsUpdatedAt,
    contactsUpdatedBy,
    dietTypeDefault,
    dietTypeOtherDefault,
    dietTextureDefault,
    allergiesUpdatedAt,
    allergiesUpdatedBy
  });

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
              billingPayorDisplay={billingPayorName}
              originalReferralSource={detail.profile.original_referral_source ?? ""}
              photoConsent={detail.profile.photo_consent}
            />
          ) : null}
        </Card>
      ) : null}

      {tabSection}

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

      {canAccessPofWorkflow ? (
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
              canViewPhysicianOrdersModule={canViewPhysicianOrders}
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
          {canViewMhpFromMcc ? (
            <Link href={`/health/progress-notes?memberId=${detail.member.id}`} className="rounded-lg border border-border px-3 py-2 font-semibold text-brand">Progress Notes</Link>
          ) : null}
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

