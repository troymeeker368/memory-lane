import "server-only";

import type { ReportDateRange } from "@/lib/services/report-date-range";
import {
  type ReportingAttendanceRow,
  type ReportingClosureRow,
  type ReportingLocationRow,
  type ReportingMemberRow
} from "@/lib/services/admin-reporting-core";
import { loadExpectedAttendanceSupabaseContext } from "@/lib/services/expected-attendance-supabase";
import { createClient } from "@/lib/supabase/server";

export type ReportingMemberStatusFilter = "active" | "inactive" | "all";

export interface ReportingAttendanceDataset {
  members: ReportingMemberRow[];
  memberLocationById: Map<string, string>;
  attendanceRecordByMemberDate: Map<string, "present" | "absent">;
  closureByDate: Map<string, ReportingClosureRow>;
  expectedContext: Awaited<ReturnType<typeof loadExpectedAttendanceSupabaseContext>>;
}

export async function loadReportingAttendanceDataset(input: {
  range: ReportDateRange;
  memberStatus: ReportingMemberStatusFilter;
}): Promise<ReportingAttendanceDataset> {
  const supabase = await createClient();
  let memberQuery = supabase
    .from("members")
    .select("id, display_name, status")
    .order("display_name", { ascending: true });
  if (input.memberStatus !== "all") {
    memberQuery = memberQuery.eq("status", input.memberStatus);
  }
  const { data: membersData, error: membersError } = await memberQuery;
  if (membersError) throw new Error(membersError.message);

  const members = (membersData ?? []) as ReportingMemberRow[];
  const memberIds = members.map((row) => row.id);

  if (memberIds.length === 0) {
    return {
      members,
      memberLocationById: new Map<string, string>(),
      attendanceRecordByMemberDate: new Map<string, "present" | "absent">(),
      closureByDate: new Map<string, ReportingClosureRow>(),
      expectedContext: await loadExpectedAttendanceSupabaseContext({
        memberIds: [],
        startDate: input.range.from,
        endDate: input.range.to,
        includeAttendanceRecords: false
      })
    };
  }

  const [locationsResult, attendanceResult, closureResult, expectedContext] = await Promise.all([
    supabase.from("member_command_centers").select("member_id, location").in("member_id", memberIds),
    supabase
      .from("attendance_records")
      .select("member_id, attendance_date, status")
      .in("member_id", memberIds)
      .gte("attendance_date", input.range.from)
      .lte("attendance_date", input.range.to),
    supabase
      .from("center_closures")
      .select("closure_date, active, billable_override")
      .gte("closure_date", input.range.from)
      .lte("closure_date", input.range.to),
    loadExpectedAttendanceSupabaseContext({
      memberIds,
      startDate: input.range.from,
      endDate: input.range.to,
      includeAttendanceRecords: false
    })
  ]);
  if (locationsResult.error) throw new Error(locationsResult.error.message);
  if (attendanceResult.error) throw new Error(attendanceResult.error.message);
  if (closureResult.error) throw new Error(closureResult.error.message);

  const memberLocationById = new Map<string, string>();
  ((locationsResult.data ?? []) as ReportingLocationRow[]).forEach((row) => {
    memberLocationById.set(row.member_id, String(row.location ?? "").trim() || "Unassigned");
  });
  members.forEach((member) => {
    if (!memberLocationById.has(member.id)) {
      memberLocationById.set(member.id, "Unassigned");
    }
  });

  const attendanceRecordByMemberDate = new Map<string, "present" | "absent">();
  ((attendanceResult.data ?? []) as ReportingAttendanceRow[]).forEach((row) => {
    attendanceRecordByMemberDate.set(`${row.member_id}:${row.attendance_date}`, row.status);
  });

  const closureByDate = new Map<string, ReportingClosureRow>();
  ((closureResult.data ?? []) as ReportingClosureRow[]).forEach((row) => {
    closureByDate.set(row.closure_date, row);
  });

  return {
    members,
    memberLocationById,
    attendanceRecordByMemberDate,
    closureByDate,
    expectedContext
  };
}
