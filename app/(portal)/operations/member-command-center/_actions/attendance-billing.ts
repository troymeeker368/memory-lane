import "server-only";

import { resolveActiveEffectiveRowForDate, resolveEffectiveTransportationBillingStatus } from "@/lib/services/billing-effective";
import { saveMemberCommandCenterAttendanceBillingWorkflow } from "@/lib/services/member-command-center";
import { resolveTransportPeriod } from "@/lib/services/member-schedule-selectors";
import { countEnabledScheduleWeekdays } from "@/lib/services/schedule-changes-shared";
import {
  listBillingScheduleTemplatesSupabase,
  listMemberBillingSettingsSupabase
} from "@/lib/services/member-command-center-read";
import {
  ensureMemberAttendanceScheduleSupabase,
  ensureMemberCommandCenterProfileSupabase
} from "@/lib/services/member-command-center-write";
import { toEasternISO } from "@/lib/timezone";

import {
  asCheckbox,
  asDateOnly,
  asNullableString,
  asOptionalPositiveNumber,
  asString,
  requireAttendanceBillingEditor,
  revalidateCommandCenter,
  toServiceActor
} from "./shared";

export async function saveMemberCommandCenterAttendanceAction(formData: FormData) {
  const actor = await requireAttendanceBillingEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const schedule = await ensureMemberAttendanceScheduleSupabase(memberId);
  if (!schedule) return { ok: false, error: "Attendance schedule not found." };

  const commandCenterProfile = await ensureMemberCommandCenterProfileSupabase(memberId);
  const now = toEasternISO();
  const enrollmentDate = asNullableString(formData, "enrollmentDate");
  const monday = asCheckbox(formData, "monday");
  const tuesday = asCheckbox(formData, "tuesday");
  const wednesday = asCheckbox(formData, "wednesday");
  const thursday = asCheckbox(formData, "thursday");
  const friday = asCheckbox(formData, "friday");
  const mondayAdded = monday && !schedule.monday;
  const tuesdayAdded = tuesday && !schedule.tuesday;
  const wednesdayAdded = wednesday && !schedule.wednesday;
  const thursdayAdded = thursday && !schedule.thursday;
  const fridayAdded = friday && !schedule.friday;
  const attendanceDaysPerWeek = countEnabledScheduleWeekdays({
    monday,
    tuesday,
    wednesday,
    thursday,
    friday
  });
  const dailyRate = asOptionalPositiveNumber(formData, "dailyRate");
  if (dailyRate == null) {
    return { ok: false, error: "Daily Rate is required and must be greater than 0." };
  }

  const transportationBillingStatusRaw = asString(formData, "transportationBillingStatus");
  const transportationBillingStatus = resolveEffectiveTransportationBillingStatus({
    attendanceSetting: { transportation_billing_status: transportationBillingStatusRaw }
  });
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
  const defaultMode = schedule.transportation_mode ?? existingSlots.find((slot) => slot.mode)?.mode ?? null;
  const defaultBusNumber = schedule.transport_bus_number ?? existingSlots.find((slot) => slot.busNumber)?.busNumber ?? null;
  const defaultBusStop = schedule.transportation_bus_stop ?? existingSlots.find((slot) => slot.busStop)?.busStop ?? null;
  const fallbackDoorToDoorAddress =
    existingSlots.find((slot) => slot.doorToDoorAddress)?.doorToDoorAddress ?? defaultDoorToDoorAddress;

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
    const seededBusStop = seededMode === "Bus Stop" ? (current.busStop ?? defaultBusStop ?? null) : null;

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

  const schedulePatch = {
    enrollment_date: enrollmentDate,
    monday,
    tuesday,
    wednesday,
    thursday,
    friday,
    full_day: true,
    transport_monday_period: resolveTransportPeriod({ dayEnabled: monday, amMode: mondayAm.mode, pmMode: mondayPm.mode }),
    transport_tuesday_period: resolveTransportPeriod({ dayEnabled: tuesday, amMode: tuesdayAm.mode, pmMode: tuesdayPm.mode }),
    transport_wednesday_period: resolveTransportPeriod({
      dayEnabled: wednesday,
      amMode: wednesdayAm.mode,
      pmMode: wednesdayPm.mode
    }),
    transport_thursday_period: resolveTransportPeriod({
      dayEnabled: thursday,
      amMode: thursdayAm.mode,
      pmMode: thursdayPm.mode
    }),
    transport_friday_period: resolveTransportPeriod({ dayEnabled: friday, amMode: fridayAm.mode, pmMode: fridayPm.mode }),
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
    .filter((row) => row.active)
    .sort((left, right) => (left.effective_start_date < right.effective_start_date ? 1 : -1));
  const existingBillingSetting =
    resolveActiveEffectiveRowForDate(rateEffectiveDate, activeMemberBillingSettings) ??
    activeMemberBillingSettings[0] ??
    null;

  const fallbackPayorId =
    activeMemberBillingSettings
      .map((row) => row.payor_id)
      .find((row): row is string => Boolean(row)) ?? null;
  const legacyPayorId = existingBillingSetting?.payor_id ?? fallbackPayorId ?? null;

  const activeScheduleTemplates = (await listBillingScheduleTemplatesSupabase(memberId))
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
          payor_id: legacyPayorId,
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
          payor_id: legacyPayorId,
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
    actor: toServiceActor(actor),
    now
  });

  revalidateCommandCenter(memberId);
  return { ok: true };
}
