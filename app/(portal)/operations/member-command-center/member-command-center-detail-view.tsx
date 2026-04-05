import Link from "next/link";
import {
  CalendarCheck2,
  CalendarClock,
  CircleDollarSign,
  CirclePause,
  HandCoins,
  LayoutDashboard,
  Lock,
  type LucideIcon
} from "lucide-react";

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
  MCC_PRIMARY_TABS,
  MCC_SECONDARY_TABS,
  TAB_LABELS,
  SectionHeading,
  type MccTab
} from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import { memberRoutes } from "@/lib/routes";
import type { MemberCommandCenterDetailPageReadModel } from "@/lib/services/member-command-center-detail-read-model";
import { formatDateTime, formatOptionalDate } from "@/lib/utils";
import type { AppRole } from "@/types/app";

const PRIMARY_TAB_ICONS: Record<(typeof MCC_PRIMARY_TABS)[number], LucideIcon> = {
  overview: LayoutDashboard,
  attendance: CalendarCheck2,
  "schedule-changes": CalendarClock,
  pricing: CircleDollarSign,
  "additional-charges": HandCoins,
  holds: CirclePause,
  "locker-assignments": Lock
};

type DetailPageViewData = MemberCommandCenterDetailPageReadModel;

async function renderTabSection(input: {
  tab: MccTab;
  canEdit: boolean;
  canEditAttendanceBilling: boolean;
  detailPageData: DetailPageViewData;
  selectedOperationalDate: string;
  viewerRole: AppRole;
  viewerUserId: string;
}) {
  const { detail, base, workspace } = input.detailPageData;

  switch (input.tab) {
    case "attendance": {
      const { default: AttendanceTab } = await import("@/app/(portal)/operations/member-command-center/attendance-tab");
      return (
        <AttendanceTab
          canEditAttendanceBilling={input.canEditAttendanceBilling}
          detail={detail}
          scheduleUpdatedAt={base.scheduleUpdatedAt}
          scheduleUpdatedBy={base.scheduleUpdatedBy}
          monthsEnrolled={base.monthsEnrolled}
          scheduleDays={base.scheduleDays}
          transportationSummary={base.transportationSummary}
          effectiveScheduleTodayLabel={workspace.effectiveScheduleTodayLabel}
          activeOverrideCount={workspace.activeOverrideCount}
          activeMemberBillingSetting={workspace.activeMemberBillingSetting}
          billingPayorName={base.billingPayorName}
          billingPayorStatus={base.billingPayorStatus}
        />
      );
    }
    case "schedule-changes": {
      const { default: ScheduleChangesTab } = await import("@/app/(portal)/operations/member-command-center/schedule-changes-tab");
      return <ScheduleChangesTab memberId={detail.member.id} memberName={detail.member.display_name} canEdit={input.canEditAttendanceBilling} />;
    }
    case "pricing": {
      const { default: PricingTab } = await import("@/app/(portal)/operations/member-command-center/pricing-tab");
      return (
        <PricingTab
          canEditAttendanceBilling={input.canEditAttendanceBilling}
          detail={detail}
          scheduleUpdatedAt={base.scheduleUpdatedAt}
          scheduleUpdatedBy={base.scheduleUpdatedBy}
          activeMemberBillingSetting={workspace.activeMemberBillingSetting}
          billingPayorName={base.billingPayorName}
          billingPayorStatus={base.billingPayorStatus}
        />
      );
    }
    case "additional-charges": {
      const { default: AdditionalChargesTab } = await import("@/app/(portal)/operations/member-command-center/additional-charges-tab");
      return (
        <AdditionalChargesTab
          memberId={detail.member.id}
          memberName={detail.member.display_name}
          role={input.viewerRole}
          actorUserId={input.viewerUserId}
        />
      );
    }
    case "holds": {
      const { default: HoldsTab } = await import("@/app/(portal)/operations/member-command-center/holds-tab");
      return (
        <HoldsTab
          memberId={detail.member.id}
          memberName={detail.member.display_name}
          canEdit={input.canEdit}
          selectedDate={input.selectedOperationalDate}
        />
      );
    }
    case "locker-assignments": {
      const { default: LockerAssignmentsTab } = await import("@/app/(portal)/operations/member-command-center/locker-assignments-tab");
      return (
        <LockerAssignmentsTab
          memberId={detail.member.id}
          memberName={detail.member.display_name}
          lockerNumber={detail.member.locker_number ?? null}
          lockerOptions={workspace.lockerOptions}
          canEdit={input.canEdit}
        />
      );
    }
    case "transportation": {
      const { default: TransportationTab } = await import("@/app/(portal)/operations/member-command-center/transportation-tab");
      return (
        <TransportationTab
          canEdit={input.canEdit}
          detail={detail}
          scheduleUpdatedAt={base.scheduleUpdatedAt}
          scheduleUpdatedBy={base.scheduleUpdatedBy}
          transportationSummary={base.transportationSummary}
          configuredTransportTrips={base.configuredTransportTrips}
          expectedTransportSlots={base.expectedTransportSlots}
          defaultDoorToDoorAddress={base.defaultDoorToDoorAddress}
          busStopOptions={workspace.busStopOptions}
          busNumberOptions={workspace.busNumberOptions}
        />
      );
    }
    case "demographics-contacts": {
      const { default: DemographicsTab } = await import("@/app/(portal)/operations/member-command-center/demographics-tab");
      return (
        <DemographicsTab
          canEdit={input.canEdit}
          detail={detail}
          profileUpdatedAt={base.profileUpdatedAt}
          profileUpdatedBy={base.profileUpdatedBy}
          contactsUpdatedAt={base.contactsUpdatedAt}
          contactsUpdatedBy={base.contactsUpdatedBy}
        />
      );
    }
    case "diet-allergies": {
      const { default: DietTab } = await import("@/app/(portal)/operations/member-command-center/diet-tab");
      return (
        <DietTab
          canEdit={input.canEdit}
          detail={detail}
          profileUpdatedAt={base.profileUpdatedAt}
          profileUpdatedBy={base.profileUpdatedBy}
          dietTypeDefault={base.dietTypeDefault}
          dietTypeOtherDefault={base.dietTypeOtherDefault}
          dietTextureDefault={base.dietTextureDefault}
          allergiesUpdatedAt={base.allergiesUpdatedAt}
          allergiesUpdatedBy={base.allergiesUpdatedBy}
        />
      );
    }
    default:
      return null;
  }
}

export async function MemberCommandCenterDetailView({
  detailPageData,
  tab,
  selectedOperationalDate,
  successMessage,
  errorMessage,
  canEdit,
  canEditAttendanceBilling,
  canViewMhpFromMcc,
  canViewFaceSheet,
  canViewNameBadge,
  canViewPhysicianOrders,
  canCreatePhysicianOrders,
  viewerRole,
  viewerUserId
}: {
  detailPageData: DetailPageViewData;
  tab: MccTab;
  selectedOperationalDate: string;
  successMessage: string | null;
  errorMessage: string | null;
  canEdit: boolean;
  canEditAttendanceBilling: boolean;
  canViewMhpFromMcc: boolean;
  canViewFaceSheet: boolean;
  canViewNameBadge: boolean;
  canViewPhysicianOrders: boolean;
  canCreatePhysicianOrders: boolean;
  viewerRole: AppRole;
  viewerUserId: string;
}) {
  const { detail, base, pofSection } = detailPageData;
  const tabSection = await renderTabSection({
    tab,
    canEdit,
    canEditAttendanceBilling,
    detailPageData,
    selectedOperationalDate,
    viewerRole,
    viewerUserId
  });

  return (
    <div className="space-y-4">
      {errorMessage ? (
        <Card className="border-danger/40 bg-danger/5">
          <p className="text-sm font-semibold text-danger">{errorMessage}</p>
        </Card>
      ) : null}
      {successMessage ? (
        <Card className="border-emerald-300 bg-emerald-50">
          <p className="text-sm font-semibold text-emerald-800">{successMessage}</p>
        </Card>
      ) : null}
      <Card>
        <div className="mb-4 flex flex-col items-center gap-2">
          <MccPhotoUploader
            key={`mcc-photo-${detail.member.id}-${base.profileUpdatedAt ?? "na"}`}
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
            fallbackHref={memberRoutes.commandCenterIndex}
            forceFallback
            ariaLabel="Back to member command center list"
          />
          <Link href={memberRoutes.detail(detail.member.id)} className="font-semibold text-brand">
            Documentation Summary
          </Link>
          {canViewMhpFromMcc ? (
            <Link href={memberRoutes.healthProfileDetail(detail.member.id)} className="font-semibold text-brand">
              Member Health Profile
            </Link>
          ) : null}
          {canViewPhysicianOrders ? (
            <Link href={`/health/physician-orders?memberId=${detail.member.id}`} className="font-semibold text-brand">
              Physician Orders
            </Link>
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
            {canEdit ? <MemberStatusToggle memberId={detail.member.id} memberName={detail.member.display_name} status={detail.member.status} /> : null}
          </div>
        ) : null}
        <MccHeaderCards
          key={`mcc-header-${detail.member.id}-${base.profileUpdatedAt ?? "na"}-${base.scheduleUpdatedAt ?? "na"}`}
          memberId={detail.member.id}
          lockerNumber={detail.member.locker_number ?? null}
          dob={formatOptionalDate(detail.member.dob)}
          enrollment={formatOptionalDate(detail.schedule?.enrollment_date ?? detail.member.enrollment_date)}
          initialCodeStatus={base.codeStatus}
          initialPhotoConsent={detail.profile.photo_consent ?? null}
          initialTransportation={base.transportationSummary}
          trackLabel={base.memberTrack ? base.memberTrack.replace("Track ", "") : "-"}
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
              {detail.enrollmentPacketIntakeAlert.importedAt
                ? ` | Completed: ${formatDateTime(detail.enrollmentPacketIntakeAlert.importedAt)}`
                : ""}
              {detail.enrollmentPacketIntakeAlert.initiatedByName
                ? ` | Initiated by: ${detail.enrollmentPacketIntakeAlert.initiatedByName}`
                : ""}
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
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Operational Workspace</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {MCC_PRIMARY_TABS.map((item) => {
            const Icon = PRIMARY_TAB_ICONS[item];
            return (
              <Link
                key={item}
                href={`/operations/member-command-center/${detail.member.id}?tab=${item}`}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${
                  item === tab ? "border-brand bg-brand text-white" : "border-border text-primary-text"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{TAB_LABELS[item]}</span>
              </Link>
            );
          })}
        </div>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Member Record</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {MCC_SECONDARY_TABS.map((item) => (
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

      {tab === "overview" ? (
        <Card id="overview">
          <SectionHeading title="Overview" lastUpdatedAt={base.profileUpdatedAt} lastUpdatedBy={base.profileUpdatedBy} />
          <div className="mt-3 grid gap-3 md:grid-cols-6">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Age</p>
              <p className="font-semibold">{detail.age ?? "-"}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Months Enrolled</p>
              <p className="font-semibold">{base.monthsEnrolled ?? "-"}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Current Status</p>
              <p className="font-semibold capitalize">{detail.member.status}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Locker #</p>
              <p className="font-semibold">{detail.member.locker_number ?? "-"}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Makeup Days</p>
              <p className="font-semibold">{detail.makeupBalance}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Photo Consent</p>
              <p className="font-semibold">{detail.profile.photo_consent == null ? "-" : detail.profile.photo_consent ? "Yes" : "No"}</p>
            </div>
          </div>

          {canEdit ? (
            <MccSummaryForm
              key={`mcc-summary-${detail.member.id}-${base.profileUpdatedAt ?? "na"}`}
              memberId={detail.member.id}
              lockerNumber={detail.member.locker_number ?? ""}
              billingPayorDisplay={base.billingPayorName}
              originalReferralSource={detail.profile.original_referral_source ?? ""}
              photoConsent={detail.profile.photo_consent}
            />
          ) : null}
        </Card>
      ) : null}

      {tabSection}

      {tab === "legal" ? (
        <Card id="legal-info">
          <SectionHeading title="Legal" lastUpdatedAt={base.profileUpdatedAt} lastUpdatedBy={base.profileUpdatedBy} />
          {canEdit ? (
            <MccLegalForm
              key={`mcc-legal-${detail.member.id}-${base.profileUpdatedAt ?? "na"}`}
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
              <p>DNR: {detail.profile.dnr == null ? "-" : detail.profile.dnr ? "Yes" : "No"}</p>
              <p>DNI: {detail.profile.dni == null ? "-" : detail.profile.dni ? "Yes" : "No"}</p>
              <p>POLST/MOLST/COLST: {detail.profile.polst_molst_colst ?? "-"}</p>
              <p>Hospice: {detail.profile.hospice == null ? "-" : detail.profile.hospice ? "Yes" : "No"}</p>
              <p>
                Advanced Directives:{" "}
                {detail.profile.advanced_directives_obtained == null
                  ? "-"
                  : detail.profile.advanced_directives_obtained
                    ? "Yes"
                    : "No"}
              </p>
              <p>Power of Attorney: {detail.profile.power_of_attorney ?? "-"}</p>
              <p className="md:col-span-2">Comments: {detail.profile.legal_comments ?? "-"}</p>
            </div>
          )}
        </Card>
      ) : null}

      <Card id="files-documents">
        <SectionHeading title="Files / Documents" lastUpdatedAt={base.filesUpdatedAt} lastUpdatedBy={base.filesUpdatedBy} />
        <div className="mt-3">
          <MemberCommandCenterFileManagerShell
            key={`mcc-files-${detail.member.id}-${base.filesUpdatedAt ?? "na"}`}
            memberId={detail.member.id}
            rows={detail.files}
            canEdit={canEdit}
          />
        </div>
      </Card>

      {pofSection ? (
        <Card id="physician-orders" className="table-wrap">
          <SectionHeading
            title="Physician Orders / POF"
            lastUpdatedAt={pofSection.physicianOrdersUpdatedAt}
            lastUpdatedBy={pofSection.physicianOrdersUpdatedBy}
          />
          <div className="mt-3">
            <MemberCommandCenterPofSectionShell
              memberId={detail.member.id}
              physicianOrders={pofSection.physicianOrders}
              requests={pofSection.requests}
              defaultNurseName={pofSection.defaultNurseName}
              defaultFromEmail={pofSection.defaultFromEmail}
              canViewPhysicianOrdersModule={canViewPhysicianOrders}
              canCreatePhysicianOrders={canCreatePhysicianOrders}
            />
          </div>
        </Card>
      ) : null}

      <Card id="related-links">
        <CardTitle>Related Navigation</CardTitle>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
          {canViewMhpFromMcc ? (
            <Link href={`/health/member-health-profiles/${detail.member.id}`} className="rounded-lg border border-border px-3 py-2 font-semibold text-brand">
              Member Health Profile
            </Link>
          ) : null}
          <Link href={`/health/assessment?memberId=${detail.member.id}`} className="rounded-lg border border-border px-3 py-2 font-semibold text-brand">
            Assessments
          </Link>
          <Link href={detail.carePlanSummary.actionHref} className="rounded-lg border border-border px-3 py-2 font-semibold text-brand">
            Care Plans
          </Link>
          {canViewMhpFromMcc ? (
            <Link href={`/health/progress-notes?memberId=${detail.member.id}`} className="rounded-lg border border-border px-3 py-2 font-semibold text-brand">
              Progress Notes
            </Link>
          ) : null}
          {canViewPhysicianOrders ? (
            <Link href={`/health/physician-orders?memberId=${detail.member.id}`} className="rounded-lg border border-border px-3 py-2 font-semibold text-brand">
              Orders / Physician Order Forms
            </Link>
          ) : null}
          <Link href={memberRoutes.detail(detail.member.id)} className="rounded-lg border border-border px-3 py-2 font-semibold text-brand">
            Documentation Summary
          </Link>
          <Link
            href={`/operations/member-command-center/${detail.member.id}?tab=diet-allergies#diet-allergies`}
            className="rounded-lg border border-border px-3 py-2 font-semibold text-brand"
          >
            Notes
          </Link>
        </div>
      </Card>
    </div>
  );
}
