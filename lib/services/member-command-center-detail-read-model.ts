import { cache } from "react";

import { resolveActiveEffectiveMemberRowForDate } from "@/lib/services/billing-effective";
import { loadExpectedAttendanceSupabaseContext, resolveExpectedAttendanceFromSupabaseContext } from "@/lib/services/expected-attendance-supabase";
import {
  getAvailableLockerNumbersForMemberSupabase,
  getMemberCommandCenterDetailSupabase,
  listBusStopDirectorySupabase
} from "@/lib/services/member-command-center-runtime";
import { listMemberBillingSettingsSupabase } from "@/lib/services/member-command-center-supabase";
import { formatScheduleWeekdayShortLabels, getScheduledDayAbbreviations } from "@/lib/services/member-schedule-selectors";
import { getConfiguredBusNumbers } from "@/lib/services/operations-settings";
import type { PhysicianOrderMemberHistoryRow } from "@/lib/services/physician-order-model";
import type { PofRequestSummary } from "@/lib/services/pof-types";
import { listScheduleChangesSupabase } from "@/lib/services/schedule-changes-supabase";
import { toEasternDate } from "@/lib/timezone";

type MemberCommandCenterDetail = NonNullable<Awaited<ReturnType<typeof getMemberCommandCenterDetailSupabase>>>;

export type MemberCommandCenterDetailPageTab =
  | "overview"
  | "attendance"
  | "schedule-changes"
  | "pricing"
  | "additional-charges"
  | "holds"
  | "locker-assignments"
  | "demographics-contacts"
  | "transportation"
  | "legal"
  | "diet-allergies";

export type MemberCommandCenterActiveBillingSetting = {
  use_center_default_billing_mode: boolean;
  billing_mode: "Membership" | "Monthly" | "Custom" | null;
  monthly_billing_basis: "ScheduledMonthBehind" | "ActualAttendanceMonthBehind";
  bill_extra_days: boolean;
  bill_ancillary_arrears: boolean;
} | null;

export interface MemberCommandCenterBaseViewModel {
  monthsEnrolled: number | null;
  scheduleDays: string;
  transportationSummary: string;
  configuredTransportTrips: number;
  expectedTransportSlots: number;
  defaultDoorToDoorAddress: string;
  billingPayorName: string;
  billingPayorStatus: string;
  codeStatus: string;
  memberTrack: string | null;
  dietTypeDefault: string;
  dietTypeOtherDefault: string;
  dietTextureDefault: string;
  profileUpdatedAt: string | null;
  profileUpdatedBy: string | null;
  scheduleUpdatedAt: string | null;
  scheduleUpdatedBy: string | null;
  contactsUpdatedAt: string | null;
  contactsUpdatedBy: string | null;
  filesUpdatedAt: string | null;
  filesUpdatedBy: string | null;
  allergiesUpdatedAt: string | null;
  allergiesUpdatedBy: string | null;
}

export interface MemberCommandCenterWorkspaceViewModel {
  activeMemberBillingSetting: MemberCommandCenterActiveBillingSetting;
  effectiveScheduleTodayLabel: string;
  activeOverrideCount: number;
  lockerOptions: string[];
  busStopOptions: string[];
  busNumberOptions: string[];
}

export interface MemberCommandCenterAttendanceBillingViewModel {
  activeMemberBillingSetting: MemberCommandCenterActiveBillingSetting;
  effectiveScheduleTodayLabel: string;
  activeOverrideCount: number;
}

export interface MemberCommandCenterTransportationLookupViewModel {
  busStopOptions: string[];
  busNumberOptions: string[];
}

export interface MemberCommandCenterPofSectionViewModel {
  physicianOrders: PhysicianOrderMemberHistoryRow[];
  requests: PofRequestSummary[];
  defaultNurseName: string;
  defaultFromEmail: string;
  physicianOrdersUpdatedAt: string | null;
  physicianOrdersUpdatedBy: string | null;
}

export interface MemberCommandCenterDetailPageData {
  detail: MemberCommandCenterDetail;
  shared: MemberCommandCenterBaseViewModel;
  attendanceBilling: MemberCommandCenterAttendanceBillingViewModel | null;
  transportationLookups: MemberCommandCenterTransportationLookupViewModel | null;
  lockerOptions: string[];
  physicianOrdersSection: MemberCommandCenterPofSectionViewModel | null;
}

export interface MemberCommandCenterDetailPageReadModel {
  detail: MemberCommandCenterDetail;
  base: MemberCommandCenterBaseViewModel;
  workspace: MemberCommandCenterWorkspaceViewModel;
  pofSection: MemberCommandCenterPofSectionViewModel | null;
}

const DIET_TYPE_OPTIONS = ["Regular", "Diabetic", "Low Sodium", "Pureed", "Renal", "Heart Healthy", "Other"] as const;

const loadTransportationLookupOptions = cache(async () => {
  const [busStopDirectory, busNumberOptions] = await Promise.all([
    listBusStopDirectorySupabase(),
    getConfiguredBusNumbers()
  ]);

  return {
    busStopOptions: busStopDirectory.map((entry) => entry.bus_stop_name),
    busNumberOptions
  };
});

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

function buildTransportationSummary(detail: MemberCommandCenterDetail) {
  const slotModes = detail.schedule
    ? [
        ...(detail.schedule.monday ? [detail.schedule.transport_monday_am_mode, detail.schedule.transport_monday_pm_mode] : []),
        ...(detail.schedule.tuesday ? [detail.schedule.transport_tuesday_am_mode, detail.schedule.transport_tuesday_pm_mode] : []),
        ...(detail.schedule.wednesday
          ? [detail.schedule.transport_wednesday_am_mode, detail.schedule.transport_wednesday_pm_mode]
          : []),
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

  return {
    transportationSummary,
    configuredTransportTrips,
    expectedTransportSlots
  };
}

export function buildMemberCommandCenterBaseViewModel(detail: MemberCommandCenterDetail): MemberCommandCenterBaseViewModel {
  const { transportationSummary, configuredTransportTrips, expectedTransportSlots } = buildTransportationSummary(detail);
  const currentBillingPayor = detail.contacts.find((row) => row.is_payor) ?? null;
  const billingPayorName = currentBillingPayor?.contact_name ?? "No payor contact designated";
  const billingPayorStatus = currentBillingPayor
    ? "Managed in Contacts. Update the designated payor contact there."
    : "No payor contact designated. Set one in Contacts before billing.";
  const defaultDoorToDoorAddress =
    [detail.profile.street_address, detail.profile.city, detail.profile.state, detail.profile.zip]
      .map((value) => (value ?? "").trim())
      .filter(Boolean)
      .join(", ");
  const rawDietType = detail.profile.diet_type ?? "Regular";
  const dietTypeDefault = DIET_TYPE_OPTIONS.includes(rawDietType as (typeof DIET_TYPE_OPTIONS)[number]) ? rawDietType : "Other";
  const profileUpdatedAt = detail.profile.updated_at ?? null;

  return {
    monthsEnrolled: detail.monthsEnrolled,
    scheduleDays: getScheduledDayAbbreviations(detail.schedule),
    transportationSummary,
    configuredTransportTrips,
    expectedTransportSlots,
    defaultDoorToDoorAddress,
    billingPayorName,
    billingPayorStatus,
    codeStatus: detail.profile.code_status ?? detail.member.code_status ?? "-",
    memberTrack: detail.member.latest_assessment_track ?? null,
    dietTypeDefault,
    dietTypeOtherDefault: dietTypeDefault === "Other" ? (detail.profile.diet_type ?? "") : "",
    dietTextureDefault: detail.profile.diet_texture ?? "Regular",
    profileUpdatedAt,
    profileUpdatedBy: detail.profile.updated_by_name ?? null,
    scheduleUpdatedAt: detail.schedule?.updated_at ?? null,
    scheduleUpdatedBy: detail.schedule?.updated_by_name ?? null,
    contactsUpdatedAt: latestTimestamp(detail.contacts.map((row) => row.updated_at)),
    contactsUpdatedBy: latestUpdatedBy(detail.contacts, (row) => row.updated_at, (row) => row.created_by_name),
    filesUpdatedAt: latestTimestamp(detail.files.map((row) => row.updated_at)),
    filesUpdatedBy: latestUpdatedBy(detail.files, (row) => row.updated_at, (row) => row.uploaded_by_name),
    allergiesUpdatedAt: latestTimestamp(detail.mhpAllergies.map((row) => row.updated_at)),
    allergiesUpdatedBy: latestUpdatedBy(detail.mhpAllergies, (row) => row.updated_at, (row) => row.created_by_name)
  };
}

async function loadMemberCommandCenterActiveBillingSetting(detail: MemberCommandCenterDetail) {
  const billingDate = toEasternDate();
  const memberBillingSettings = await listMemberBillingSettingsSupabase(detail.member.id, { canonicalInput: true });

  return resolveActiveEffectiveMemberRowForDate(detail.member.id, billingDate, memberBillingSettings);
}

async function loadMemberCommandCenterAttendanceWorkspace(detail: MemberCommandCenterDetail) {
  const billingDate = toEasternDate();
  const [activeScheduleChangesForToday, expectedAttendanceContext] = await Promise.all([
    listScheduleChangesSupabase({
      memberId: detail.member.id,
      status: "active",
      effectiveDate: billingDate,
      limit: 25
    }),
    loadExpectedAttendanceSupabaseContext({
      memberIds: [detail.member.id],
      startDate: billingDate,
      endDate: billingDate,
      includeAttendanceRecords: false
    })
  ]);

  const effectiveScheduleToday = resolveExpectedAttendanceFromSupabaseContext({
    context: expectedAttendanceContext,
    memberId: detail.member.id,
    date: billingDate,
    baseScheduleOverride: detail.schedule,
    scheduleChangesOverride: activeScheduleChangesForToday
  });

  return {
    effectiveScheduleTodayLabel: formatScheduleWeekdayShortLabels(effectiveScheduleToday.effectiveDays),
    activeOverrideCount: activeScheduleChangesForToday.length
  };
}

async function loadMemberCommandCenterPofSection(input: {
  memberId: string;
  actorUserId: string;
  actorFullName: string;
}) {
  const [{ getPhysicianOrdersForMember }, pofReadModule, { getManagedUserSignoffLabel }] = await Promise.all([
    import("@/lib/services/physician-orders-read"),
    import("@/lib/services/pof-read"),
    import("@/lib/services/user-management")
  ]);

  const physicianOrders = await getPhysicianOrdersForMember(input.memberId, {
    canonicalInput: true
  });
  const [requests, defaultNurseName] = await Promise.all([
    pofReadModule.listPofRequestsByPhysicianOrderIds(
      input.memberId,
      physicianOrders.map((row) => row.id)
    ),
    getManagedUserSignoffLabel(input.actorUserId, input.actorFullName)
  ]);

  return {
    physicianOrders,
    requests,
    defaultNurseName,
    defaultFromEmail: pofReadModule.getConfiguredClinicalSenderEmail(),
    physicianOrdersUpdatedAt: latestTimestamp(physicianOrders.map((row) => row.updatedAt)),
    physicianOrdersUpdatedBy: latestUpdatedBy(
      physicianOrders,
      (row) => row.updatedAt,
      (row) => row.updatedByName
    )
  } satisfies MemberCommandCenterPofSectionViewModel;
}

export async function getMemberCommandCenterDetailPageData(input: {
  memberId: string;
  tab: MemberCommandCenterDetailPageTab;
  canEdit?: boolean;
  includePofWorkflow: boolean;
  actor: {
    id: string;
    fullName: string;
  };
}) {
  const detail = await getMemberCommandCenterDetailSupabase(input.memberId);
  if (!detail) return null;

  const base = buildMemberCommandCenterBaseViewModel(detail);
  const needsBillingWorkspace = input.tab === "attendance" || input.tab === "pricing";
  const needsAttendanceWorkspace = input.tab === "attendance";
  const needsTransportLookups = input.tab === "transportation" && Boolean(input.canEdit);
  const needsLockerOptions = input.tab === "locker-assignments";

  const [
    activeMemberBillingSetting,
    attendanceWorkspace,
    transportLookups,
    lockerOptions,
    pofSection
  ] = await Promise.all([
    needsBillingWorkspace ? loadMemberCommandCenterActiveBillingSetting(detail) : Promise.resolve(null),
    needsAttendanceWorkspace
      ? loadMemberCommandCenterAttendanceWorkspace(detail)
      : Promise.resolve({
          effectiveScheduleTodayLabel: "-",
          activeOverrideCount: 0
        }),
    needsTransportLookups
      ? loadTransportationLookupOptions()
      : Promise.resolve({
          busStopOptions: [],
          busNumberOptions: []
        }),
    needsLockerOptions
      ? getAvailableLockerNumbersForMemberSupabase(detail.member.id, { canonicalInput: true })
      : Promise.resolve([]),
    input.includePofWorkflow
      ? loadMemberCommandCenterPofSection({
          memberId: detail.member.id,
          actorUserId: input.actor.id,
          actorFullName: input.actor.fullName
        })
      : Promise.resolve(null)
  ]);

  return {
    detail,
    shared: base,
    attendanceBilling: needsBillingWorkspace
      ? {
          activeMemberBillingSetting,
          effectiveScheduleTodayLabel: attendanceWorkspace.effectiveScheduleTodayLabel,
          activeOverrideCount: attendanceWorkspace.activeOverrideCount
        }
      : null,
    transportationLookups: needsTransportLookups
      ? {
          busStopOptions: transportLookups.busStopOptions,
          busNumberOptions: transportLookups.busNumberOptions
        }
      : null,
    lockerOptions,
    physicianOrdersSection: pofSection
  } satisfies MemberCommandCenterDetailPageData;
}

export async function getMemberCommandCenterDetailPageReadModel(input: {
  memberId: string;
  activeTab: MemberCommandCenterDetailPageTab;
  canEdit: boolean;
  includePofSection: boolean;
  actorUserId: string;
  actorFullName: string;
}) {
  const detailPageData = await getMemberCommandCenterDetailPageData({
    memberId: input.memberId,
    tab: input.activeTab,
    canEdit: input.canEdit,
    includePofWorkflow: input.includePofSection,
    actor: {
      id: input.actorUserId,
      fullName: input.actorFullName
    }
  });
  if (!detailPageData) return null;

  return {
    detail: detailPageData.detail,
    base: detailPageData.shared,
    workspace: {
      activeMemberBillingSetting: detailPageData.attendanceBilling?.activeMemberBillingSetting ?? null,
      effectiveScheduleTodayLabel: detailPageData.attendanceBilling?.effectiveScheduleTodayLabel ?? "-",
      activeOverrideCount: detailPageData.attendanceBilling?.activeOverrideCount ?? 0,
      lockerOptions: detailPageData.lockerOptions,
      busStopOptions: detailPageData.transportationLookups?.busStopOptions ?? [],
      busNumberOptions: detailPageData.transportationLookups?.busNumberOptions ?? []
    },
    pofSection: detailPageData.physicianOrdersSection
  } satisfies MemberCommandCenterDetailPageReadModel;
}
