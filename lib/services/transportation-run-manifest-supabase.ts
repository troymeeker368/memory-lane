import "server-only";

import { createClient } from "@/lib/supabase/server";
import { normalizePhoneForStorage } from "@/lib/phone";
import {
  getWeekdayForDate,
  normalizeOperationalDateOnly,
  type OperationsWeekdayKey
} from "@/lib/services/operations-calendar";
import {
  loadExpectedAttendanceSupabaseContext,
  resolveExpectedAttendanceFromSupabaseContext
} from "@/lib/services/expected-attendance-supabase";
import {
  buildTransportLocationLabel,
  getTransportSlotForScheduleDay,
  toScheduleWeekdayKey,
  type ScheduleWeekdayKey
} from "@/lib/services/member-schedule-selectors";
import type {
  MemberAttendanceScheduleRow,
  MemberContactRow
} from "@/lib/services/member-command-center-read";
import type { TransportationManifestAdjustmentRow } from "@/lib/services/transportation-station-supabase";
import { listPreferredContactsByMemberSupabase } from "@/lib/services/transportation-contact-preferences-supabase";
import { resolveEffectiveTransportationBillingStatus } from "@/lib/services/billing-effective";

type Shift = "AM" | "PM";
type TransportMode = "Bus Stop" | "Door to Door";
type TransportationBillingStatus = "BillNormally" | "Waived" | "IncludedInProgramRate";

type MemberRow = {
  id: string;
  display_name: string;
  status: string;
};

type AttendanceRow = {
  member_id: string;
  status: "present" | "absent";
  absent_reason: string | null;
  absent_reason_other: string | null;
};

type TransportationLogRow = {
  id: string;
  member_id: string | null;
  period: string | null;
  service_date: string;
  billable: boolean;
  billing_status: string | null;
  transport_run_id: string | null;
  bus_number: string | null;
  transport_type: string | null;
};

type TransportationRunRow = {
  id: string;
  service_date: string;
  shift: string;
  bus_number: string;
  status: string;
  submitted_by_name: string | null;
  posted_at: string;
  last_submitted_at: string;
  submission_count: number;
  total_expected: number;
  total_posted: number;
  total_excluded: number;
  total_duplicates: number;
  total_nonbillable: number;
};

type TransportationRunResultRow = {
  id: string;
  run_id: string;
  member_id: string;
  result_status: "posted" | "excluded" | "duplicate_skipped";
  reason_code: string | null;
  reason_notes: string | null;
  billable: boolean;
  transportation_billing_status_snapshot: TransportationBillingStatus;
  transport_log_id: string | null;
  created_at: string;
};

const MEMBER_CONTACT_MANIFEST_SELECT =
  "id, member_id, contact_name, category, cellular_number, work_number, home_number, street_address, city, state, zip, updated_at";
const TRANSPORTATION_RUN_SELECT =
  "id, service_date, shift, bus_number, status, submitted_by_name, posted_at, last_submitted_at, submission_count, total_expected, total_posted, total_excluded, total_duplicates, total_nonbillable";

export type TransportationOperationalStatus =
  | "eligible"
  | "absent"
  | "excluded"
  | "inactive"
  | "outside-route-dates"
  | "already-posted";

export interface TransportationRunManifestRow {
  memberId: string;
  memberName: string;
  firstName: string;
  shift: Shift;
  busNumber: string;
  transportType: TransportMode;
  locationLabel: string;
  busStopName: string | null;
  doorToDoorAddress: string | null;
  caregiverContactId: string | null;
  caregiverContactName: string | null;
  caregiverContactPhone: string | null;
  caregiverContactAddress: string | null;
  riderSource: "schedule" | "manual-add";
  attendanceStatus: "present" | "absent" | "not-recorded";
  operationalStatus: TransportationOperationalStatus;
  operationalReasonCode:
    | "absent"
    | "excluded"
    | "inactive"
    | "outside-route-dates"
    | "already-posted"
    | "member-hold"
    | "center-closure"
    | null;
  operationalReasonLabel: string | null;
  billingStatus: TransportationBillingStatus;
  billable: boolean;
  alreadyPostedTransportLogId: string | null;
  adjustmentId: string | null;
  notes: string | null;
}

export interface TransportationRunManifestSummary {
  expectedRiders: number;
  readyToPost: number;
  excludedOrBlocked: number;
  alreadyPosted: number;
  waivedOrIncluded: number;
}

export interface TransportationRunHistoryEntry {
  runId: string;
  serviceDate: string;
  shift: Shift;
  busNumber: string;
  submittedByName: string | null;
  postedAt: string;
  lastSubmittedAt: string;
  submissionCount: number;
  totalExpected: number;
  totalPosted: number;
  totalExcluded: number;
  totalDuplicates: number;
  totalNonbillable: number;
}

export interface TransportationRunReviewRow {
  memberId: string;
  memberName: string;
  resultStatus: "posted" | "excluded" | "duplicate_skipped";
  reasonCode: string | null;
  reasonNotes: string | null;
  billable: boolean;
  billingStatus: TransportationBillingStatus;
  transportLogId: string | null;
  createdAt: string;
}

export interface TransportationRunManifestResult {
  selectedDate: string;
  selectedShift: Shift;
  selectedBusNumber: string;
  weekday: OperationsWeekdayKey;
  rows: TransportationRunManifestRow[];
  summary: TransportationRunManifestSummary;
  existingRun: TransportationRunHistoryEntry | null;
  existingRunResults: TransportationRunReviewRow[];
  recentRunsForDate: TransportationRunHistoryEntry[];
}

function sortManifestRows(left: TransportationRunManifestRow, right: TransportationRunManifestRow) {
  const byStatus = left.operationalStatus.localeCompare(right.operationalStatus);
  if (byStatus !== 0) {
    const order = ["eligible", "already-posted", "absent", "excluded", "inactive", "outside-route-dates"];
    return order.indexOf(left.operationalStatus) - order.indexOf(right.operationalStatus);
  }
  return left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" });
}

function firstNameFromDisplayName(displayName: string) {
  return displayName.trim().split(/\s+/)[0] ?? displayName.trim();
}

function formatContactAddress(contact: MemberContactRow | null) {
  return (
    [contact?.street_address, contact?.city, contact?.state, contact?.zip]
      .map((value) => (value ?? "").trim())
      .filter(Boolean)
      .join(", ") || null
  );
}

function statusLabelFromCode(code: TransportationRunManifestRow["operationalReasonCode"]) {
  switch (code) {
    case "absent":
      return "Attendance marked absent";
    case "member-hold":
      return "Member hold";
    case "center-closure":
      return "Center closure";
    case "inactive":
      return "Member inactive";
    case "outside-route-dates":
      return "Outside assignment dates";
    case "already-posted":
      return "Already posted";
    case "excluded":
      return "Excluded from manifest";
    default:
      return null;
  }
}

function coerceTransportMode(mode: string | null | undefined): TransportMode | null {
  if (mode === "Bus Stop" || mode === "Door to Door") return mode;
  return null;
}

function mapRunRow(row: TransportationRunRow): TransportationRunHistoryEntry {
  return {
    runId: row.id,
    serviceDate: row.service_date,
    shift: row.shift === "PM" ? "PM" : "AM",
    busNumber: row.bus_number,
    submittedByName: row.submitted_by_name ?? null,
    postedAt: row.posted_at,
    lastSubmittedAt: row.last_submitted_at,
    submissionCount: Number(row.submission_count ?? 1),
    totalExpected: Number(row.total_expected ?? 0),
    totalPosted: Number(row.total_posted ?? 0),
    totalExcluded: Number(row.total_excluded ?? 0),
    totalDuplicates: Number(row.total_duplicates ?? 0),
    totalNonbillable: Number(row.total_nonbillable ?? 0)
  };
}

export async function getTransportationRunManifestSupabase(input: {
  selectedDate: string;
  shift: Shift;
  busNumber: string;
}): Promise<TransportationRunManifestResult> {
  const supabase = await createClient();
  const selectedDate = normalizeOperationalDateOnly(input.selectedDate);
  const selectedShift = input.shift === "PM" ? "PM" : "AM";
  const selectedBusNumber = String(input.busNumber ?? "").trim();
  if (!selectedBusNumber) {
    throw new Error("Transportation run bus number is required.");
  }

  const weekday = getWeekdayForDate(selectedDate);
  const scheduleWeekday = toScheduleWeekdayKey(weekday);
  const [{ data: schedulesData, error: schedulesError }, { data: adjustmentsData, error: adjustmentsError }] =
    await Promise.all([
      supabase.from("member_attendance_schedules").select("*").eq("transportation_required", true),
      supabase
        .from("transportation_manifest_adjustments")
        .select("*")
        .eq("selected_date", selectedDate)
        .eq("shift", selectedShift)
    ]);

  if (schedulesError) throw new Error(schedulesError.message);
  if (adjustmentsError) throw new Error(adjustmentsError.message);

  const schedules = (schedulesData ?? []) as MemberAttendanceScheduleRow[];
  const scheduleByMemberId = new Map(schedules.map((row) => [row.member_id, row] as const));
  const adjustments = (adjustmentsData ?? []) as TransportationManifestAdjustmentRow[];
  const manualAdditions = adjustments.filter((row) => row.adjustment_type === "add");
  const manualExclusionsByMemberId = new Map(
    adjustments
      .filter((row) => row.adjustment_type === "exclude")
      .map((row) => [row.member_id, row] as const)
  );

  const memberIds = Array.from(
    new Set([...schedules.map((row) => row.member_id), ...manualAdditions.map((row) => row.member_id)])
  );
  const expectedAttendanceContext = await loadExpectedAttendanceSupabaseContext({
    memberIds,
    startDate: selectedDate,
    endDate: selectedDate,
    includeAttendanceRecords: false
  });

  const [
    { data: membersData, error: membersError },
    { data: attendanceData, error: attendanceError },
    { data: existingLogsData, error: existingLogsError },
    { data: existingRunData, error: existingRunError },
    { data: recentRunsData, error: recentRunsError },
    preferredContactsByMember
  ] = await Promise.all([
    memberIds.length > 0
      ? supabase.from("members").select("id, display_name, status").in("id", memberIds)
      : Promise.resolve({ data: [], error: null }),
    memberIds.length > 0
      ? supabase
          .from("attendance_records")
          .select("member_id, status, absent_reason, absent_reason_other")
          .in("member_id", memberIds)
          .eq("attendance_date", selectedDate)
      : Promise.resolve({ data: [], error: null }),
    memberIds.length > 0
      ? supabase
          .from("transportation_logs")
          .select("id, member_id, period, service_date, billable, billing_status, transport_run_id, bus_number, transport_type")
          .in("member_id", memberIds)
          .eq("service_date", selectedDate)
          .eq("period", selectedShift)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("transportation_runs")
      .select(TRANSPORTATION_RUN_SELECT)
      .eq("service_date", selectedDate)
      .eq("shift", selectedShift)
      .eq("bus_number", selectedBusNumber)
      .maybeSingle(),
    supabase
      .from("transportation_runs")
      .select(TRANSPORTATION_RUN_SELECT)
      .eq("service_date", selectedDate)
      .order("bus_number", { ascending: true })
      .order("last_submitted_at", { ascending: false }),
    listPreferredContactsByMemberSupabase({ memberIds })
  ]);

  if (membersError) throw new Error(membersError.message);
  if (attendanceError) throw new Error(attendanceError.message);
  if (existingLogsError) throw new Error(existingLogsError.message);
  if (existingRunError) throw new Error(existingRunError.message);
  if (recentRunsError) throw new Error(recentRunsError.message);

  const existingRun = (existingRunData as TransportationRunRow | null) ?? null;
  const recentRuns = ((recentRunsData ?? []) as TransportationRunRow[]).map(mapRunRow);
  const memberById = new Map(((membersData ?? []) as MemberRow[]).map((row) => [row.id, row] as const));
  const attendanceByMemberId = new Map(
    ((attendanceData ?? []) as AttendanceRow[]).map((row) => [String(row.member_id), row] as const)
  );
  const existingLogByMemberId = new Map(
    ((existingLogsData ?? []) as TransportationLogRow[])
      .filter((row) => row.member_id)
      .map((row) => [String(row.member_id), row] as const)
  );

  const rowMap = new Map<string, TransportationRunManifestRow>();

  const upsertRow = (row: TransportationRunManifestRow) => {
    rowMap.set(row.memberId, row);
  };

  schedules.forEach((schedule) => {
    if (!scheduleWeekday) return;
    const slot = getTransportSlotForScheduleDay(schedule as Parameters<typeof getTransportSlotForScheduleDay>[0], scheduleWeekday, selectedShift);
    const transportType = coerceTransportMode(slot.mode);
    if (!transportType) return;
    if ((slot.busNumber ?? "").trim() !== selectedBusNumber) return;

    const member = memberById.get(schedule.member_id);
    const contact = preferredContactsByMember.get(schedule.member_id) ?? null;
    const attendance = attendanceByMemberId.get(schedule.member_id) ?? null;
    const existingLog = existingLogByMemberId.get(schedule.member_id) ?? null;
    const resolution = resolveExpectedAttendanceFromSupabaseContext({
      context: expectedAttendanceContext,
      memberId: schedule.member_id,
      date: selectedDate,
      baseScheduleOverride: schedule
    });

    let operationalStatus: TransportationOperationalStatus = "eligible";
    let operationalReasonCode: TransportationRunManifestRow["operationalReasonCode"] = null;

    if (!member || member.status !== "active") {
      operationalStatus = "inactive";
      operationalReasonCode = "inactive";
    } else if (schedule.enrollment_date && selectedDate < schedule.enrollment_date) {
      operationalStatus = "outside-route-dates";
      operationalReasonCode = "outside-route-dates";
    } else if (!resolution.scheduledFromSchedule || !resolution.isScheduled) {
      operationalStatus = resolution.blockedBy === "member-hold" ? "excluded" : "outside-route-dates";
      operationalReasonCode = resolution.blockedBy === "member-hold"
        ? "member-hold"
        : resolution.blockedBy === "center-closure"
          ? "center-closure"
          : "outside-route-dates";
    } else if (attendance?.status === "absent") {
      operationalStatus = "absent";
      operationalReasonCode = "absent";
    } else if (manualExclusionsByMemberId.has(schedule.member_id)) {
      operationalStatus = "excluded";
      operationalReasonCode = "excluded";
    } else if (existingLog) {
      operationalStatus = "already-posted";
      operationalReasonCode = "already-posted";
    }

    upsertRow({
      memberId: schedule.member_id,
      memberName: member?.display_name ?? "Unknown Member",
      firstName: firstNameFromDisplayName(member?.display_name ?? "Member"),
      shift: selectedShift,
      busNumber: selectedBusNumber,
      transportType,
      locationLabel: buildTransportLocationLabel({
        mode: transportType,
        busStopName: slot.busStop ?? null,
        doorToDoorAddress: slot.doorToDoorAddress ?? null
      }),
      busStopName: slot.busStop ?? null,
      doorToDoorAddress: slot.doorToDoorAddress ?? null,
      caregiverContactId: contact?.id ?? null,
      caregiverContactName: contact?.contact_name ?? null,
      caregiverContactPhone: normalizePhoneForStorage(
        contact?.cellular_number ?? contact?.home_number ?? contact?.work_number ?? null
      ),
      caregiverContactAddress: formatContactAddress(contact),
      riderSource: "schedule",
      attendanceStatus: attendance?.status ?? "not-recorded",
      operationalStatus,
      operationalReasonCode,
      operationalReasonLabel: statusLabelFromCode(operationalReasonCode),
      billingStatus: resolveEffectiveTransportationBillingStatus({ attendanceSetting: schedule }),
      billable: resolveEffectiveTransportationBillingStatus({ attendanceSetting: schedule }) === "BillNormally",
      alreadyPostedTransportLogId: existingLog?.id ?? null,
      adjustmentId: null,
      notes: manualExclusionsByMemberId.get(schedule.member_id)?.notes ?? null
    });
  });

  manualAdditions.forEach((adjustment) => {
    if ((adjustment.bus_number ?? "").trim() !== selectedBusNumber) return;
    const member = memberById.get(adjustment.member_id);
    const schedule = scheduleByMemberId.get(adjustment.member_id) ?? null;
    const attendance = attendanceByMemberId.get(adjustment.member_id) ?? null;
    const existingLog = existingLogByMemberId.get(adjustment.member_id) ?? null;
    const contact = preferredContactsByMember.get(adjustment.member_id) ?? null;
    const transportType = coerceTransportMode(adjustment.transport_type) ?? "Door to Door";
    const billingStatus = resolveEffectiveTransportationBillingStatus({
      attendanceSetting: schedule
    });

    let operationalStatus: TransportationOperationalStatus = "eligible";
    let operationalReasonCode: TransportationRunManifestRow["operationalReasonCode"] = null;

    if (!member || member.status !== "active") {
      operationalStatus = "inactive";
      operationalReasonCode = "inactive";
    } else if (attendance?.status === "absent") {
      operationalStatus = "absent";
      operationalReasonCode = "absent";
    } else if (manualExclusionsByMemberId.has(adjustment.member_id)) {
      operationalStatus = "excluded";
      operationalReasonCode = "excluded";
    } else if (existingLog) {
      operationalStatus = "already-posted";
      operationalReasonCode = "already-posted";
    }

    upsertRow({
      memberId: adjustment.member_id,
      memberName: member?.display_name ?? "Unknown Member",
      firstName: firstNameFromDisplayName(member?.display_name ?? "Member"),
      shift: selectedShift,
      busNumber: selectedBusNumber,
      transportType,
      locationLabel: buildTransportLocationLabel({
        mode: transportType,
        busStopName: adjustment.bus_stop_name ?? null,
        doorToDoorAddress: adjustment.door_to_door_address ?? null
      }),
      busStopName: adjustment.bus_stop_name ?? null,
      doorToDoorAddress: adjustment.door_to_door_address ?? null,
      caregiverContactId: adjustment.caregiver_contact_id ?? contact?.id ?? null,
      caregiverContactName: adjustment.caregiver_contact_name_snapshot ?? contact?.contact_name ?? null,
      caregiverContactPhone: normalizePhoneForStorage(
        adjustment.caregiver_contact_phone_snapshot ??
          contact?.cellular_number ??
          contact?.home_number ??
          contact?.work_number ??
          null
      ),
      caregiverContactAddress: adjustment.caregiver_contact_address_snapshot ?? formatContactAddress(contact),
      riderSource: "manual-add",
      attendanceStatus: attendance?.status ?? "not-recorded",
      operationalStatus,
      operationalReasonCode,
      operationalReasonLabel: statusLabelFromCode(operationalReasonCode),
      billingStatus,
      billable: billingStatus === "BillNormally",
      alreadyPostedTransportLogId: existingLog?.id ?? null,
      adjustmentId: adjustment.id,
      notes: adjustment.notes ?? null
    });
  });

  const rows = Array.from(rowMap.values()).sort(sortManifestRows);
  const summary: TransportationRunManifestSummary = {
    expectedRiders: rows.length,
    readyToPost: rows.filter((row) => row.operationalStatus === "eligible").length,
    excludedOrBlocked: rows.filter((row) =>
      row.operationalStatus === "absent" ||
      row.operationalStatus === "excluded" ||
      row.operationalStatus === "inactive" ||
      row.operationalStatus === "outside-route-dates"
    ).length,
    alreadyPosted: rows.filter((row) => row.operationalStatus === "already-posted").length,
    waivedOrIncluded: rows.filter((row) => row.operationalStatus === "eligible" && !row.billable).length
  };

  let existingRunResults: TransportationRunReviewRow[] = [];
  if (existingRun) {
    const { data: runResultsData, error: runResultsError } = await supabase
      .from("transportation_run_results")
      .select("id, run_id, member_id, result_status, reason_code, reason_notes, billable, transportation_billing_status_snapshot, transport_log_id, created_at")
      .eq("run_id", existingRun.id)
      .order("created_at", { ascending: true });
    if (runResultsError) throw new Error(runResultsError.message);
    existingRunResults = ((runResultsData ?? []) as TransportationRunResultRow[])
      .map((row) => ({
        memberId: row.member_id,
        memberName: memberById.get(row.member_id)?.display_name ?? "Unknown Member",
        resultStatus: row.result_status,
        reasonCode: row.reason_code ?? null,
        reasonNotes: row.reason_notes ?? null,
        billable: Boolean(row.billable),
        billingStatus: row.transportation_billing_status_snapshot,
        transportLogId: row.transport_log_id ?? null,
        createdAt: row.created_at
      }))
      .sort((left, right) => left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" }));
  }

  return {
    selectedDate,
    selectedShift,
    selectedBusNumber,
    weekday,
    rows,
    summary,
    existingRun: existingRun ? mapRunRow(existingRun) : null,
    existingRunResults,
    recentRunsForDate: recentRuns
  };
}
