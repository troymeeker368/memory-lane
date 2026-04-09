import type {
  MarAdministrationHistoryRow,
  MarPrnOption,
  MarTodayRow,
  MarWorkflowSnapshot
} from "@/lib/services/mar-shared";
import {
  getPrnHistorySnapshot,
  listActivePrnMedicationOptions,
  syncActivePrnMedicationOrders
} from "@/lib/services/mar-prn-workflow";
import { listMarWorkflowMemberOptions, type MarWorkflowMemberOption } from "@/lib/services/mar-member-options";
import {
  clean,
  mapMarHistoryRow,
  mapMarTodayRow,
  normalizeScheduledTimes,
  throwMarSupabaseError,
  toMemberPhotoLookup,
  type MemberPhotoRow
} from "@/lib/services/mar-workflow-core";
import { reconcileMarSchedulesForMember } from "@/lib/services/mar-reconcile";
import { createClient } from "@/lib/supabase/server";
import { easternDateTimeLocalToISO, toEasternDate } from "@/lib/timezone";

const MAR_MHP_SOURCE_PREFIX = "mhp-";
const MAR_TODAY_SELECT =
  "mar_schedule_id, member_id, member_name, pof_medication_id, medication_name, dose, route, frequency, instructions, prn, scheduled_time, administration_id, status, not_given_reason, prn_reason, notes, administered_by, administered_by_user_id, administered_at, source";
const MAR_HISTORY_SELECT =
  "id, member_id, member_name, pof_medication_id, mar_schedule_id, administration_date, scheduled_time, medication_name, dose, route, status, not_given_reason, prn_reason, prn_outcome, prn_outcome_assessed_at, prn_followup_note, notes, administered_by, administered_by_user_id, administered_at, source, created_at, updated_at";

type MarSyncMedicationRow = {
  member_id: string | null;
  updated_at: string | null;
  scheduled_times: unknown;
};

type MarScheduleFreshnessRow = {
  member_id: string | null;
  updated_at: string | null;
};

function addDaysDateOnly(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildMedicationActiveOnDateFilter(dateValue: string) {
  return [
    "and(start_date.is.null,end_date.is.null)",
    `and(start_date.is.null,end_date.gte.${dateValue})`,
    `and(start_date.lte.${dateValue},end_date.is.null)`,
    `and(start_date.lte.${dateValue},end_date.gte.${dateValue})`
  ].join(",");
}

export async function syncTodayMarSchedules(options?: { serviceRole?: boolean }) {
  const serviceRole = options?.serviceRole ?? true;
  const today = toEasternDate();
  const supabase = await createClient({ serviceRole });
  const todayStart = easternDateTimeLocalToISO(`${today}T00:00`);
  const tomorrow = addDaysDateOnly(today, 1);
  const todayEndExclusive = easternDateTimeLocalToISO(`${tomorrow}T00:00`);
  const [{ data: medicationRowsRaw, error: medicationError }, { data: scheduleRowsRaw, error: scheduleError }] = await Promise.all([
    supabase
      .from("pof_medications")
      .select("member_id, updated_at, scheduled_times")
      .eq("active", true)
      .eq("given_at_center", true)
      .eq("prn", false)
      .like("source_medication_id", `${MAR_MHP_SOURCE_PREFIX}%`)
      .not("member_id", "is", null)
      .not("scheduled_times", "is", null)
      .or(buildMedicationActiveOnDateFilter(today)),
    supabase
      .from("mar_schedules")
      .select("member_id, updated_at")
      .eq("active", true)
      .not("member_id", "is", null)
      .gte("scheduled_time", todayStart)
      .lt("scheduled_time", todayEndExclusive)
  ]);
  if (medicationError) throwMarSupabaseError(medicationError, "pof_medications");
  if (scheduleError) throwMarSupabaseError(scheduleError, "mar_schedules");

  const medicationRows = (medicationRowsRaw ?? []) as MarSyncMedicationRow[];
  const scheduleRows = (scheduleRowsRaw ?? []) as MarScheduleFreshnessRow[];

  const expectedScheduleCountByMember = new Map<string, number>();
  const latestMedicationUpdateByMember = new Map<string, number>();
  medicationRows.forEach((row) => {
    const memberId = clean(row.member_id);
    if (!memberId) return;
    const currentCount = expectedScheduleCountByMember.get(memberId) ?? 0;
    expectedScheduleCountByMember.set(memberId, currentCount + normalizeScheduledTimes(row.scheduled_times).length);
    const updatedAtMs = Date.parse(String(row.updated_at ?? ""));
    if (Number.isFinite(updatedAtMs)) {
      latestMedicationUpdateByMember.set(memberId, Math.max(latestMedicationUpdateByMember.get(memberId) ?? 0, updatedAtMs));
    }
  });

  const activeScheduleCountByMember = new Map<string, number>();
  const latestScheduleUpdateByMember = new Map<string, number>();
  scheduleRows.forEach((row) => {
    const memberId = clean(row.member_id);
    if (!memberId) return;
    activeScheduleCountByMember.set(memberId, (activeScheduleCountByMember.get(memberId) ?? 0) + 1);
    const updatedAtMs = Date.parse(String(row.updated_at ?? ""));
    if (Number.isFinite(updatedAtMs)) {
      latestScheduleUpdateByMember.set(memberId, Math.max(latestScheduleUpdateByMember.get(memberId) ?? 0, updatedAtMs));
    }
  });

  const candidateMemberIds = Array.from(new Set([...expectedScheduleCountByMember.keys(), ...activeScheduleCountByMember.keys()]));
  const memberIds = candidateMemberIds.filter((memberId) => {
    const expectedCount = expectedScheduleCountByMember.get(memberId) ?? 0;
    const activeCount = activeScheduleCountByMember.get(memberId) ?? 0;
    if (expectedCount !== activeCount) return true;
    if (expectedCount === 0) return false;
    return (latestMedicationUpdateByMember.get(memberId) ?? 0) > (latestScheduleUpdateByMember.get(memberId) ?? 0);
  });

  if (memberIds.length === 0) return;

  await Promise.all(
    memberIds.map((memberId) =>
      reconcileMarSchedulesForMember({
        memberId,
        startDate: today,
        endDate: today,
        serviceRole,
        actionLabel: "syncTodayMarSchedules"
      })
    )
  );
}

export async function refreshMarWorkflowData(options?: { serviceRole?: boolean }) {
  const serviceRole = options?.serviceRole ?? true;
  await syncTodayMarSchedules({ serviceRole });
  await syncActivePrnMedicationOrders({ serviceRole });
}

export async function getMarWorkflowSnapshot(options?: {
  serviceRole?: boolean;
  historyLimit?: number;
  notGivenLimit?: number;
  prnLimit?: number;
  memberOptions?: MarWorkflowMemberOption[];
  memberOptionsFallback?: MarWorkflowMemberOption[];
}) {
  const serviceRole = options?.serviceRole ?? false;

  const historyLimit = Math.max(10, Math.min(options?.historyLimit ?? 200, 500));
  const notGivenLimit = Math.max(10, Math.min(options?.notGivenLimit ?? 100, 250));
  const prnLimit = Math.max(10, Math.min(options?.prnLimit ?? 200, 500));
  const supabase = await createClient({ serviceRole });
  const memberOptionsFallback = options?.memberOptionsFallback;

  const viewQueriesPromise = Promise.all([
    supabase.from("v_mar_today").select(MAR_TODAY_SELECT).order("scheduled_time", { ascending: true }),
    supabase.from("v_mar_overdue_today").select(MAR_TODAY_SELECT).order("scheduled_time", { ascending: true }),
    supabase
      .from("v_mar_not_given_today")
      .select(MAR_HISTORY_SELECT)
      .order("administered_at", { ascending: false })
      .limit(notGivenLimit),
    supabase
      .from("v_mar_administration_history")
      .select(MAR_HISTORY_SELECT)
      .order("administered_at", { ascending: false })
      .limit(historyLimit)
  ]);
  const prnSnapshotPromise = getPrnHistorySnapshot({ limit: prnLimit, serviceRole });
  const prnMedicationOptionsPromise = listActivePrnMedicationOptions({ serviceRole });
  const memberOptionsPromise = options?.memberOptions
    ? Promise.resolve(options.memberOptions)
    : listMarWorkflowMemberOptions({ serviceRole }).catch((error) => {
        if (memberOptionsFallback) return memberOptionsFallback;
        throw error;
      });

  const [
    [
      { data: todayRowsRaw, error: todayError },
      { data: overdueRowsRaw, error: overdueError },
      { data: notGivenRowsRaw, error: notGivenError },
      { data: historyRowsRaw, error: historyError }
    ],
    prnSnapshot,
    prnMedicationOptions,
    memberOptions
  ] = await Promise.all([
    viewQueriesPromise,
    prnSnapshotPromise,
    prnMedicationOptionsPromise,
    memberOptionsPromise
  ]);

  if (todayError) throwMarSupabaseError(todayError, "v_mar_today");
  if (overdueError) throwMarSupabaseError(overdueError, "v_mar_overdue_today");
  if (notGivenError) throwMarSupabaseError(notGivenError, "v_mar_not_given_today");
  if (historyError) throwMarSupabaseError(historyError, "v_mar_administration_history");

  const today = (todayRowsRaw ?? [])
    .map((row: unknown) => mapMarTodayRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarTodayRow => Boolean(row));
  const overdueToday = (overdueRowsRaw ?? [])
    .map((row: unknown) => mapMarTodayRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarTodayRow => Boolean(row));
  const notGivenToday = (notGivenRowsRaw ?? [])
    .map((row: unknown) => mapMarHistoryRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarAdministrationHistoryRow => Boolean(row));
  const history = (historyRowsRaw ?? [])
    .map((row: unknown) => mapMarHistoryRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarAdministrationHistoryRow => Boolean(row));
  const scheduledHistory = history.filter((row) => row.source !== "prn");
  const mergedHistory = [...prnSnapshot.log, ...scheduledHistory]
    .sort((left, right) => new Date(right.administeredAt).getTime() - new Date(left.administeredAt).getTime())
    .slice(0, historyLimit);

  const memberIdsForPhotos = Array.from(new Set([...today.map((row) => row.memberId), ...overdueToday.map((row) => row.memberId)]));
  if (memberIdsForPhotos.length > 0) {
    const { data: photoRows, error: photoError } = await supabase
      .from("member_command_centers")
      .select("member_id, profile_image_url")
      .in("member_id", memberIdsForPhotos);
    if (photoError) throwMarSupabaseError(photoError, "member_command_centers");

    const photoByMemberId = toMemberPhotoLookup((photoRows ?? []) as MemberPhotoRow[]);
    today.forEach((row) => {
      row.memberPhotoUrl = photoByMemberId.get(row.memberId) ?? null;
    });
    overdueToday.forEach((row) => {
      row.memberPhotoUrl = photoByMemberId.get(row.memberId) ?? null;
    });
  }

  return {
    today,
    overdueToday,
    notGivenToday,
    history: mergedHistory,
    prnLog: prnSnapshot.log,
    prnAwaitingOutcome: prnSnapshot.awaitingOutcome,
    prnEffective: prnSnapshot.effective,
    prnIneffective: prnSnapshot.ineffective,
    prnMedicationOptions,
    memberOptions
  } satisfies MarWorkflowSnapshot;
}
