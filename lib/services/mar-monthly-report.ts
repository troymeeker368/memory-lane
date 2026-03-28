import "server-only";

import { facilityBranding } from "@/lib/config/facility-branding";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { listMarMonthlyReportMemberOptions } from "@/lib/services/mar-member-options";
import { createClient } from "@/lib/supabase/server";
import { EASTERN_TIME_ZONE, easternDateTimeLocalToISO } from "@/lib/timezone";
import type { AppRole } from "@/types/app";

export const MAR_MONTHLY_REPORT_TYPES = ["summary", "detail", "exceptions"] as const;

export type MarMonthlyReportType = (typeof MAR_MONTHLY_REPORT_TYPES)[number];

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function clean(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function toOptionalDate(value: unknown): string | null {
  const normalized = clean(value);
  if (!normalized) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return fallback;
}

function initialsFromName(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function toMonthWindow(month: string) {
  const parsed = MONTH_PATTERN.exec(month);
  if (!parsed) throw new Error("Month must be formatted as YYYY-MM.");

  const year = Number(parsed[1]);
  const monthNumber = Number(parsed[2]);
  const startDate = `${parsed[1]}-${parsed[2]}-01`;
  const endDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const endDate = `${parsed[1]}-${parsed[2]}-${String(endDay).padStart(2, "0")}`;
  const startIso = easternDateTimeLocalToISO(`${startDate}T00:00`);
  const endIso = easternDateTimeLocalToISO(`${endDate}T23:59`);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "long",
    year: "numeric"
  }).format(new Date(Date.UTC(year, monthNumber - 1, 15)));

  return {
    year,
    monthNumber,
    month,
    monthLabel: label,
    startDate,
    endDate,
    startIso,
    endIso
  };
}

function overlapsMonth(startDate: string | null, endDate: string | null, monthStart: string, monthEnd: string) {
  if (startDate && startDate > monthEnd) return false;
  if (endDate && endDate < monthStart) return false;
  return true;
}

function formatScheduledTimes(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => clean(entry))
        .filter((entry): entry is string => Boolean(entry))
    )
  ).sort((left, right) => left.localeCompare(right));
}

type MemberRow = {
  id: string;
  display_name: string;
  status: string | null;
  dob: string | null;
  qr_code: string | null;
};

type PofMedicationRow = {
  id: string;
  medication_name: string;
  strength: string | null;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  scheduled_times: string[] | null;
  prn: boolean;
  prn_instructions: string | null;
  start_date: string | null;
  end_date: string | null;
  provider: string | null;
  instructions: string | null;
  active: boolean;
  given_at_center: boolean;
};

type MarScheduleRow = {
  id: string;
  pof_medication_id: string;
  medication_name: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  instructions: string | null;
  scheduled_time: string;
  prn: boolean;
  active: boolean;
};

type MarAdministrationRow = {
  id: string;
  pof_medication_id: string;
  mar_schedule_id: string | null;
  administration_date: string;
  scheduled_time: string | null;
  medication_name: string;
  dose: string | null;
  route: string | null;
  status: "Given" | "Not Given";
  not_given_reason: string | null;
  prn_reason: string | null;
  prn_outcome: "Effective" | "Ineffective" | null;
  prn_outcome_assessed_at: string | null;
  prn_followup_note: string | null;
  notes: string | null;
  administered_by: string;
  administered_by_user_id: string | null;
  administered_at: string;
  source: "scheduled" | "prn";
};

type MedicationOrderRow = {
  id: string;
  member_id: string;
  pof_medication_id: string | null;
  medication_name: string;
  strength: string | null;
  form: string | null;
  route: string | null;
  directions: string | null;
  prn_reason: string | null;
  frequency_text: string | null;
  start_date: string | null;
  end_date: string | null;
  provider_name: string | null;
  order_source: "pof" | "manual_provider_order" | "legacy_mhp" | "center_standing_order";
  status: "active" | "inactive" | "expired" | "discontinued";
  requires_effectiveness_followup: boolean | null;
};

type MedAdministrationLogRow = {
  id: string;
  medication_order_id: string;
  admin_datetime: string;
  dose_given: string | null;
  route_given: string | null;
  indication: string | null;
  followup_due_at: string | null;
  followup_status: "not_required" | "due" | "completed" | "overdue" | null;
  effectiveness_result: "Effective" | "Ineffective" | null;
  followup_notes: string | null;
  administered_by: string | null;
  administered_by_name: string | null;
  status: "Given" | "Refused" | "Held" | "Omitted";
  notes: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string;
  role: AppRole;
};

export type MarMonthlyReportMemberOption = {
  memberId: string;
  memberName: string;
  memberDob: string | null;
  memberIdentifier: string | null;
  memberStatus: string | null;
};

export type MarMonthlyMedicationSummary = {
  pofMedicationId: string;
  medicationName: string;
  strength: string | null;
  dose: string | null;
  route: string | null;
  sig: string | null;
  frequency: string | null;
  scheduledTimes: string[];
  prn: boolean;
  prnInstructions: string | null;
  startDate: string | null;
  endDate: string | null;
  provider: string | null;
  active: boolean;
};

export type MarMonthlyMedicationRollup = {
  pofMedicationId: string;
  medicationName: string;
  scheduledExpectedCount: number;
  givenCount: number;
  notGivenCount: number;
  refusedCount: number;
  heldCount: number;
  unavailableCount: number;
  omittedCount: number;
  otherExceptionCount: number;
  prnAdministrationCount: number;
  prnEffectiveCount: number;
  prnIneffectiveCount: number;
  lastAdministrationAt: string | null;
  lastExceptionAt: string | null;
};

export type MarMonthlyExceptionRow = {
  id: string;
  eventType: "scheduled-not-given" | "prn-ineffective" | "prn-status-variance";
  dateTime: string;
  medicationName: string;
  scheduledTime: string | null;
  administeredTime: string | null;
  outcome: string;
  reason: string | null;
  staffName: string;
  notes: string | null;
};

export type MarMonthlyPrnRow = {
  id: string;
  medicationName: string;
  administeredAt: string;
  status: "Given" | "Refused" | "Held" | "Omitted";
  reasonGiven: string | null;
  effectiveness: "Effective" | "Ineffective" | "Pending" | "Not Applicable";
  followupDueAt: string | null;
  followupStatus: "not_required" | "due" | "completed" | "overdue" | null;
  followupDocumentation: string | null;
  staffName: string;
  notes: string | null;
};

function toPrnEffectiveness(
  value: "Effective" | "Ineffective" | null,
  status: "Given" | "Refused" | "Held" | "Omitted" = "Given"
): MarMonthlyPrnRow["effectiveness"] {
  if (status !== "Given") return "Not Applicable";
  return value ?? "Pending";
}

export type MarMonthlyAdministrationDetailRow = {
  id: string;
  pofMedicationId: string | null;
  medicationName: string;
  source: "scheduled" | "prn";
  status: "Given" | "Not Given" | "Refused" | "Held" | "Omitted";
  dueTime: string | null;
  administeredAt: string;
  reason: string | null;
  prnReason: string | null;
  prnOutcome: "Effective" | "Ineffective" | null;
  prnFollowupNote: string | null;
  staffName: string;
  notes: string | null;
};

type UnifiedStaffEvent = {
  id: string;
  administered_by_user_id: string | null;
  administered_by: string;
};

function medicationKeyFromPofMedicationId(pofMedicationId: string) {
  return `pof:${pofMedicationId}`;
}

function medicationKeyFromOrder(order: Pick<MedicationOrderRow, "id" | "pof_medication_id">) {
  return order.pof_medication_id ? medicationKeyFromPofMedicationId(order.pof_medication_id) : `order:${order.id}`;
}

export type MarMonthlyStaffAttribution = {
  userId: string | null;
  staffName: string;
  staffRole: AppRole | null;
  initials: string;
  administrationCount: number;
};

export type MarMonthlyReportData = {
  reportType: MarMonthlyReportType;
  month: {
    value: string;
    label: string;
    year: number;
    monthNumber: number;
    startDate: string;
    endDate: string;
  };
  facility: {
    name: string;
    address: string | null;
    phone: string | null;
    confidentialityFooter: string;
  };
  member: {
    id: string;
    fullName: string;
    dob: string | null;
    identifier: string | null;
    status: string | null;
  };
  generatedAt: string;
  generatedBy: {
    name: string;
    role: AppRole | null;
  };
  medications: MarMonthlyMedicationSummary[];
  medicationRollups: MarMonthlyMedicationRollup[];
  exceptions: MarMonthlyExceptionRow[];
  prnRows: MarMonthlyPrnRow[];
  detailRows: MarMonthlyAdministrationDetailRow[];
  staffAttribution: MarMonthlyStaffAttribution[];
  totals: {
    scheduledExpected: number;
    scheduledGiven: number;
    scheduledNotGiven: number;
    prnAdministrations: number;
    prnIneffective: number;
    exceptions: number;
  };
  dataQuality: {
    hasMedicationRecords: boolean;
    hasMarDataForMonth: boolean;
    partialRecordsDetected: boolean;
    warnings: string[];
  };
};

export async function getMarMonthlyReportMemberOptions(options?: { serviceRole?: boolean }) {
  return listMarMonthlyReportMemberOptions(options);
}

export async function assembleMarMonthlyReportData(input: {
  memberId: string;
  month: string;
  reportType: MarMonthlyReportType;
  generatedBy: {
    name: string;
    role: AppRole | null;
  };
  generatedAtIso?: string;
  serviceRole?: boolean;
}) {
  const serviceRole = input.serviceRole ?? true;
  const monthWindow = toMonthWindow(input.month);
  const generatedAt = clean(input.generatedAtIso) ?? new Date().toISOString();

  const memberId = await resolveCanonicalMemberId(input.memberId, {
    actionLabel: "assembleMarMonthlyReportData",
    serviceRole
  });
  const supabase = await createClient({ serviceRole });

  const [memberResult, pofResult, scheduleResult, administrationResult, medicationOrderResult, administrationLogResult] = await Promise.all([
    supabase.from("members").select("id, display_name, status, dob, qr_code").eq("id", memberId).maybeSingle(),
    supabase
      .from("pof_medications")
      .select(
        "id, medication_name, strength, dose, route, frequency, scheduled_times, prn, prn_instructions, start_date, end_date, provider, instructions, active, given_at_center"
      )
      .eq("member_id", memberId)
      .eq("given_at_center", true),
    supabase
      .from("mar_schedules")
      .select(
        "id, pof_medication_id, medication_name, dose, route, frequency, instructions, scheduled_time, prn, active"
      )
      .eq("member_id", memberId)
      .gte("scheduled_time", monthWindow.startIso)
      .lte("scheduled_time", monthWindow.endIso),
    supabase
      .from("mar_administrations")
      .select(
        "id, pof_medication_id, mar_schedule_id, administration_date, scheduled_time, medication_name, dose, route, status, not_given_reason, prn_reason, prn_outcome, prn_outcome_assessed_at, prn_followup_note, notes, administered_by, administered_by_user_id, administered_at, source"
      )
      .eq("member_id", memberId)
      .gte("administered_at", monthWindow.startIso)
      .lte("administered_at", monthWindow.endIso),
    supabase
      .from("medication_orders")
      .select(
        "id, member_id, pof_medication_id, medication_name, strength, form, route, directions, prn_reason, frequency_text, start_date, end_date, provider_name, order_source, status, requires_effectiveness_followup"
      )
      .eq("member_id", memberId)
      .eq("order_type", "prn"),
    supabase
      .from("med_administration_logs")
      .select(
        "id, medication_order_id, admin_datetime, dose_given, route_given, indication, followup_due_at, followup_status, effectiveness_result, followup_notes, administered_by, administered_by_name, status, notes"
      )
      .eq("member_id", memberId)
      .eq("admin_type", "prn")
      .gte("admin_datetime", monthWindow.startIso)
      .lte("admin_datetime", monthWindow.endIso)
  ]);

  if (memberResult.error) throw new Error(memberResult.error.message);
  if (pofResult.error) throw new Error(pofResult.error.message);
  if (scheduleResult.error) throw new Error(scheduleResult.error.message);
  if (administrationResult.error) throw new Error(administrationResult.error.message);
  if (medicationOrderResult.error) throw new Error(medicationOrderResult.error.message);
  if (administrationLogResult.error) throw new Error(administrationLogResult.error.message);

  const member = memberResult.data as MemberRow | null;
  if (!member) throw new Error("Member was not found.");

  const pofRows = ((pofResult.data ?? []) as PofMedicationRow[]).map((row) => ({
    ...row,
    start_date: toOptionalDate(row.start_date),
    end_date: toOptionalDate(row.end_date),
    active: toBoolean(row.active, true),
    prn: toBoolean(row.prn, false),
    given_at_center: toBoolean(row.given_at_center, false),
    scheduled_times: formatScheduledTimes(row.scheduled_times)
  }));

  const schedules = ((scheduleResult.data ?? []) as MarScheduleRow[]).map((row) => ({
    ...row,
    prn: toBoolean(row.prn, false),
    active: toBoolean(row.active, true)
  }));

  const administrations = ((administrationResult.data ?? []) as MarAdministrationRow[])
    .map((row) => ({
      ...row,
      not_given_reason: clean(row.not_given_reason),
      prn_reason: clean(row.prn_reason),
      prn_followup_note: clean(row.prn_followup_note),
      notes: clean(row.notes),
      administered_by: clean(row.administered_by) ?? "Unknown staff",
      administered_by_user_id: clean(row.administered_by_user_id)
    }))
    .sort((left, right) => new Date(left.administered_at).getTime() - new Date(right.administered_at).getTime());

  const medicationOrders = ((medicationOrderResult.data ?? []) as MedicationOrderRow[]).map((row) => ({
    ...row,
    start_date: toOptionalDate(row.start_date),
    end_date: toOptionalDate(row.end_date),
    requires_effectiveness_followup: toBoolean(row.requires_effectiveness_followup, true)
  }));

  const prnAdministrationLogs = ((administrationLogResult.data ?? []) as MedAdministrationLogRow[])
    .map((row) => ({
      ...row,
      dose_given: clean(row.dose_given),
      route_given: clean(row.route_given),
      indication: clean(row.indication),
      followup_due_at: clean(row.followup_due_at),
      followup_notes: clean(row.followup_notes),
      administered_by: clean(row.administered_by),
      administered_by_name: clean(row.administered_by_name),
      notes: clean(row.notes)
    }))
    .sort((left, right) => new Date(left.admin_datetime).getTime() - new Date(right.admin_datetime).getTime());

  const medicationOrderById = new Map(medicationOrders.map((row) => [row.id, row] as const));
  const medicationKeysFromData = new Set<string>([
    ...pofRows.map((row) => medicationKeyFromPofMedicationId(row.id)),
    ...schedules.map((row) => medicationKeyFromPofMedicationId(row.pof_medication_id)),
    ...administrations.map((row) => medicationKeyFromPofMedicationId(row.pof_medication_id)),
    ...medicationOrders.map((row) => medicationKeyFromOrder(row)),
    ...prnAdministrationLogs.flatMap((row) => {
      const order = medicationOrderById.get(row.medication_order_id);
      return order ? [medicationKeyFromOrder(order)] : [];
    })
  ]);

  const schedulesByMedicationId = new Map<string, MarScheduleRow[]>();
  schedules.forEach((row) => {
    const key = medicationKeyFromPofMedicationId(row.pof_medication_id);
    const bucket = schedulesByMedicationId.get(key) ?? [];
    bucket.push(row);
    schedulesByMedicationId.set(key, bucket);
  });

  const administrationsByMedicationId = new Map<string, MarAdministrationRow[]>();
  administrations.forEach((row) => {
    const key = medicationKeyFromPofMedicationId(row.pof_medication_id);
    const bucket = administrationsByMedicationId.get(key) ?? [];
    bucket.push(row);
    administrationsByMedicationId.set(key, bucket);
  });

  const pofById = new Map(pofRows.map((row) => [medicationKeyFromPofMedicationId(row.id), row] as const));
  const ordersByMedicationKey = new Map<string, MedicationOrderRow[]>();
  medicationOrders.forEach((row) => {
    const key = medicationKeyFromOrder(row);
    const bucket = ordersByMedicationKey.get(key) ?? [];
    bucket.push(row);
    ordersByMedicationKey.set(key, bucket);
  });

  const prnLogsByMedicationKey = new Map<string, MedAdministrationLogRow[]>();
  prnAdministrationLogs.forEach((row) => {
    const order = medicationOrderById.get(row.medication_order_id);
    if (!order) return;
    const key = medicationKeyFromOrder(order);
    const bucket = prnLogsByMedicationKey.get(key) ?? [];
    bucket.push(row);
    prnLogsByMedicationKey.set(key, bucket);
  });

  const medications: MarMonthlyMedicationSummary[] = Array.from(medicationKeysFromData)
    .map((medicationId) => {
      const pofMedication = pofById.get(medicationId);
      const orderRowsForMedication = ordersByMedicationKey.get(medicationId) ?? [];
      const representativeOrder = orderRowsForMedication[0] ?? null;
      const medicationSchedules = schedulesByMedicationId.get(medicationId) ?? [];
      const medicationAdministrations = administrationsByMedicationId.get(medicationId) ?? [];
      const medicationPrnLogs = prnLogsByMedicationKey.get(medicationId) ?? [];

      const hasMonthData =
        medicationSchedules.length > 0 || medicationAdministrations.length > 0 || medicationPrnLogs.length > 0;
      const overlaps = pofMedication
        ? overlapsMonth(
            toOptionalDate(pofMedication.start_date),
            toOptionalDate(pofMedication.end_date),
            monthWindow.startDate,
            monthWindow.endDate
          )
        : representativeOrder
          ? overlapsMonth(representativeOrder.start_date, representativeOrder.end_date, monthWindow.startDate, monthWindow.endDate)
          : false;
      if (!hasMonthData && !overlaps) return null;

      const scheduledTimesFromSchedules = Array.from(
        new Set(
          medicationSchedules
            .map((schedule) => {
              const date = new Date(schedule.scheduled_time);
              if (Number.isNaN(date.getTime())) return null;
              return new Intl.DateTimeFormat("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
                timeZone: EASTERN_TIME_ZONE
              }).format(date);
            })
            .filter((entry): entry is string => Boolean(entry))
        )
      ).sort((left, right) => left.localeCompare(right));

      const scheduledTimes =
        pofMedication?.scheduled_times && pofMedication.scheduled_times.length > 0
          ? pofMedication.scheduled_times
          : scheduledTimesFromSchedules;

      const fallbackMedicationName =
        pofMedication?.medication_name ??
        representativeOrder?.medication_name ??
        medicationSchedules[0]?.medication_name ??
        medicationAdministrations[0]?.medication_name ??
        "Medication";

      return {
        pofMedicationId: medicationId,
        medicationName: fallbackMedicationName,
        strength: clean(pofMedication?.strength ?? representativeOrder?.strength ?? null),
        dose: clean(
          pofMedication?.dose ??
            representativeOrder?.strength ??
            medicationSchedules[0]?.dose ??
            medicationAdministrations[0]?.dose ??
            medicationPrnLogs[0]?.dose_given ??
            null
        ),
        route: clean(
          pofMedication?.route ??
            representativeOrder?.route ??
            medicationSchedules[0]?.route ??
            medicationAdministrations[0]?.route ??
            medicationPrnLogs[0]?.route_given ??
            null
        ),
        sig: clean(pofMedication?.instructions ?? representativeOrder?.directions ?? medicationSchedules[0]?.instructions ?? null),
        frequency: clean(pofMedication?.frequency ?? representativeOrder?.frequency_text ?? medicationSchedules[0]?.frequency ?? null),
        scheduledTimes,
        prn:
          Boolean(pofMedication?.prn) ||
          Boolean(representativeOrder) ||
          medicationAdministrations.some((administration) => administration.source === "prn") ||
          medicationPrnLogs.length > 0,
        prnInstructions: clean(pofMedication?.prn_instructions ?? representativeOrder?.prn_reason ?? null),
        startDate: toOptionalDate(pofMedication?.start_date ?? representativeOrder?.start_date),
        endDate: toOptionalDate(pofMedication?.end_date ?? representativeOrder?.end_date),
        provider: clean(pofMedication?.provider ?? representativeOrder?.provider_name ?? null),
        active: representativeOrder
          ? representativeOrder.status === "active"
          : toBoolean(pofMedication?.active, true)
      } satisfies MarMonthlyMedicationSummary;
    })
    .filter((row): row is MarMonthlyMedicationSummary => Boolean(row))
    .sort((left, right) => left.medicationName.localeCompare(right.medicationName, undefined, { sensitivity: "base" }));

  const scheduleLookup = new Map(schedules.map((row) => [row.id, row] as const));

  const medicationRollups: MarMonthlyMedicationRollup[] = medications.map((medication) => {
    const medicationSchedules = schedulesByMedicationId.get(medication.pofMedicationId) ?? [];
    const medicationAdministrations = administrationsByMedicationId.get(medication.pofMedicationId) ?? [];
    const medicationPrnLogs = prnLogsByMedicationKey.get(medication.pofMedicationId) ?? [];
    const scheduledAdministrations = medicationAdministrations.filter((row) => row.source === "scheduled");
    const legacyPrnAdministrations = medicationAdministrations.filter((row) => row.source === "prn");

    const expectedSchedules = medicationSchedules.filter((schedule) => {
      if (schedule.prn) return false;
      if (schedule.active) return true;
      return scheduledAdministrations.some((administration) => administration.mar_schedule_id === schedule.id);
    });

    const notGivenAdministrations = scheduledAdministrations.filter((administration) => administration.status === "Not Given");
    const countByReason = (reason: string) =>
      notGivenAdministrations.filter((administration) => administration.not_given_reason === reason).length;

    const prnAdministrationCount = legacyPrnAdministrations.length + medicationPrnLogs.length;
    const prnEffectiveCount =
      legacyPrnAdministrations.filter((administration) => administration.prn_outcome === "Effective").length +
      medicationPrnLogs.filter((log) => log.effectiveness_result === "Effective").length;
    const prnIneffectiveCount =
      legacyPrnAdministrations.filter((administration) => administration.prn_outcome === "Ineffective").length +
      medicationPrnLogs.filter((log) => log.effectiveness_result === "Ineffective").length;

    const lastAdministrationAt = [...medicationAdministrations.map((row) => row.administered_at), ...medicationPrnLogs.map((row) => row.admin_datetime)]
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;

    const lastExceptionAt = [
      ...notGivenAdministrations.map((row) => row.administered_at),
      ...medicationPrnLogs
        .filter((row) => row.status !== "Given" || row.effectiveness_result === "Ineffective")
        .map((row) => row.admin_datetime)
    ].sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;

    return {
      pofMedicationId: medication.pofMedicationId,
      medicationName: medication.medicationName,
      scheduledExpectedCount: expectedSchedules.length,
      givenCount: scheduledAdministrations.filter((administration) => administration.status === "Given").length,
      notGivenCount: notGivenAdministrations.length,
      refusedCount: countByReason("Refused"),
      heldCount: countByReason("Clinical hold"),
      unavailableCount: countByReason("Medication unavailable"),
      omittedCount: countByReason("Absent"),
      otherExceptionCount:
        countByReason("Other") +
        notGivenAdministrations.filter((administration) =>
          administration.not_given_reason
            ? !["Refused", "Clinical hold", "Medication unavailable", "Absent", "Other"].includes(administration.not_given_reason)
            : false
        ).length,
      prnAdministrationCount,
      prnEffectiveCount,
      prnIneffectiveCount,
      lastAdministrationAt,
      lastExceptionAt
    } satisfies MarMonthlyMedicationRollup;
  });

  const exceptions: MarMonthlyExceptionRow[] = [
    ...administrations
      .filter((row) => row.source === "scheduled" && row.status === "Not Given")
      .map((row) => ({
        id: row.id,
        eventType: "scheduled-not-given" as const,
        dateTime: row.administered_at,
        medicationName: row.medication_name,
        scheduledTime: row.scheduled_time ?? scheduleLookup.get(row.mar_schedule_id ?? "")?.scheduled_time ?? null,
        administeredTime: row.administered_at,
        outcome: "Not Given",
        reason: row.not_given_reason,
        staffName: row.administered_by,
        notes: row.notes
      })),
    ...administrations
      .filter((row) => row.source === "prn" && row.prn_outcome === "Ineffective")
      .map((row) => ({
        id: row.id,
        eventType: "prn-ineffective" as const,
        dateTime: row.administered_at,
        medicationName: row.medication_name,
        scheduledTime: null,
        administeredTime: row.administered_at,
        outcome: "PRN Ineffective",
        reason: row.prn_reason,
        staffName: row.administered_by,
        notes: row.prn_followup_note ?? row.notes
      })),
    ...prnAdministrationLogs.flatMap((row) => {
      const order = medicationOrderById.get(row.medication_order_id);
      if (!order) return [];
      if (row.status === "Given" && row.effectiveness_result !== "Ineffective") return [];
      return [
        {
          id: row.id,
          eventType: row.status === "Given" ? ("prn-ineffective" as const) : ("prn-status-variance" as const),
          dateTime: row.admin_datetime,
          medicationName: order.medication_name,
          scheduledTime: null,
          administeredTime: row.admin_datetime,
          outcome: row.status === "Given" ? "PRN Ineffective" : `PRN ${row.status}`,
          reason: row.indication,
          staffName: row.administered_by_name ?? "Unknown staff",
          notes: row.followup_notes ?? row.notes
        } satisfies MarMonthlyExceptionRow
      ];
    })
  ].sort((left, right) => new Date(right.dateTime).getTime() - new Date(left.dateTime).getTime());

  const prnRows: MarMonthlyPrnRow[] = [
    ...administrations
      .filter((row) => row.source === "prn")
      .map((row) => ({
        id: row.id,
        medicationName: row.medication_name,
        administeredAt: row.administered_at,
        status: "Given" as const,
        reasonGiven: row.prn_reason,
        effectiveness: toPrnEffectiveness(row.prn_outcome, "Given"),
        followupDueAt: null,
        followupStatus: row.prn_outcome ? ("completed" as const) : null,
        followupDocumentation: row.prn_followup_note,
        staffName: row.administered_by,
        notes: row.notes
      })),
    ...prnAdministrationLogs.flatMap((row) => {
      const order = medicationOrderById.get(row.medication_order_id);
      if (!order) return [];
      return [
        {
          id: row.id,
          medicationName: order.medication_name,
          administeredAt: row.admin_datetime,
          status: row.status,
          reasonGiven: row.indication,
          effectiveness: toPrnEffectiveness(row.effectiveness_result, row.status),
          followupDueAt: row.followup_due_at,
          followupStatus: row.followup_status,
          followupDocumentation: row.followup_notes,
          staffName: row.administered_by_name ?? "Unknown staff",
          notes: row.notes
        } satisfies MarMonthlyPrnRow
      ];
    })
  ].sort((left, right) => new Date(right.administeredAt).getTime() - new Date(left.administeredAt).getTime());

  const detailRows: MarMonthlyAdministrationDetailRow[] = [
    ...administrations.map((row) => ({
      id: row.id,
      pofMedicationId: row.pof_medication_id,
      medicationName: row.medication_name,
      source: row.source,
      status: row.status,
      dueTime: row.source === "scheduled" ? row.scheduled_time ?? scheduleLookup.get(row.mar_schedule_id ?? "")?.scheduled_time ?? null : null,
      administeredAt: row.administered_at,
      reason: row.status === "Not Given" ? row.not_given_reason : null,
      prnReason: row.prn_reason,
      prnOutcome: row.prn_outcome,
      prnFollowupNote: row.prn_followup_note,
      staffName: row.administered_by,
      notes: row.notes
    })),
    ...prnAdministrationLogs.flatMap((row) => {
      const order = medicationOrderById.get(row.medication_order_id);
      if (!order) return [];
      return [
        {
          id: row.id,
          pofMedicationId: order.pof_medication_id,
          medicationName: order.medication_name,
          source: "prn" as const,
          status: row.status,
          dueTime: null,
          administeredAt: row.admin_datetime,
          reason: row.status === "Given" ? null : row.indication,
          prnReason: row.indication,
          prnOutcome: row.effectiveness_result,
          prnFollowupNote: row.followup_notes,
          staffName: row.administered_by_name ?? "Unknown staff",
          notes: row.notes
        } satisfies MarMonthlyAdministrationDetailRow
      ];
    })
  ].sort((left, right) => new Date(left.administeredAt).getTime() - new Date(right.administeredAt).getTime());

  const staffEvents: UnifiedStaffEvent[] = [
    ...administrations.map((row) => ({
      id: row.id,
      administered_by_user_id: row.administered_by_user_id,
      administered_by: row.administered_by
    })),
    ...prnAdministrationLogs.map((row) => ({
      id: row.id,
      administered_by_user_id: row.administered_by,
      administered_by: row.administered_by_name ?? "Unknown staff"
    }))
  ];

  const administeredByUserIds = Array.from(
    new Set(
      staffEvents
        .map((row) => row.administered_by_user_id)
        .filter((row): row is string => Boolean(row))
    )
  );

  let profileById = new Map<string, ProfileRow>();
  if (administeredByUserIds.length > 0) {
    const { data: profileRows, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, role")
      .in("id", administeredByUserIds);

    if (profileError) throw new Error(profileError.message);

    profileById = new Map(
      ((profileRows ?? []) as ProfileRow[]).map((row) => [row.id, row] as const)
    );
  }

  const staffSummary = new Map<string, MarMonthlyStaffAttribution>();
  staffEvents.forEach((row) => {
    const summaryKey = row.administered_by_user_id ?? row.administered_by;
    const existing = staffSummary.get(summaryKey);

    if (existing) {
      existing.administrationCount += 1;
      return;
    }

    const profile = row.administered_by_user_id ? profileById.get(row.administered_by_user_id) : null;

    staffSummary.set(summaryKey, {
      userId: row.administered_by_user_id,
      staffName: row.administered_by,
      staffRole: profile?.role ?? null,
      initials: initialsFromName(row.administered_by),
      administrationCount: 1
    });
  });

  const staffAttribution = Array.from(staffSummary.values()).sort((left, right) => {
    if (right.administrationCount !== left.administrationCount) {
      return right.administrationCount - left.administrationCount;
    }
    return left.staffName.localeCompare(right.staffName, undefined, { sensitivity: "base" });
  });

  const nonPrnMedicationSummaries = medications.filter((medication) => !medication.prn && medication.scheduledTimes.length > 0);
  const prnLogsMissingOrders = prnAdministrationLogs.filter((row) => !medicationOrderById.has(row.medication_order_id)).length;
  const medsMissingSchedules = nonPrnMedicationSummaries.filter((medication) => {
    const scheduleCount = schedulesByMedicationId.get(medication.pofMedicationId)?.length ?? 0;
    const scheduledAdminCount =
      administrationsByMedicationId
        .get(medication.pofMedicationId)
        ?.filter((administration) => administration.source === "scheduled").length ?? 0;

    if (!overlapsMonth(medication.startDate, medication.endDate, monthWindow.startDate, monthWindow.endDate)) {
      return false;
    }

    return scheduleCount === 0 && scheduledAdminCount > 0;
  });

  const warnings: string[] = [];
  if (medications.length === 0) {
    warnings.push("No medication records found for this member for the selected month.");
  }

  if (schedules.length === 0 && administrations.length === 0 && prnAdministrationLogs.length === 0) {
    warnings.push("No MAR data was recorded for this member during the selected month.");
  }

  if (medsMissingSchedules.length > 0) {
    warnings.push(
      `Partial records detected: ${medsMissingSchedules.length} medication(s) have administrations but no matching scheduled opportunities in this month.`
    );
  }

  if (administrations.some((row) => row.source === "scheduled" && !row.mar_schedule_id)) {
    warnings.push("Partial records detected: one or more scheduled administrations are missing linked schedule identifiers.");
  }

  if (prnLogsMissingOrders > 0) {
    warnings.push(
      `Partial records detected: ${prnLogsMissingOrders} PRN administration log(s) are missing linked medication orders in the normalized PRN store.`
    );
  }

  const totals = {
    scheduledExpected: medicationRollups.reduce((sum, row) => sum + row.scheduledExpectedCount, 0),
    scheduledGiven: medicationRollups.reduce((sum, row) => sum + row.givenCount, 0),
    scheduledNotGiven: medicationRollups.reduce((sum, row) => sum + row.notGivenCount, 0),
    prnAdministrations: medicationRollups.reduce((sum, row) => sum + row.prnAdministrationCount, 0),
    prnIneffective: medicationRollups.reduce((sum, row) => sum + row.prnIneffectiveCount, 0),
    exceptions: exceptions.length
  };

  return {
    reportType: input.reportType,
    month: {
      value: monthWindow.month,
      label: monthWindow.monthLabel,
      year: monthWindow.year,
      monthNumber: monthWindow.monthNumber,
      startDate: monthWindow.startDate,
      endDate: monthWindow.endDate
    },
    facility: {
      name: facilityBranding.facilityName,
      address: clean(facilityBranding.facilityAddress),
      phone: clean(facilityBranding.facilityPhone),
      confidentialityFooter: "Confidential health information. Handle and distribute per HIPAA and organizational policy."
    },
    member: {
      id: member.id,
      fullName: member.display_name,
      dob: toOptionalDate(member.dob),
      identifier: clean(member.qr_code),
      status: clean(member.status)
    },
    generatedAt,
    generatedBy: {
      name: clean(input.generatedBy.name) ?? "Unknown user",
      role: input.generatedBy.role ?? null
    },
    medications,
    medicationRollups,
    exceptions,
    prnRows,
    detailRows,
    staffAttribution,
    totals,
    dataQuality: {
      hasMedicationRecords: medications.length > 0,
      hasMarDataForMonth: schedules.length > 0 || administrations.length > 0 || prnAdministrationLogs.length > 0,
      partialRecordsDetected: warnings.some((warning) => warning.toLowerCase().includes("partial records")),
      warnings
    }
  } satisfies MarMonthlyReportData;
}
