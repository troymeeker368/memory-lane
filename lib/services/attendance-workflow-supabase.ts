import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/types/app";

export type AttendanceRecordRow = {
  id: string;
  member_id: string;
  attendance_date: string;
  status: "present" | "absent";
  absent_reason: string | null;
  absent_reason_other: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  linked_adjustment_id: string | null;
};

function isUuid(value: string | null | undefined) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

function actorUserIdOrNull(value: string | null | undefined) {
  return isUuid(value) ? String(value) : null;
}

export async function getAttendanceRecordSupabase(memberId: string, attendanceDate: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .select("id, member_id, attendance_date, status, absent_reason, absent_reason_other, check_in_at, check_out_at, linked_adjustment_id")
    .eq("member_id", memberId)
    .eq("attendance_date", attendanceDate)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AttendanceRecordRow | null) ?? null;
}

export async function upsertAttendanceRecordSupabase(input: {
  existing: AttendanceRecordRow | null;
  memberId: string;
  attendanceDate: string;
  status: "present" | "absent";
  absentReason: string | null;
  absentReasonOther: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  notes: string | null;
  actor: { id: string; full_name: string };
  at: string;
}) {
  const supabase = await createClient();
  if (input.existing) {
    const { data, error } = await supabase
      .from("attendance_records")
      .update({
        status: input.status,
        absent_reason: input.absentReason,
        absent_reason_other: input.absentReasonOther,
        check_in_at: input.checkInAt,
        check_out_at: input.checkOutAt,
        notes: input.notes,
        recorded_by_user_id: actorUserIdOrNull(input.actor.id),
        recorded_by_name: input.actor.full_name,
        updated_at: input.at
      })
      .eq("id", input.existing.id)
      .select("id, member_id, attendance_date, status, absent_reason, absent_reason_other, check_in_at, check_out_at, linked_adjustment_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as AttendanceRecordRow | null) ?? null;
  }

  const { data, error } = await supabase
    .from("attendance_records")
    .insert({
      member_id: input.memberId,
      attendance_date: input.attendanceDate,
      status: input.status,
      absent_reason: input.absentReason,
      absent_reason_other: input.absentReasonOther,
      check_in_at: input.checkInAt,
      check_out_at: input.checkOutAt,
      notes: input.notes,
      recorded_by_user_id: actorUserIdOrNull(input.actor.id),
      recorded_by_name: input.actor.full_name,
      created_at: input.at,
      updated_at: input.at
    })
    .select("id, member_id, attendance_date, status, absent_reason, absent_reason_other, check_in_at, check_out_at, linked_adjustment_id")
    .single();
  if (error) throw new Error(error.message);
  return data as AttendanceRecordRow;
}

export async function deleteAttendanceRecordSupabase(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("attendance_records").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setBillingAdjustmentExcludedSupabase(input: { id: string; updatedAt: string }) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("billing_adjustments")
    .update({
      billing_status: "Excluded",
      invoice_id: null,
      updated_at: input.updatedAt
    })
    .eq("id", input.id);
  if (error) throw new Error(error.message);
}

export async function updateScheduleMakeupBalanceSupabase(input: {
  scheduleId: string;
  makeUpDaysAvailable: number;
  actor: { id: string; full_name: string };
  at: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("member_attendance_schedules")
    .update({
      make_up_days_available: input.makeUpDaysAvailable,
      updated_by_user_id: actorUserIdOrNull(input.actor.id),
      updated_by_name: input.actor.full_name,
      updated_at: input.at
    })
    .eq("id", input.scheduleId);
  if (error) throw new Error(error.message);
}

export async function writeMakeupAuditLogSupabase(input: {
  memberId: string;
  attendanceDate: string;
  deltaDays: number;
  source: string;
  actorUserId: string | null;
  actorRole: AppRole;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("audit_logs").insert({
    actor_user_id: input.actorUserId,
    actor_role: input.actorRole,
    action: "manager_review",
    entity_type: "makeup_day",
    entity_id: input.memberId,
    details: {
      attendanceDate: input.attendanceDate,
      deltaDays: input.deltaDays,
      source: input.source
    }
  });
  if (error) throw new Error(error.message);
}

export async function getActiveMemberIdSupabase(memberId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .select("id")
    .eq("id", memberId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}
