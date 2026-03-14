import { createClient } from "@/lib/supabase/server";
import { cache } from "react";
import {
  resolveExpectedAttendanceForDate,
  type AttendanceWeekdayScheduleShape,
  type CenterClosureLike,
  type ExpectedAttendanceResolution,
  type MemberHoldLike
} from "@/lib/services/expected-attendance";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import {
  listActiveScheduleChangesForMembersSupabase,
  type ScheduleChangeRow
} from "@/lib/services/schedule-changes-supabase";

type AttendanceRecordLite = {
  id: string;
  member_id: string;
  attendance_date: string;
};

type AttendanceScheduleRow = AttendanceWeekdayScheduleShape & {
  member_id: string;
};

type HoldRow = {
  member_id: string;
  start_date: string;
  end_date: string | null;
  status: string;
};

type CenterClosureRow = {
  closure_date: string;
  active?: boolean | null;
};

export interface ExpectedAttendanceSupabaseContext {
  startDate: string;
  endDate: string;
  schedulesByMember: Map<string, AttendanceScheduleRow>;
  holdsByMember: Map<string, HoldRow[]>;
  scheduleChangesByMember: Map<string, ScheduleChangeRow[]>;
  centerClosures: CenterClosureRow[];
  attendanceRecordByMemberDate: Map<string, AttendanceRecordLite>;
}

const loadExpectedAttendanceSupabaseContextCached = cache(
  async (
    memberIdsKey: string,
    startDate: string,
    endDate: string,
    includeAttendanceRecords: boolean,
    includeSchedules: boolean
  ): Promise<ExpectedAttendanceSupabaseContext> => {
    const memberIds = memberIdsKey.split(",").filter(Boolean);
    if (memberIds.length === 0) {
      return {
        startDate,
        endDate,
        schedulesByMember: new Map(),
        holdsByMember: new Map(),
        scheduleChangesByMember: new Map(),
        centerClosures: [],
        attendanceRecordByMemberDate: new Map()
      };
    }

    const supabase = await createClient();
    const holdsFilter = `end_date.is.null,end_date.gte.${startDate}`;
    const [scheduleResult, holdsResult, centerClosuresResult, scheduleChanges, attendanceRecordsResult] = await Promise.all([
      includeSchedules
        ? supabase
            .from("member_attendance_schedules")
            .select("member_id, monday, tuesday, wednesday, thursday, friday")
            .in("member_id", memberIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("member_holds")
        .select("member_id, start_date, end_date, status")
        .in("member_id", memberIds)
        .eq("status", "active")
        .lte("start_date", endDate)
        .or(holdsFilter),
      supabase
        .from("center_closures")
        .select("closure_date, active")
        .gte("closure_date", startDate)
        .lte("closure_date", endDate),
      listActiveScheduleChangesForMembersSupabase({
        memberIds,
        startDate,
        endDate
      }),
      includeAttendanceRecords
        ? supabase
            .from("attendance_records")
            .select("id, member_id, attendance_date")
            .in("member_id", memberIds)
            .gte("attendance_date", startDate)
            .lte("attendance_date", endDate)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (includeSchedules && scheduleResult.error) {
      if (isMissingSchemaObjectError(scheduleResult.error)) {
        throw missingExpectedAttendanceStorageError({
          objectName: "member_attendance_schedules",
          migration: "0011_member_command_center_aux_schema.sql"
        });
      }
      throw new Error(scheduleResult.error.message);
    }
    if (holdsResult.error) {
      if (isMissingSchemaObjectError(holdsResult.error)) {
        throw missingExpectedAttendanceStorageError({
          objectName: "member_holds",
          migration: "0010_member_holds_persistence.sql"
        });
      }
      throw new Error(holdsResult.error.message);
    }
    if (centerClosuresResult.error) {
      if (isMissingSchemaObjectError(centerClosuresResult.error)) {
        throw missingExpectedAttendanceStorageError({
          objectName: "center_closures",
          migration: "0015_schema_compatibility_backfill.sql"
        });
      }
      throw new Error(centerClosuresResult.error.message);
    }
    if (attendanceRecordsResult.error) {
      if (isMissingSchemaObjectError(attendanceRecordsResult.error)) {
        throw missingExpectedAttendanceStorageError({
          objectName: "attendance_records",
          migration: "0012_legacy_operational_health_alignment.sql"
        });
      }
      throw new Error(attendanceRecordsResult.error.message);
    }

    const schedulesByMember = new Map<string, AttendanceScheduleRow>();
    ((scheduleResult.data ?? []) as AttendanceScheduleRow[]).forEach((row) => {
      schedulesByMember.set(row.member_id, row);
    });

    const holdsByMember = mapByMember(
      ((holdsResult.data ?? []) as HoldRow[])
    );
    const scheduleChangesByMember = mapByMember(scheduleChanges);
    const centerClosures = (centerClosuresResult.data ?? []) as CenterClosureRow[];

    const attendanceRecordByMemberDate = new Map<string, AttendanceRecordLite>();
    ((attendanceRecordsResult.data ?? []) as AttendanceRecordLite[]).forEach((row) => {
      attendanceRecordByMemberDate.set(
        buildAttendanceRecordKey(row.member_id, normalizeOperationalDateOnly(row.attendance_date)),
        row
      );
    });

    return {
      startDate,
      endDate,
      schedulesByMember,
      holdsByMember,
      scheduleChangesByMember,
      centerClosures,
      attendanceRecordByMemberDate
    };
  }
);

function buildAttendanceRecordKey(memberId: string, dateOnly: string) {
  return `${memberId}:${dateOnly}`;
}

function isMissingSchemaObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return code === "PGRST205" || /does not exist|relation .* does not exist|schema cache/i.test(message);
}

function missingExpectedAttendanceStorageError(input: {
  objectName: "member_attendance_schedules" | "member_holds" | "center_closures" | "attendance_records";
  migration: string;
}) {
  return new Error(
    `Missing Supabase schema object public.${input.objectName}. Apply migration ${input.migration} (and any earlier unapplied migrations), then restart Supabase/PostgREST to refresh schema cache.`
  );
}

function mapByMember<T extends { member_id: string }>(rows: T[]) {
  const out = new Map<string, T[]>();
  rows.forEach((row) => {
    const existing = out.get(row.member_id) ?? [];
    existing.push(row);
    out.set(row.member_id, existing);
  });
  return out;
}

export async function loadExpectedAttendanceSupabaseContext(input: {
  memberIds: Array<string | null | undefined>;
  startDate: string;
  endDate: string;
  includeAttendanceRecords?: boolean;
  includeSchedules?: boolean;
}): Promise<ExpectedAttendanceSupabaseContext> {
  const memberIds = Array.from(
    new Set(
      input.memberIds
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  ).sort();
  const startDate = normalizeOperationalDateOnly(input.startDate);
  const endDate = normalizeOperationalDateOnly(input.endDate);

  return loadExpectedAttendanceSupabaseContextCached(
    memberIds.join(","),
    startDate,
    endDate,
    Boolean(input.includeAttendanceRecords),
    input.includeSchedules !== false
  );
}

export function resolveExpectedAttendanceFromSupabaseContext(input: {
  context: ExpectedAttendanceSupabaseContext;
  memberId: string;
  date: string;
  baseScheduleOverride?: AttendanceWeekdayScheduleShape | null;
  holdsOverride?: MemberHoldLike[] | null;
  centerClosuresOverride?: CenterClosureLike[] | null;
  scheduleChangesOverride?: ScheduleChangeRow[] | null;
  hasUnscheduledAttendanceAddition?: boolean;
}): ExpectedAttendanceResolution {
  const date = normalizeOperationalDateOnly(input.date);
  const memberId = String(input.memberId ?? "").trim();
  const attendanceRecordKey = buildAttendanceRecordKey(memberId, date);

  return resolveExpectedAttendanceForDate({
    date,
    baseSchedule:
      input.baseScheduleOverride ??
      input.context.schedulesByMember.get(memberId) ??
      null,
    scheduleChanges:
      input.scheduleChangesOverride ??
      input.context.scheduleChangesByMember.get(memberId) ??
      [],
    holds:
      input.holdsOverride ??
      input.context.holdsByMember.get(memberId) ??
      [],
    centerClosures:
      input.centerClosuresOverride ??
      input.context.centerClosures,
    hasUnscheduledAttendanceAddition:
      input.hasUnscheduledAttendanceAddition ??
      input.context.attendanceRecordByMemberDate.has(attendanceRecordKey)
  });
}

export function getAttendanceRecordLiteFromContext(input: {
  context: ExpectedAttendanceSupabaseContext;
  memberId: string;
  date: string;
}) {
  const key = buildAttendanceRecordKey(
    String(input.memberId ?? "").trim(),
    normalizeOperationalDateOnly(input.date)
  );
  return input.context.attendanceRecordByMemberDate.get(key) ?? null;
}
