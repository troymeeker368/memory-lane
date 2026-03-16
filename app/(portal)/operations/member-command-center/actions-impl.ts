import "server-only";

import { Buffer } from "node:buffer";
import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { normalizePhoneForStorage } from "@/lib/phone";
import { canAccessModule, canPerformModuleAction, normalizeRoleKey } from "@/lib/permissions";
import { resolveActiveEffectiveRowForDate } from "@/lib/services/billing-supabase";
import {
  saveMemberCommandCenterAttendanceBillingWorkflow,
  saveMemberCommandCenterBundle,
  saveMemberCommandCenterTransportationWorkflow
} from "@/lib/services/member-command-center";
import {
  MEMBER_CONTACT_CATEGORY_OPTIONS,
  MEMBER_FILE_CATEGORY_OPTIONS,
  MEMBER_TRANSPORTATION_SERVICE_OPTIONS
} from "@/lib/canonical";
import {
  addMemberAllergySupabase,
  deleteMemberAllergySupabase,
  deleteMemberContactSupabase,
  ensureMemberAttendanceScheduleSupabase,
  ensureMemberCommandCenterProfileSupabase,
  getMemberSupabase,
  listBillingScheduleTemplatesSupabase,
  listMemberBillingSettingsSupabase,
  listMembersSupabase,
  updateMemberAllergySupabase,
  upsertMemberContactSupabase
} from "@/lib/services/member-command-center-supabase";
import {
  deleteCommandCenterMemberFile,
  getMemberFileDownloadUrl,
  saveCommandCenterMemberFileUpload
} from "@/lib/services/member-files";
import { getConfiguredBusNumbers } from "@/lib/services/operations-settings";
import { toEasternISO } from "@/lib/timezone";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function asNullableString(formData: FormData, key: string) {
  const value = asString(formData, key);
  return value.length > 0 ? value : null;
}

function asNullableBoolSelect(formData: FormData, key: string) {
  const value = asString(formData, key).toLowerCase();
  if (!value) return null;
  if (value === "true" || value === "yes" || value === "1") return true;
  if (value === "false" || value === "no" || value === "0") return false;
  return null;
}

function asCheckbox(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function asDateOnly(formData: FormData, key: string, fallback: string) {
  const value = asString(formData, key).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function asOptionalPositiveNumber(formData: FormData, key: string) {
  const raw = asString(formData, key);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(2));
}

function normalizePhone(value: string | null | undefined) {
  return normalizePhoneForStorage(value);
}

function normalizeLockerInput(raw: string) {
  const normalized = raw.trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed > 0) {
      return String(parsed);
    }
  }
  return normalized.toUpperCase();
}

async function asUploadedImageDataUrl(formData: FormData, key: string, fallback: string | null) {
  const file = formData.get(key);
  if (file instanceof File && file.size > 0 && file.type.startsWith("image/")) {
    const bytes = Buffer.from(await file.arrayBuffer());
    return `data:${file.type};base64,${bytes.toString("base64")}`;
  }
  return fallback;
}

async function requireCommandCenterEditor() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    throw new Error("Only Admin/Manager can edit Member Command Center records.");
  }
  return profile;
}

async function requireCommandCenterViewer() {
  const profile = await getCurrentProfile();
  if (!canAccessModule(profile.role, "operations", profile.permissions)) {
    throw new Error("You do not have access to Member Command Center files.");
  }
  return profile;
}

async function requireAttendanceBillingEditor() {
  const profile = await getCurrentProfile();
  const role = normalizeRoleKey(profile.role);
  if (
    role !== "admin" &&
    role !== "manager" &&
    role !== "coordinator" &&
    !canPerformModuleAction(role, "operations", "canEdit", profile.permissions)
  ) {
    throw new Error("Only Admin/Manager/Coordinator can edit attendance billing settings.");
  }
  return profile;
}

function revalidateCommandCenter(memberId: string) {
  revalidatePath("/operations/member-command-center");
  revalidatePath(`/operations/member-command-center/${memberId}`);
  revalidatePath("/operations/payor");
  revalidatePath("/operations/payor/billing-agreements");
  revalidatePath("/operations/payor/schedule-templates");
  revalidatePath("/operations/payor/variable-charges");
  revalidatePath("/operations/payor/revenue-dashboard");
  revalidatePath("/operations/attendance");
  revalidatePath("/operations/transportation-station");
  revalidatePath("/operations/transportation-station/print");
  revalidatePath("/operations/locker-assignments");
  revalidatePath("/health/member-health-profiles");
  revalidatePath(`/health/member-health-profiles/${memberId}`);
  revalidatePath(`/members/${memberId}`);
}

export async function saveMemberCommandCenterSummaryAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const member = await getMemberSupabase(memberId);
  if (!member) return { ok: false, error: "Member not found." };
  const lockerNumber = normalizeLockerInput(asString(formData, "lockerNumber"));
  if (lockerNumber && member.status === "active") {
    const members = await listMembersSupabase({ status: "active" });
    const conflict = members.find(
      (candidate) =>
        candidate.id !== memberId &&
        String(candidate.locker_number ?? "").trim().toLowerCase() === lockerNumber.toLowerCase()
    );
    if (conflict) {
      return { ok: false, error: `Locker ${lockerNumber} is already assigned to ${conflict.display_name}.` };
    }
  }

  const now = toEasternISO();
  const profile = await ensureMemberCommandCenterProfileSupabase(memberId);
  const defaultLocation = profile.location ?? "Fort Mill";
  await saveMemberCommandCenterBundle({
    memberId,
    mccPatch: {
      payor: asNullableString(formData, "payor"),
      original_referral_source: asNullableString(formData, "originalReferralSource"),
      photo_consent: asNullableBoolSelect(formData, "photoConsent"),
      location: defaultLocation
    },
    memberPatch: {
      locker_number: lockerNumber
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

  revalidateCommandCenter(memberId);
  return { ok: true };
}

export async function updateMemberCommandCenterPhotoAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const now = toEasternISO();
  const profile = await ensureMemberCommandCenterProfileSupabase(memberId);
  const profileImageUrl = await asUploadedImageDataUrl(formData, "photoFile", profile.profile_image_url ?? null);
  await saveMemberCommandCenterBundle({
    memberId,
    mccPatch: {
      profile_image_url: profileImageUrl
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

  revalidateCommandCenter(memberId);
  return { ok: true, profileImageUrl };
}

export async function saveMemberCommandCenterAttendanceAction(formData: FormData) {
  const actor = await requireAttendanceBillingEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const schedule = await ensureMemberAttendanceScheduleSupabase(memberId);
  if (!schedule) return { ok: false, error: "Attendance schedule not found." };
  const commandCenterProfile = await ensureMemberCommandCenterProfileSupabase(memberId);
  const now = toEasternISO();
  const enrollmentDate = asNullableString(formData, "enrollmentDate");
  const wasMonday = schedule.monday;
  const wasTuesday = schedule.tuesday;
  const wasWednesday = schedule.wednesday;
  const wasThursday = schedule.thursday;
  const wasFriday = schedule.friday;
  const monday = asCheckbox(formData, "monday");
  const tuesday = asCheckbox(formData, "tuesday");
  const wednesday = asCheckbox(formData, "wednesday");
  const thursday = asCheckbox(formData, "thursday");
  const friday = asCheckbox(formData, "friday");
  const mondayAdded = monday && !wasMonday;
  const tuesdayAdded = tuesday && !wasTuesday;
  const wednesdayAdded = wednesday && !wasWednesday;
  const thursdayAdded = thursday && !wasThursday;
  const fridayAdded = friday && !wasFriday;
  const attendanceDaysPerWeek = [monday, tuesday, wednesday, thursday, friday].filter(Boolean).length;
  const dailyRate = asOptionalPositiveNumber(formData, "dailyRate");
  if (dailyRate == null) {
    return { ok: false, error: "Daily Rate is required and must be greater than 0." };
  }
  const transportationBillingStatusRaw = asString(formData, "transportationBillingStatus");
  const transportationBillingStatus: "BillNormally" | "Waived" | "IncludedInProgramRate" =
    transportationBillingStatusRaw === "Waived" || transportationBillingStatusRaw === "IncludedInProgramRate"
      ? transportationBillingStatusRaw
      : "BillNormally";
  const payorId = asNullableString(formData, "payorId");
  const useCenterDefaultBillingMode = asCheckbox(formData, "useCenterDefaultBillingMode");
  const billingModeRaw = asString(formData, "billingMode");
  const billingMode: "Membership" | "Monthly" | "Custom" | null =
    billingModeRaw === "Monthly" || billingModeRaw === "Custom" || billingModeRaw === "Membership"
      ? billingModeRaw
      : null;
  const monthlyBillingBasisRaw = asString(formData, "monthlyBillingBasis");
  const monthlyBillingBasis: "ScheduledMonthBehind" | "ActualAttendanceMonthBehind" =
    monthlyBillingBasisRaw === "ActualAttendanceMonthBehind" ? "ActualAttendanceMonthBehind" : "ScheduledMonthBehind";
  const billExtraDays = asCheckbox(formData, "billExtraDays");
  const billAncillaryArrears = asCheckbox(formData, "billAncillaryArrears");
  const rateEffectiveDate = asDateOnly(formData, "billingRateEffectiveDate", now.slice(0, 10));
  const billingNotes = asNullableString(formData, "billingNotes");
  const currentMakeupBalance = schedule.make_up_days_available ?? 0;
  const requestedMakeupBalanceRaw = asString(formData, "makeUpDaysAvailable");
  let resolvedMakeupBalance = currentMakeupBalance;
  if (requestedMakeupBalanceRaw.length > 0) {
    const parsed = Number(requestedMakeupBalanceRaw);
    if (Number.isFinite(parsed)) {
      resolvedMakeupBalance = Math.max(0, Math.trunc(parsed));
    }
  }

  const defaultDoorToDoorAddress =
    [
      commandCenterProfile.street_address,
      commandCenterProfile.city,
      commandCenterProfile.state,
      commandCenterProfile.zip
    ]
      .map((value) => (value ?? "").trim())
      .filter(Boolean)
      .join(", ") || null;

  const existingSlots = [
    {
      mode: schedule.transport_monday_am_mode,
      busNumber: schedule.transport_monday_am_bus_number,
      busStop: schedule.transport_monday_am_bus_stop,
      doorToDoorAddress: schedule.transport_monday_am_door_to_door_address
    },
    {
      mode: schedule.transport_monday_pm_mode,
      busNumber: schedule.transport_monday_pm_bus_number,
      busStop: schedule.transport_monday_pm_bus_stop,
      doorToDoorAddress: schedule.transport_monday_pm_door_to_door_address
    },
    {
      mode: schedule.transport_tuesday_am_mode,
      busNumber: schedule.transport_tuesday_am_bus_number,
      busStop: schedule.transport_tuesday_am_bus_stop,
      doorToDoorAddress: schedule.transport_tuesday_am_door_to_door_address
    },
    {
      mode: schedule.transport_tuesday_pm_mode,
      busNumber: schedule.transport_tuesday_pm_bus_number,
      busStop: schedule.transport_tuesday_pm_bus_stop,
      doorToDoorAddress: schedule.transport_tuesday_pm_door_to_door_address
    },
    {
      mode: schedule.transport_wednesday_am_mode,
      busNumber: schedule.transport_wednesday_am_bus_number,
      busStop: schedule.transport_wednesday_am_bus_stop,
      doorToDoorAddress: schedule.transport_wednesday_am_door_to_door_address
    },
    {
      mode: schedule.transport_wednesday_pm_mode,
      busNumber: schedule.transport_wednesday_pm_bus_number,
      busStop: schedule.transport_wednesday_pm_bus_stop,
      doorToDoorAddress: schedule.transport_wednesday_pm_door_to_door_address
    },
    {
      mode: schedule.transport_thursday_am_mode,
      busNumber: schedule.transport_thursday_am_bus_number,
      busStop: schedule.transport_thursday_am_bus_stop,
      doorToDoorAddress: schedule.transport_thursday_am_door_to_door_address
    },
    {
      mode: schedule.transport_thursday_pm_mode,
      busNumber: schedule.transport_thursday_pm_bus_number,
      busStop: schedule.transport_thursday_pm_bus_stop,
      doorToDoorAddress: schedule.transport_thursday_pm_door_to_door_address
    },
    {
      mode: schedule.transport_friday_am_mode,
      busNumber: schedule.transport_friday_am_bus_number,
      busStop: schedule.transport_friday_am_bus_stop,
      doorToDoorAddress: schedule.transport_friday_am_door_to_door_address
    },
    {
      mode: schedule.transport_friday_pm_mode,
      busNumber: schedule.transport_friday_pm_bus_number,
      busStop: schedule.transport_friday_pm_bus_stop,
      doorToDoorAddress: schedule.transport_friday_pm_door_to_door_address
    }
  ];
  const defaultMode =
    schedule.transportation_mode ??
    existingSlots.find((slot) => slot.mode)?.mode ??
    null;
  const defaultBusNumber =
    schedule.transport_bus_number ??
    existingSlots.find((slot) => slot.busNumber)?.busNumber ??
    null;
  const defaultBusStop =
    schedule.transportation_bus_stop ??
    existingSlots.find((slot) => slot.busStop)?.busStop ??
    null;
  const fallbackDoorToDoorAddress =
    existingSlots.find((slot) => slot.doorToDoorAddress)?.doorToDoorAddress ??
    defaultDoorToDoorAddress;

    const resolveSlot = (
      dayEnabled: boolean,
      dayWasAdded: boolean,
      current: {
        mode: "Door to Door" | "Bus Stop" | null;
        doorToDoorAddress: string | null;
        busNumber: string | null;
        busStop: string | null;
      }
    ) => {
    if (!dayEnabled) {
      return { mode: null, doorToDoorAddress: null, busNumber: null, busStop: null } as const;
    }

    if (!dayWasAdded || schedule.transportation_required !== true) {
      return current;
    }

    const seededMode = current.mode ?? defaultMode;
    const seededBusNumber = seededMode ? (current.busNumber ?? defaultBusNumber) : null;
    const seededDoorToDoorAddress =
      seededMode === "Door to Door"
        ? (current.doorToDoorAddress ?? fallbackDoorToDoorAddress ?? null)
        : null;
    const seededBusStop =
      seededMode === "Bus Stop"
        ? (current.busStop ?? defaultBusStop ?? null)
        : null;

    return {
      mode: seededMode,
      doorToDoorAddress: seededDoorToDoorAddress,
      busNumber: seededBusNumber,
      busStop: seededBusStop
    } as const;
  };

  const mondayAm = resolveSlot(monday, mondayAdded, {
    mode: schedule.transport_monday_am_mode,
    doorToDoorAddress: schedule.transport_monday_am_door_to_door_address,
    busNumber: schedule.transport_monday_am_bus_number,
    busStop: schedule.transport_monday_am_bus_stop
  });
  const mondayPm = resolveSlot(monday, mondayAdded, {
    mode: schedule.transport_monday_pm_mode,
    doorToDoorAddress: schedule.transport_monday_pm_door_to_door_address,
    busNumber: schedule.transport_monday_pm_bus_number,
    busStop: schedule.transport_monday_pm_bus_stop
  });
  const tuesdayAm = resolveSlot(tuesday, tuesdayAdded, {
    mode: schedule.transport_tuesday_am_mode,
    doorToDoorAddress: schedule.transport_tuesday_am_door_to_door_address,
    busNumber: schedule.transport_tuesday_am_bus_number,
    busStop: schedule.transport_tuesday_am_bus_stop
  });
  const tuesdayPm = resolveSlot(tuesday, tuesdayAdded, {
    mode: schedule.transport_tuesday_pm_mode,
    doorToDoorAddress: schedule.transport_tuesday_pm_door_to_door_address,
    busNumber: schedule.transport_tuesday_pm_bus_number,
    busStop: schedule.transport_tuesday_pm_bus_stop
  });
  const wednesdayAm = resolveSlot(wednesday, wednesdayAdded, {
    mode: schedule.transport_wednesday_am_mode,
    doorToDoorAddress: schedule.transport_wednesday_am_door_to_door_address,
    busNumber: schedule.transport_wednesday_am_bus_number,
    busStop: schedule.transport_wednesday_am_bus_stop
  });
  const wednesdayPm = resolveSlot(wednesday, wednesdayAdded, {
    mode: schedule.transport_wednesday_pm_mode,
    doorToDoorAddress: schedule.transport_wednesday_pm_door_to_door_address,
    busNumber: schedule.transport_wednesday_pm_bus_number,
    busStop: schedule.transport_wednesday_pm_bus_stop
  });
  const thursdayAm = resolveSlot(thursday, thursdayAdded, {
    mode: schedule.transport_thursday_am_mode,
    doorToDoorAddress: schedule.transport_thursday_am_door_to_door_address,
    busNumber: schedule.transport_thursday_am_bus_number,
    busStop: schedule.transport_thursday_am_bus_stop
  });
  const thursdayPm = resolveSlot(thursday, thursdayAdded, {
    mode: schedule.transport_thursday_pm_mode,
    doorToDoorAddress: schedule.transport_thursday_pm_door_to_door_address,
    busNumber: schedule.transport_thursday_pm_bus_number,
    busStop: schedule.transport_thursday_pm_bus_stop
  });
  const fridayAm = resolveSlot(friday, fridayAdded, {
    mode: schedule.transport_friday_am_mode,
    doorToDoorAddress: schedule.transport_friday_am_door_to_door_address,
    busNumber: schedule.transport_friday_am_bus_number,
    busStop: schedule.transport_friday_am_bus_stop
  });
  const fridayPm = resolveSlot(friday, fridayAdded, {
    mode: schedule.transport_friday_pm_mode,
    doorToDoorAddress: schedule.transport_friday_pm_door_to_door_address,
    busNumber: schedule.transport_friday_pm_bus_number,
    busStop: schedule.transport_friday_pm_bus_stop
  });

  const derivePeriod = (
    dayEnabled: boolean,
    amMode: "Door to Door" | "Bus Stop" | null,
    pmMode: "Door to Door" | "Bus Stop" | null
  ) => {
    if (!dayEnabled) return null;
    if (amMode) return "AM";
    if (pmMode) return "PM";
    return null;
  };

  const schedulePatch = {
    enrollment_date: enrollmentDate,
    monday,
    tuesday,
    wednesday,
    thursday,
    friday,
    // Current operations are full-day only; half-day toggle is intentionally disabled.
    full_day: true,
    transport_monday_period: derivePeriod(monday, mondayAm.mode, mondayPm.mode),
    transport_tuesday_period: derivePeriod(tuesday, tuesdayAm.mode, tuesdayPm.mode),
    transport_wednesday_period: derivePeriod(wednesday, wednesdayAm.mode, wednesdayPm.mode),
    transport_thursday_period: derivePeriod(thursday, thursdayAm.mode, thursdayPm.mode),
    transport_friday_period: derivePeriod(friday, fridayAm.mode, fridayPm.mode),
    transport_monday_am_mode: mondayAm.mode,
    transport_monday_am_door_to_door_address: mondayAm.doorToDoorAddress,
    transport_monday_am_bus_number: mondayAm.busNumber,
    transport_monday_am_bus_stop: mondayAm.busStop,
    transport_monday_pm_mode: mondayPm.mode,
    transport_monday_pm_door_to_door_address: mondayPm.doorToDoorAddress,
    transport_monday_pm_bus_number: mondayPm.busNumber,
    transport_monday_pm_bus_stop: mondayPm.busStop,
    transport_tuesday_am_mode: tuesdayAm.mode,
    transport_tuesday_am_door_to_door_address: tuesdayAm.doorToDoorAddress,
    transport_tuesday_am_bus_number: tuesdayAm.busNumber,
    transport_tuesday_am_bus_stop: tuesdayAm.busStop,
    transport_tuesday_pm_mode: tuesdayPm.mode,
    transport_tuesday_pm_door_to_door_address: tuesdayPm.doorToDoorAddress,
    transport_tuesday_pm_bus_number: tuesdayPm.busNumber,
    transport_tuesday_pm_bus_stop: tuesdayPm.busStop,
    transport_wednesday_am_mode: wednesdayAm.mode,
    transport_wednesday_am_door_to_door_address: wednesdayAm.doorToDoorAddress,
    transport_wednesday_am_bus_number: wednesdayAm.busNumber,
    transport_wednesday_am_bus_stop: wednesdayAm.busStop,
    transport_wednesday_pm_mode: wednesdayPm.mode,
    transport_wednesday_pm_door_to_door_address: wednesdayPm.doorToDoorAddress,
    transport_wednesday_pm_bus_number: wednesdayPm.busNumber,
    transport_wednesday_pm_bus_stop: wednesdayPm.busStop,
    transport_thursday_am_mode: thursdayAm.mode,
    transport_thursday_am_door_to_door_address: thursdayAm.doorToDoorAddress,
    transport_thursday_am_bus_number: thursdayAm.busNumber,
    transport_thursday_am_bus_stop: thursdayAm.busStop,
    transport_thursday_pm_mode: thursdayPm.mode,
    transport_thursday_pm_door_to_door_address: thursdayPm.doorToDoorAddress,
    transport_thursday_pm_bus_number: thursdayPm.busNumber,
    transport_thursday_pm_bus_stop: thursdayPm.busStop,
    transport_friday_am_mode: fridayAm.mode,
    transport_friday_am_door_to_door_address: fridayAm.doorToDoorAddress,
    transport_friday_am_bus_number: fridayAm.busNumber,
    transport_friday_am_bus_stop: fridayAm.busStop,
    transport_friday_pm_mode: fridayPm.mode,
    transport_friday_pm_door_to_door_address: fridayPm.doorToDoorAddress,
    transport_friday_pm_bus_number: fridayPm.busNumber,
    transport_friday_pm_bus_stop: fridayPm.busStop,
    daily_rate: dailyRate,
    transportation_billing_status: transportationBillingStatus,
    billing_rate_effective_date: rateEffectiveDate,
    billing_notes: billingNotes,
    attendance_days_per_week: attendanceDaysPerWeek,
    default_daily_rate: dailyRate,
    use_custom_daily_rate: false,
    custom_daily_rate: null,
    make_up_days_available: resolvedMakeupBalance,
    attendance_notes: asNullableString(formData, "attendanceNotes")
  };

  const activeMemberBillingSettings = (await listMemberBillingSettingsSupabase(memberId))
    .filter((row) => row.member_id === memberId)
    .filter((row) => row.active)
    .sort((left, right) => (left.effective_start_date < right.effective_start_date ? 1 : -1));
  const existingBillingSetting =
    resolveActiveEffectiveRowForDate(rateEffectiveDate, activeMemberBillingSettings) ??
    activeMemberBillingSettings[0] ??
    null;

  const fallbackPayorId =
    activeMemberBillingSettings
      .filter((row) => row.member_id === memberId)
      .map((row) => row.payor_id)
      .find((row): row is string => Boolean(row)) ?? null;

  const activeScheduleTemplates = (await listBillingScheduleTemplatesSupabase(memberId))
    .filter((row) => row.member_id === memberId)
    .filter((row) => row.active)
    .sort((left, right) => (left.effective_start_date < right.effective_start_date ? 1 : -1));
  const existingScheduleTemplate =
    resolveActiveEffectiveRowForDate(rateEffectiveDate, activeScheduleTemplates) ??
    activeScheduleTemplates[0] ??
    null;

  await saveMemberCommandCenterAttendanceBillingWorkflow({
    memberId,
    schedulePatch,
    memberPatch: {
      enrollment_date: enrollmentDate ?? null
    },
    billingPayload: existingBillingSetting
      ? {
          id: existingBillingSetting.id,
          payor_id: payorId ?? existingBillingSetting.payor_id,
          use_center_default_billing_mode: useCenterDefaultBillingMode,
          billing_mode: useCenterDefaultBillingMode ? null : billingMode ?? existingBillingSetting.billing_mode ?? "Membership",
          monthly_billing_basis: monthlyBillingBasis,
          use_center_default_rate: false,
          custom_daily_rate: dailyRate,
          flat_monthly_rate: existingBillingSetting.flat_monthly_rate,
          bill_extra_days: billExtraDays,
          transportation_billing_status: transportationBillingStatus,
          bill_ancillary_arrears: billAncillaryArrears,
          active: existingBillingSetting.active,
          effective_start_date: existingBillingSetting.effective_start_date,
          effective_end_date: existingBillingSetting.effective_end_date,
          billing_notes: billingNotes ?? existingBillingSetting.billing_notes
        }
      : {
          payor_id: payorId ?? fallbackPayorId,
          use_center_default_billing_mode: useCenterDefaultBillingMode,
          billing_mode: useCenterDefaultBillingMode ? null : billingMode ?? "Membership",
          monthly_billing_basis: monthlyBillingBasis,
          use_center_default_rate: false,
          custom_daily_rate: dailyRate,
          flat_monthly_rate: null,
          bill_extra_days: billExtraDays,
          transportation_billing_status: transportationBillingStatus,
          bill_ancillary_arrears: billAncillaryArrears,
          active: true,
          effective_start_date: rateEffectiveDate,
          effective_end_date: null,
          billing_notes: billingNotes ?? `MCC attendance billing daily rate synced ($${dailyRate.toFixed(2)}).`
        },
    templatePayload: existingScheduleTemplate
      ? {
          id: existingScheduleTemplate.id,
          effective_start_date: existingScheduleTemplate.effective_start_date,
          effective_end_date: existingScheduleTemplate.effective_end_date,
          monday,
          tuesday,
          wednesday,
          thursday,
          friday,
          saturday: false,
          sunday: false,
          active: existingScheduleTemplate.active,
          notes: existingScheduleTemplate.notes ?? "Auto-synced from MCC attendance pattern."
        }
      : {
          effective_start_date: enrollmentDate ?? rateEffectiveDate,
          effective_end_date: null,
          monday,
          tuesday,
          wednesday,
          thursday,
          friday,
          saturday: false,
          sunday: false,
          active: true,
          notes: "Auto-created from MCC attendance pattern."
        },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

  revalidateCommandCenter(memberId);
  return { ok: true };
}

export async function saveMemberCommandCenterTransportationAction(formData: FormData) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = asString(formData, "memberId");
    if (!memberId) return { ok: false, error: "Member is required." };

    const schedule = await ensureMemberAttendanceScheduleSupabase(memberId);
    if (!schedule) return { ok: false, error: "Attendance schedule not found." };
    const commandCenterProfile = await ensureMemberCommandCenterProfileSupabase(memberId);
    const now = toEasternISO();
    const defaultDoorToDoorAddress =
      [
        commandCenterProfile.street_address,
        commandCenterProfile.city,
        commandCenterProfile.state,
        commandCenterProfile.zip
      ]
        .map((value) => (value ?? "").trim())
        .filter(Boolean)
        .join(", ") || null;

    const transportationRequired = asNullableBoolSelect(formData, "transportationRequired");
    const configuredBusNumbers = await getConfiguredBusNumbers();
    const normalizeMode = (raw: string) =>
      MEMBER_TRANSPORTATION_SERVICE_OPTIONS.includes(raw as (typeof MEMBER_TRANSPORTATION_SERVICE_OPTIONS)[number])
        ? (raw as "Door to Door" | "Bus Stop")
        : null;
    const normalizeBusNumber = (raw: string) => {
      const normalized = raw.trim();
      return configuredBusNumbers.includes(normalized) ? normalized : null;
    };
    const parseSlot = (dayEnabled: boolean, slotPrefix: string) => {
      if (transportationRequired !== true || !dayEnabled) {
        return { mode: null, doorToDoorAddress: null, busNumber: null, busStop: null } as const;
      }
      const mode = normalizeMode(asString(formData, `${slotPrefix}Mode`));
      const doorToDoorAddress =
        mode === "Door to Door"
          ? asNullableString(formData, `${slotPrefix}DoorToDoorAddress`) ?? defaultDoorToDoorAddress
          : null;
      const busNumber = mode ? normalizeBusNumber(asString(formData, `${slotPrefix}BusNumber`)) : null;
      const busStop = mode === "Bus Stop" ? asNullableString(formData, `${slotPrefix}BusStop`) : null;
      return { mode, doorToDoorAddress, busNumber, busStop } as const;
    };

    const mondayAm = parseSlot(schedule.monday, "transportMondayAm");
    const mondayPm = parseSlot(schedule.monday, "transportMondayPm");
    const tuesdayAm = parseSlot(schedule.tuesday, "transportTuesdayAm");
    const tuesdayPm = parseSlot(schedule.tuesday, "transportTuesdayPm");
    const wednesdayAm = parseSlot(schedule.wednesday, "transportWednesdayAm");
    const wednesdayPm = parseSlot(schedule.wednesday, "transportWednesdayPm");
    const thursdayAm = parseSlot(schedule.thursday, "transportThursdayAm");
    const thursdayPm = parseSlot(schedule.thursday, "transportThursdayPm");
    const fridayAm = parseSlot(schedule.friday, "transportFridayAm");
    const fridayPm = parseSlot(schedule.friday, "transportFridayPm");
    const configuredSlotCount = [
      mondayAm.mode,
      mondayPm.mode,
      tuesdayAm.mode,
      tuesdayPm.mode,
      wednesdayAm.mode,
      wednesdayPm.mode,
      thursdayAm.mode,
      thursdayPm.mode,
      fridayAm.mode,
      fridayPm.mode
    ].filter(Boolean).length;

    if (transportationRequired === true && configuredSlotCount === 0) {
      return { ok: false, error: "Choose Door to Door or Bus Stop for at least one AM/PM slot (or set Transportation to No)." };
    }
    if (transportationRequired === true) {
      const allSlots = [
        mondayAm,
        mondayPm,
        tuesdayAm,
        tuesdayPm,
        wednesdayAm,
        wednesdayPm,
        thursdayAm,
        thursdayPm,
        fridayAm,
        fridayPm
      ];
      const missingDoorToDoorAddress = allSlots.some((slot) => slot.mode === "Door to Door" && !slot.doorToDoorAddress);
      if (missingDoorToDoorAddress) {
        return { ok: false, error: "Door to Door trips require an address (defaults to demographics address when available)." };
      }
      const missingBusAssignment = allSlots.some((slot) => slot.mode && !slot.busNumber);
      if (missingBusAssignment) {
        return { ok: false, error: "Every transport trip (Bus Stop and Door to Door) requires a bus assignment." };
      }
    }

    const firstMode =
      mondayAm.mode ??
      mondayPm.mode ??
      tuesdayAm.mode ??
      tuesdayPm.mode ??
      wednesdayAm.mode ??
      wednesdayPm.mode ??
      thursdayAm.mode ??
      thursdayPm.mode ??
      fridayAm.mode ??
      fridayPm.mode;
    const firstBusNumber =
      mondayAm.busNumber ??
      mondayPm.busNumber ??
      tuesdayAm.busNumber ??
      tuesdayPm.busNumber ??
      wednesdayAm.busNumber ??
      wednesdayPm.busNumber ??
      thursdayAm.busNumber ??
      thursdayPm.busNumber ??
      fridayAm.busNumber ??
      fridayPm.busNumber;
    const firstBusStop =
      mondayAm.busStop ??
      mondayPm.busStop ??
      tuesdayAm.busStop ??
      tuesdayPm.busStop ??
      wednesdayAm.busStop ??
      wednesdayPm.busStop ??
      thursdayAm.busStop ??
      thursdayPm.busStop ??
      fridayAm.busStop ??
      fridayPm.busStop;

    const schedulePatch = {
      transportation_required: transportationRequired,
      transportation_mode: transportationRequired === true ? firstMode : null,
      transport_bus_number: transportationRequired === true ? firstBusNumber : null,
      transportation_bus_stop: transportationRequired === true && firstMode === "Bus Stop" ? firstBusStop : null,
      transport_monday_period: schedule.monday ? (mondayAm.mode ? "AM" : mondayPm.mode ? "PM" : null) : null,
      transport_tuesday_period: schedule.tuesday ? (tuesdayAm.mode ? "AM" : tuesdayPm.mode ? "PM" : null) : null,
      transport_wednesday_period: schedule.wednesday ? (wednesdayAm.mode ? "AM" : wednesdayPm.mode ? "PM" : null) : null,
      transport_thursday_period: schedule.thursday ? (thursdayAm.mode ? "AM" : thursdayPm.mode ? "PM" : null) : null,
      transport_friday_period: schedule.friday ? (fridayAm.mode ? "AM" : fridayPm.mode ? "PM" : null) : null,
      transport_monday_am_mode: schedule.monday ? mondayAm.mode : null,
      transport_monday_am_door_to_door_address: schedule.monday ? mondayAm.doorToDoorAddress : null,
      transport_monday_am_bus_number: schedule.monday ? mondayAm.busNumber : null,
      transport_monday_am_bus_stop: schedule.monday ? mondayAm.busStop : null,
      transport_monday_pm_mode: schedule.monday ? mondayPm.mode : null,
      transport_monday_pm_door_to_door_address: schedule.monday ? mondayPm.doorToDoorAddress : null,
      transport_monday_pm_bus_number: schedule.monday ? mondayPm.busNumber : null,
      transport_monday_pm_bus_stop: schedule.monday ? mondayPm.busStop : null,
      transport_tuesday_am_mode: schedule.tuesday ? tuesdayAm.mode : null,
      transport_tuesday_am_door_to_door_address: schedule.tuesday ? tuesdayAm.doorToDoorAddress : null,
      transport_tuesday_am_bus_number: schedule.tuesday ? tuesdayAm.busNumber : null,
      transport_tuesday_am_bus_stop: schedule.tuesday ? tuesdayAm.busStop : null,
      transport_tuesday_pm_mode: schedule.tuesday ? tuesdayPm.mode : null,
      transport_tuesday_pm_door_to_door_address: schedule.tuesday ? tuesdayPm.doorToDoorAddress : null,
      transport_tuesday_pm_bus_number: schedule.tuesday ? tuesdayPm.busNumber : null,
      transport_tuesday_pm_bus_stop: schedule.tuesday ? tuesdayPm.busStop : null,
      transport_wednesday_am_mode: schedule.wednesday ? wednesdayAm.mode : null,
      transport_wednesday_am_door_to_door_address: schedule.wednesday ? wednesdayAm.doorToDoorAddress : null,
      transport_wednesday_am_bus_number: schedule.wednesday ? wednesdayAm.busNumber : null,
      transport_wednesday_am_bus_stop: schedule.wednesday ? wednesdayAm.busStop : null,
      transport_wednesday_pm_mode: schedule.wednesday ? wednesdayPm.mode : null,
      transport_wednesday_pm_door_to_door_address: schedule.wednesday ? wednesdayPm.doorToDoorAddress : null,
      transport_wednesday_pm_bus_number: schedule.wednesday ? wednesdayPm.busNumber : null,
      transport_wednesday_pm_bus_stop: schedule.wednesday ? wednesdayPm.busStop : null,
      transport_thursday_am_mode: schedule.thursday ? thursdayAm.mode : null,
      transport_thursday_am_door_to_door_address: schedule.thursday ? thursdayAm.doorToDoorAddress : null,
      transport_thursday_am_bus_number: schedule.thursday ? thursdayAm.busNumber : null,
      transport_thursday_am_bus_stop: schedule.thursday ? thursdayAm.busStop : null,
      transport_thursday_pm_mode: schedule.thursday ? thursdayPm.mode : null,
      transport_thursday_pm_door_to_door_address: schedule.thursday ? thursdayPm.doorToDoorAddress : null,
      transport_thursday_pm_bus_number: schedule.thursday ? thursdayPm.busNumber : null,
      transport_thursday_pm_bus_stop: schedule.thursday ? thursdayPm.busStop : null,
      transport_friday_am_mode: schedule.friday ? fridayAm.mode : null,
      transport_friday_am_door_to_door_address: schedule.friday ? fridayAm.doorToDoorAddress : null,
      transport_friday_am_bus_number: schedule.friday ? fridayAm.busNumber : null,
      transport_friday_am_bus_stop: schedule.friday ? fridayAm.busStop : null,
      transport_friday_pm_mode: schedule.friday ? fridayPm.mode : null,
      transport_friday_pm_door_to_door_address: schedule.friday ? fridayPm.doorToDoorAddress : null,
      transport_friday_pm_bus_number: schedule.friday ? fridayPm.busNumber : null,
      transport_friday_pm_bus_stop: schedule.friday ? fridayPm.busStop : null
    };

    await saveMemberCommandCenterTransportationWorkflow({
      memberId,
      schedulePatch,
      busStopNames: [
        mondayAm.busStop,
        mondayPm.busStop,
        tuesdayAm.busStop,
        tuesdayPm.busStop,
        wednesdayAm.busStop,
        wednesdayPm.busStop,
        thursdayAm.busStop,
        thursdayPm.busStop,
        fridayAm.busStop,
        fridayPm.busStop
      ].filter((value): value is string => Boolean(value)),
      actor: {
        id: actor.id,
        fullName: actor.full_name
      },
      now
    });

    revalidateCommandCenter(memberId);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save transportation updates.";
    console.error("[MCC] saveMemberCommandCenterTransportationAction failed", {
      message,
      memberId: asString(formData, "memberId")
    });
    return { ok: false, error: message };
  }
}

export async function saveMemberCommandCenterDemographicsAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const now = toEasternISO();
  const city = asNullableString(formData, "city");
  const isVeteran = asNullableBoolSelect(formData, "isVeteran");
  const veteranBranch = isVeteran ? asNullableString(formData, "veteranBranch") : null;
  const rawGender = asString(formData, "gender");
  const gender = rawGender === "M" || rawGender === "F" ? rawGender : null;
  const memberDisplayName = asString(formData, "memberDisplayName");
  const memberDob = asNullableString(formData, "memberDob");

  const memberPatch: Record<string, string | null> = { city };
  if (memberDisplayName.length > 0) {
    memberPatch.display_name = memberDisplayName;
  }
  await saveMemberCommandCenterBundle({
    memberId,
    mccPatch: {
      gender,
      street_address: asNullableString(formData, "streetAddress"),
      city,
      state: asNullableString(formData, "state"),
      zip: asNullableString(formData, "zip"),
      marital_status: asNullableString(formData, "maritalStatus"),
      primary_language: asNullableString(formData, "primaryLanguage") ?? "English",
      secondary_language: asNullableString(formData, "secondaryLanguage"),
      religion: asNullableString(formData, "religion"),
      ethnicity: asNullableString(formData, "ethnicity"),
      is_veteran: isVeteran,
      veteran_branch: veteranBranch
    },
    memberPatch: {
      ...memberPatch,
      dob: memberDob ?? null
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

  revalidateCommandCenter(memberId);
  return { ok: true };
}

export async function saveMemberCommandCenterLegalAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const now = toEasternISO();
  const codeStatusInput = asNullableString(formData, "codeStatus");
  const dnrInput = asNullableBoolSelect(formData, "dnr");
  const codeStatus =
    codeStatusInput ?? (dnrInput === true ? "DNR" : dnrInput === false ? "Full Code" : null);
  const dnr = codeStatus === "DNR" ? true : codeStatus === "Full Code" ? false : dnrInput;

  await saveMemberCommandCenterBundle({
    memberId,
    mccPatch: {
      code_status: codeStatus,
      dnr,
      dni: asNullableBoolSelect(formData, "dni"),
      polst_molst_colst: asNullableString(formData, "polstMolstColst"),
      hospice: asNullableBoolSelect(formData, "hospice"),
      advanced_directives_obtained: asNullableBoolSelect(formData, "advancedDirectivesObtained"),
      power_of_attorney: asNullableString(formData, "powerOfAttorney"),
      legal_comments: asNullableString(formData, "legalComments")
    },
    memberPatch: { code_status: codeStatus },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

  revalidateCommandCenter(memberId);
  return { ok: true };
}

export async function saveMemberCommandCenterDietAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const now = toEasternISO();
  const dietType = asString(formData, "dietType");
  const dietTypeOther = asNullableString(formData, "dietTypeOther");
  const normalizedDietType = dietType === "Other" ? (dietTypeOther ?? "Other") : dietType || "Regular";

  await saveMemberCommandCenterBundle({
    memberId,
    mccPatch: {
      diet_type: normalizedDietType,
      dietary_preferences_restrictions: asNullableString(formData, "dietaryPreferencesRestrictions"),
      swallowing_difficulty: asNullableString(formData, "swallowingDifficulty"),
      supplements: asNullableString(formData, "supplements"),
      food_dislikes: asNullableString(formData, "foodDislikes"),
      foods_to_omit: asNullableString(formData, "foodsToOmit"),
      diet_texture: asNullableString(formData, "dietTexture") ?? "Regular",
      command_center_notes: asNullableString(formData, "commandCenterNotes")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  revalidateCommandCenter(memberId);
  return { ok: true };
}

export async function addMemberCommandCenterAllergyInlineAction(formData: FormData) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = asString(formData, "memberId");
    if (!memberId) return { ok: false, error: "Member is required." };

    const allergyGroupRaw = asString(formData, "allergyGroup");
    const allergyGroup =
      allergyGroupRaw === "food" || allergyGroupRaw === "medication" || allergyGroupRaw === "environmental"
        ? allergyGroupRaw
        : null;
    const allergyName = asString(formData, "allergyName");
    if (!allergyGroup || !allergyName) return { ok: false, error: "Allergy group and name are required." };

    const now = toEasternISO();
    const created = await addMemberAllergySupabase({
      member_id: memberId,
      allergy_group: allergyGroup,
      allergy_name: allergyName,
      severity: asNullableString(formData, "allergySeverity"),
      comments: asNullableString(formData, "allergyComments"),
      created_by_user_id: actor.id,
      created_by_name: actor.full_name,
      created_at: now,
      updated_at: now
    });

    revalidateCommandCenter(memberId);
    return { ok: true, row: created };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to add allergy." };
  }
}

export async function updateMemberCommandCenterAllergyInlineAction(formData: FormData) {
  try {
    await requireCommandCenterEditor();
    const memberId = asString(formData, "memberId");
    const allergyId = asString(formData, "allergyId");
    if (!memberId || !allergyId) return { ok: false, error: "Missing allergy reference." };

    const allergyGroupRaw = asString(formData, "allergyGroup");
    const allergyGroup =
      allergyGroupRaw === "food" || allergyGroupRaw === "medication" || allergyGroupRaw === "environmental"
        ? allergyGroupRaw
        : null;
    const allergyName = asString(formData, "allergyName");
    if (!allergyGroup || !allergyName) return { ok: false, error: "Allergy group and name are required." };

    const now = toEasternISO();
    const updated = await updateMemberAllergySupabase(allergyId, {
      allergy_group: allergyGroup,
      allergy_name: allergyName,
      severity: asNullableString(formData, "allergySeverity"),
      comments: asNullableString(formData, "allergyComments"),
      updated_at: now
    });
    if (!updated) return { ok: false, error: "Allergy not found." };

    revalidateCommandCenter(memberId);
    return { ok: true, row: updated };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to update allergy." };
  }
}

export async function deleteMemberCommandCenterAllergyInlineAction(formData: FormData) {
  try {
    await requireCommandCenterEditor();
    const memberId = asString(formData, "memberId");
    const allergyId = asString(formData, "allergyId");
    if (!memberId || !allergyId) return { ok: false, error: "Missing allergy reference." };

    await deleteMemberAllergySupabase(allergyId);

    revalidateCommandCenter(memberId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to delete allergy." };
  }
}

export async function upsertMemberContactAction(raw: {
  id?: string;
  memberId: string;
  contactName: string;
  relationshipToMember?: string;
  category: string;
  categoryOther?: string;
  email?: string;
  cellularNumber?: string;
  workNumber?: string;
  homeNumber?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
}) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = raw.memberId?.trim();
    const contactName = raw.contactName?.trim();
    const category = raw.category?.trim();

    if (!memberId || !contactName || !category) {
      return { error: "Member, contact name, and category are required." };
    }

    const normalizedCategory = MEMBER_CONTACT_CATEGORY_OPTIONS.includes(category as (typeof MEMBER_CONTACT_CATEGORY_OPTIONS)[number])
      ? category
      : "Other";
    const categoryOther = raw.categoryOther?.trim() || null;
    if (normalizedCategory === "Other" && !categoryOther) {
      return { error: "Custom category is required when category is Other." };
    }

    const now = toEasternISO();

    if (raw.id?.trim()) {
      const updated = await upsertMemberContactSupabase({
        id: raw.id.trim(),
        member_id: memberId,
        contact_name: contactName,
        relationship_to_member: raw.relationshipToMember?.trim() || null,
        category: normalizedCategory,
        category_other: normalizedCategory === "Other" ? categoryOther : null,
        email: raw.email?.trim() || null,
        cellular_number: normalizePhone(raw.cellularNumber),
        work_number: normalizePhone(raw.workNumber),
        home_number: normalizePhone(raw.homeNumber),
        street_address: raw.streetAddress?.trim() || null,
        city: raw.city?.trim() || null,
        state: raw.state?.trim() || null,
        zip: raw.zip?.trim() || null,
        created_by_user_id: actor.id,
        created_by_name: actor.full_name,
        created_at: now,
        updated_at: now
      });
      if (!updated) return { error: "Contact not found." };
      revalidateCommandCenter(memberId);
      return { ok: true, row: updated };
    } else {
      const created = await upsertMemberContactSupabase({
        member_id: memberId,
        contact_name: contactName,
        relationship_to_member: raw.relationshipToMember?.trim() || null,
        category: normalizedCategory,
        category_other: normalizedCategory === "Other" ? categoryOther : null,
        email: raw.email?.trim() || null,
        cellular_number: normalizePhone(raw.cellularNumber),
        work_number: normalizePhone(raw.workNumber),
        home_number: normalizePhone(raw.homeNumber),
        street_address: raw.streetAddress?.trim() || null,
        city: raw.city?.trim() || null,
        state: raw.state?.trim() || null,
        zip: raw.zip?.trim() || null,
        created_by_user_id: actor.id,
        created_by_name: actor.full_name,
        created_at: now,
        updated_at: now
      });
      revalidateCommandCenter(memberId);
      return { ok: true, row: created };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save contact." };
  }
}

export async function deleteMemberContactAction(raw: { id: string; memberId: string }) {
  try {
    await requireCommandCenterEditor();
    const id = raw.id?.trim();
    const memberId = raw.memberId?.trim();
    if (!id || !memberId) return { error: "Invalid contact delete request." };

    await deleteMemberContactSupabase(id);

    revalidateCommandCenter(memberId);
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to delete contact." };
  }
}

export async function addMemberFileAction(raw: {
  memberId: string;
  fileName: string;
  fileType?: string;
  fileDataUrl?: string;
  category: string;
  categoryOther?: string;
  documentSource?: string;
  uploadToken?: string;
}) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = raw.memberId?.trim();
    const fileName = raw.fileName?.trim();
    const category = raw.category?.trim();

    if (!memberId || !fileName || !category) {
      return { error: "Member, file, and category are required." };
    }

    const normalizedCategory = MEMBER_FILE_CATEGORY_OPTIONS.includes(category as (typeof MEMBER_FILE_CATEGORY_OPTIONS)[number])
      ? category
      : "Other";
    const categoryOther = raw.categoryOther?.trim() || null;
    if (normalizedCategory === "Other" && !categoryOther) {
      return { error: "Custom file category is required when category is Other." };
    }

    const fileDataUrl = raw.fileDataUrl?.trim() || "";
    if (!fileDataUrl) {
      return { error: "A file payload is required." };
    }

    const uploadToken = raw.uploadToken?.trim();
    if (!uploadToken) {
      return { error: "Upload token is required." };
    }

    const created = await saveCommandCenterMemberFileUpload({
      actor: {
        id: actor.id,
        fullName: actor.full_name,
        role: actor.role,
        permissions: actor.permissions
      },
      memberId,
      fileName,
      fileType: raw.fileType?.trim() || "application/octet-stream",
      fileDataUrl,
      category: normalizedCategory as (typeof MEMBER_FILE_CATEGORY_OPTIONS)[number],
      categoryOther: normalizedCategory === "Other" ? categoryOther : null,
      documentSource: raw.documentSource?.trim() || null,
      uploadToken
    });

    revalidateCommandCenter(memberId);
    return { ok: true, row: created };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to upload file." };
  }
}

export async function deleteMemberFileAction(raw: { id: string; memberId: string }) {
  try {
    const actor = await requireCommandCenterEditor();
    const id = raw.id?.trim();
    const memberId = raw.memberId?.trim();
    if (!id || !memberId) return { error: "Invalid file delete request." };

    await deleteCommandCenterMemberFile({
      actor: {
        id: actor.id,
        fullName: actor.full_name,
        role: actor.role,
        permissions: actor.permissions
      },
      memberFileId: id,
      memberId
    });

    revalidateCommandCenter(memberId);
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to delete file." };
  }
}

export async function getMemberFileDownloadUrlAction(raw: { id: string; memberId: string }) {
  try {
    await requireCommandCenterViewer();
    const id = raw.id?.trim();
    const memberId = raw.memberId?.trim();
    if (!id || !memberId) return { ok: false, error: "Invalid file download request." } as const;

    const result = await getMemberFileDownloadUrl({
      memberFileId: id,
      memberId
    });

    return { ok: true, signedUrl: result.url, fileName: result.fileName } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to fetch member file download URL."
    } as const;
  }
}
