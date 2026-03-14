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

export type ApplyMakeupBalanceDeltaWithAuditResult = {
  applied: boolean;
  previousBalance: number | null;
  nextBalance: number | null;
};

function isUuid(value: string | null | undefined) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

function actorUserIdOrNull(value: string | null | undefined) {
  return isUuid(value) ? String(value) : null;
}

function toFiniteNumberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
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

export async function applyMakeupBalanceDeltaWithAuditSupabase(input: {
  scheduleId: string;
  memberId: string;
  attendanceDate: string;
  deltaDays: number;
  source: string;
  actor: { id: string; full_name: string; role: AppRole };
  at: string;
  failIfInsufficient?: boolean;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_makeup_balance_delta_with_audit", {
    p_schedule_id: input.scheduleId,
    p_member_id: input.memberId,
    p_attendance_date: input.attendanceDate,
    p_delta_days: input.deltaDays,
    p_source: input.source,
    p_actor_user_id: actorUserIdOrNull(input.actor.id),
    p_actor_role: input.actor.role,
    p_actor_name: input.actor.full_name,
    p_at: input.at,
    p_fail_if_insufficient: Boolean(input.failIfInsufficient)
  });
  if (error) throw new Error(error.message);

  const payload = data as { applied?: unknown; previousBalance?: unknown; nextBalance?: unknown } | null;
  return {
    applied: Boolean(payload?.applied),
    previousBalance: toFiniteNumberOrNull(payload?.previousBalance),
    nextBalance: toFiniteNumberOrNull(payload?.nextBalance)
  } satisfies ApplyMakeupBalanceDeltaWithAuditResult;
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
