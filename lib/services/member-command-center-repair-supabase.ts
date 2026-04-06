import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  defaultAttendanceSchedule,
  defaultCommandCenter,
  isMissingAnyColumnError
} from "@/lib/services/member-command-center-core";
import { selectMembersWithFallback } from "@/lib/services/member-command-center-member-queries";

export async function backfillMissingMemberCommandCenterRowsSupabase(memberIds: Array<string | null | undefined>) {
  const normalizedMemberIds = Array.from(
    new Set(
      memberIds
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
  if (normalizedMemberIds.length === 0) {
    return {
      commandCentersInserted: 0,
      schedulesInserted: 0
    };
  }

  const supabase = await createClient();
  const targetMembers = await selectMembersWithFallback(
    (selectClause) => supabase.from("members").select(selectClause).in("id", normalizedMemberIds),
    isMissingAnyColumnError,
    "Unable to query members for Member Command Center backfill."
  );
  if (targetMembers.length === 0) {
    return {
      commandCentersInserted: 0,
      schedulesInserted: 0
    };
  }

  const writeSupabase = createServiceRoleClient("member_command_center_service_write");
  const targetMemberIds = targetMembers.map((member) => member.id);
  const [{ data: existingCommandCenters, error: commandCentersError }, { data: existingSchedules, error: schedulesError }] =
    await Promise.all([
      writeSupabase.from("member_command_centers").select("member_id").in("member_id", targetMemberIds),
      writeSupabase.from("member_attendance_schedules").select("member_id").in("member_id", targetMemberIds)
    ]);
  if (commandCentersError) throw new Error(commandCentersError.message);
  if (schedulesError) throw new Error(schedulesError.message);

  const existingCommandCenterIds = new Set(
    ((existingCommandCenters ?? []) as Array<{ member_id: string }>).map((row) => row.member_id)
  );
  const existingScheduleIds = new Set(((existingSchedules ?? []) as Array<{ member_id: string }>).map((row) => row.member_id));

  const missingCommandCenters = targetMembers
    .filter((member) => !existingCommandCenterIds.has(member.id))
    .map((member) => defaultCommandCenter(member.id));
  const missingSchedules = targetMembers
    .filter((member) => !existingScheduleIds.has(member.id))
    .map((member) => defaultAttendanceSchedule(member));

  if (missingCommandCenters.length > 0) {
    const { error: insertCommandCentersError } = await writeSupabase.from("member_command_centers").insert(missingCommandCenters);
    if (insertCommandCentersError) throw new Error(insertCommandCentersError.message);
  }
  if (missingSchedules.length > 0) {
    const { error: insertSchedulesError } = await writeSupabase.from("member_attendance_schedules").insert(missingSchedules);
    if (insertSchedulesError) throw new Error(insertSchedulesError.message);
  }

  return {
    commandCentersInserted: missingCommandCenters.length,
    schedulesInserted: missingSchedules.length
  };
}
