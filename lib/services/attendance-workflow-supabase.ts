import { ATTENDANCE_ABSENCE_REASON_OPTIONS } from "@/lib/canonical";
import { resolveAttendanceLatePickupChargePlanSupabase } from "@/lib/services/ancillary-write-supabase";
import { resolveAttendanceBillingSyncPlan } from "@/lib/services/billing-supabase";
import {
  loadExpectedAttendanceSupabaseContext,
  resolveExpectedAttendanceFromSupabaseContext
} from "@/lib/services/expected-attendance-supabase";
import { getRequiredMemberAttendanceScheduleSupabase } from "@/lib/services/member-command-center-write";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { createClient } from "@/lib/supabase/server";
import { easternDateTimeLocalToISO, toEasternISO } from "@/lib/timezone";
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
  billing_status: "Unbilled" | "Billed" | "Excluded" | null;
  notes: string | null;
};

export type ApplyMakeupBalanceDeltaWithAuditResult = {
  applied: boolean;
  previousBalance: number | null;
  nextBalance: number | null;
};

type AttendanceScheduleRow = {
  id: string;
  member_id: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  make_up_days_available: number | null;
};

type SaveAttendanceWorkflowRpcRow = {
  attendance_record_id: string | null;
  member_id: string;
  attendance_date: string;
  status: "present" | "absent" | null;
  absent_reason: string | null;
  absent_reason_other: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  linked_adjustment_id: string | null;
  billing_status: "Unbilled" | "Billed" | "Excluded" | null;
  notes: string | null;
};

const SAVE_ATTENDANCE_WORKFLOW_RPC = "rpc_save_attendance_workflow";
const SAVE_ATTENDANCE_WORKFLOW_MIGRATION = "0193_attendance_workflow_atomic_rpc.sql";

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

function resolveAttendanceTimestamp(input: {
  attendanceDate: string;
  localDateTime: string;
  localTime: string;
  fallbackIso: string;
}) {
  if (input.localDateTime) {
    return easternDateTimeLocalToISO(input.localDateTime);
  }
  if (input.localTime) {
    return easternDateTimeLocalToISO(`${input.attendanceDate}T${input.localTime}`);
  }
  return input.fallbackIso;
}

function mapSaveAttendanceWorkflowRpcRow(row: SaveAttendanceWorkflowRpcRow | null) {
  if (!row?.attendance_record_id || !row.status) {
    return null;
  }

  return {
    id: row.attendance_record_id,
    member_id: row.member_id,
    attendance_date: row.attendance_date,
    status: row.status,
    absent_reason: row.absent_reason,
    absent_reason_other: row.absent_reason_other,
    check_in_at: row.check_in_at,
    check_out_at: row.check_out_at,
    linked_adjustment_id: row.linked_adjustment_id,
    billing_status: row.billing_status,
    notes: row.notes
  } satisfies AttendanceRecordRow;
}

async function getMemberAttendanceScheduleSupabase(memberId: string) {
  const schedule = await getRequiredMemberAttendanceScheduleSupabase(memberId);
  if (!schedule) {
    throw new Error(`Unable to resolve attendance schedule for member ${memberId}.`);
  }

  return {
    id: schedule.id,
    member_id: schedule.member_id,
    monday: Boolean(schedule.monday),
    tuesday: Boolean(schedule.tuesday),
    wednesday: Boolean(schedule.wednesday),
    thursday: Boolean(schedule.thursday),
    friday: Boolean(schedule.friday),
    make_up_days_available: schedule.make_up_days_available ?? 0
  } satisfies AttendanceScheduleRow;
}

async function resolveMemberExpectedAttendanceForDateSupabase(input: {
  memberId: string;
  attendanceDate: string;
  hasUnscheduledAttendanceAddition?: boolean;
}) {
  const [schedule, context] = await Promise.all([
    getMemberAttendanceScheduleSupabase(input.memberId),
    loadExpectedAttendanceSupabaseContext({
      memberIds: [input.memberId],
      startDate: input.attendanceDate,
      endDate: input.attendanceDate,
      includeAttendanceRecords: false
    })
  ]);

  return {
    schedule,
    resolution: resolveExpectedAttendanceFromSupabaseContext({
      context,
      memberId: input.memberId,
      date: input.attendanceDate,
      baseScheduleOverride: schedule,
      hasUnscheduledAttendanceAddition: input.hasUnscheduledAttendanceAddition
    })
  };
}

function isMissingRpcFunctionError(error: unknown, rpcName: string) {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return (code === "42883" || code === "PGRST202") && message.includes(rpcName);
}

async function saveAttendanceWorkflowMutationSupabase(input: {
  memberId: string;
  attendanceDate: string;
  operation: "clear" | "present" | "absent" | "check-in" | "check-out" | "unscheduled";
  deleteRecord?: boolean;
  status?: "present" | "absent";
  absentReason?: string | null;
  absentReasonOther?: string | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  notes?: string | null;
  isScheduledDay: boolean;
  makeupScheduleId?: string | null;
  useMakeupDay?: boolean;
  shouldHaveExtraDayAdjustment?: boolean;
  extraDayRate?: number;
  latePickupTime?: string | null;
  latePickupFeeCents?: number;
  actor: { id: string; full_name: string; role: AppRole };
  at: string;
}) {
  const supabase = await createClient();
  let data: SaveAttendanceWorkflowRpcRow[] | null;
  try {
    data = await invokeSupabaseRpcOrThrow<SaveAttendanceWorkflowRpcRow[] | null>(
      supabase,
      SAVE_ATTENDANCE_WORKFLOW_RPC,
      {
        p_member_id: input.memberId,
        p_attendance_date: input.attendanceDate,
        p_operation: input.operation,
        p_delete_record: Boolean(input.deleteRecord),
        p_status: input.status ?? null,
        p_absent_reason: input.absentReason ?? null,
        p_absent_reason_other: input.absentReasonOther ?? null,
        p_check_in_at: input.checkInAt ?? null,
        p_check_out_at: input.checkOutAt ?? null,
        p_notes: input.notes ?? null,
        p_is_scheduled_day: input.isScheduledDay,
        p_makeup_schedule_id: input.makeupScheduleId ?? null,
        p_use_makeup_day: Boolean(input.useMakeupDay),
        p_should_have_extra_day_adjustment: Boolean(input.shouldHaveExtraDayAdjustment),
        p_extra_day_rate: input.extraDayRate ?? 0,
        p_late_pickup_time: input.latePickupTime ?? null,
        p_late_pickup_fee_cents: input.latePickupFeeCents ?? 0,
        p_actor_user_id: actorUserIdOrNull(input.actor.id),
        p_actor_role: input.actor.role,
        p_actor_name: input.actor.full_name,
        p_now: input.at
      }
    );
  } catch (error) {
    if (isMissingRpcFunctionError(error, SAVE_ATTENDANCE_WORKFLOW_RPC)) {
      throw new Error(
        `Attendance save workflow RPC is not available. Apply Supabase migration ${SAVE_ATTENDANCE_WORKFLOW_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] ?? null : null;
  return mapSaveAttendanceWorkflowRpcRow(row);
}

export async function getAttendanceRecordSupabase(memberId: string, attendanceDate: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .select("id, member_id, attendance_date, status, absent_reason, absent_reason_other, check_in_at, check_out_at, linked_adjustment_id, billing_status, notes")
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
      .select("id, member_id, attendance_date, status, absent_reason, absent_reason_other, check_in_at, check_out_at, linked_adjustment_id, billing_status, notes")
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
    .select("id, member_id, attendance_date, status, absent_reason, absent_reason_other, check_in_at, check_out_at, linked_adjustment_id, billing_status, notes")
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
  const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, "apply_makeup_balance_delta_with_audit", {
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

export async function saveAttendanceStatusWorkflowSupabase(input: {
  memberId: string;
  attendanceDate: string;
  requestedStatus: string;
  absentReason: string;
  absentReasonOther: string;
  checkInAtLocal: string;
  checkOutAtLocal: string;
  checkInTime: string;
  checkOutTime: string;
  actor: { id: string; full_name: string; role: AppRole };
}) {
  const requestedStatus = input.requestedStatus.toLowerCase();
  if (
    requestedStatus !== "present" &&
    requestedStatus !== "absent" &&
    requestedStatus !== "clear" &&
    requestedStatus !== "check-in" &&
    requestedStatus !== "check-out"
  ) {
    throw new Error("Invalid attendance status.");
  }

  const existing = await getAttendanceRecordSupabase(input.memberId, input.attendanceDate);
  const { resolution, schedule } = await resolveMemberExpectedAttendanceForDateSupabase({
    memberId: input.memberId,
    attendanceDate: input.attendanceDate
  });
  const now = toEasternISO();

  if (requestedStatus === "clear") {
    return saveAttendanceWorkflowMutationSupabase({
      memberId: input.memberId,
      attendanceDate: input.attendanceDate,
      operation: "clear",
      deleteRecord: true,
      isScheduledDay: resolution.isScheduled,
      makeupScheduleId: schedule.id,
      actor: input.actor,
      at: now
    });
  }

  if (requestedStatus === "absent") {
    if (
      !input.absentReason ||
      !ATTENDANCE_ABSENCE_REASON_OPTIONS.includes(
        input.absentReason as (typeof ATTENDANCE_ABSENCE_REASON_OPTIONS)[number]
      )
    ) {
      throw new Error("Absent reason is required.");
    }
    if (input.absentReason === "Other" && !input.absentReasonOther.trim()) {
      throw new Error("Custom absent reason is required when Other is selected.");
    }

    return saveAttendanceWorkflowMutationSupabase({
      memberId: input.memberId,
      attendanceDate: input.attendanceDate,
      operation: "absent",
      status: "absent",
      absentReason: input.absentReason,
      absentReasonOther: input.absentReason === "Other" ? input.absentReasonOther.trim() : null,
      checkInAt: null,
      checkOutAt: null,
      notes: null,
      isScheduledDay: resolution.isScheduled,
      makeupScheduleId: schedule.id,
      actor: input.actor,
      at: now
    });
  }

  const checkInAt =
    requestedStatus === "check-out"
      ? existing?.check_in_at ?? null
      : resolveAttendanceTimestamp({
          attendanceDate: input.attendanceDate,
          localDateTime: input.checkInAtLocal,
          localTime: input.checkInTime,
          fallbackIso: existing?.check_in_at ?? now
        });
  const checkOutAt =
    requestedStatus === "check-in"
      ? existing?.check_out_at ?? null
      : requestedStatus === "present"
        ? existing?.check_out_at ?? null
        : resolveAttendanceTimestamp({
            attendanceDate: input.attendanceDate,
            localDateTime: input.checkOutAtLocal,
            localTime: input.checkOutTime,
            fallbackIso: existing?.check_out_at ?? now
          });

  const [billingSyncSpec, latePickupSyncSpec] = await Promise.all([
    resolveAttendanceBillingSyncPlan({
      memberId: input.memberId,
      attendanceDate: input.attendanceDate,
      attendanceStatus: "present"
    }),
    resolveAttendanceLatePickupChargePlanSupabase({
      checkOutAt
    })
  ]);

  return saveAttendanceWorkflowMutationSupabase({
    memberId: input.memberId,
    attendanceDate: input.attendanceDate,
    operation:
      requestedStatus === "check-in" || requestedStatus === "check-out" ? requestedStatus : "present",
    status: "present",
    absentReason: null,
    absentReasonOther: null,
    checkInAt,
    checkOutAt,
    notes: null,
    isScheduledDay: resolution.isScheduled,
    makeupScheduleId: schedule.id,
    shouldHaveExtraDayAdjustment: billingSyncSpec.shouldHaveExtraDayAdjustment,
    extraDayRate: billingSyncSpec.extraDayRate,
    latePickupTime: latePickupSyncSpec.latePickupTime,
    latePickupFeeCents: Math.round(latePickupSyncSpec.amount * 100),
    actor: input.actor,
    at: now
  });
}

export async function saveUnscheduledAttendanceWorkflowSupabase(input: {
  memberId: string;
  attendanceDate: string;
  useMakeupDay: boolean;
  checkInTime: string;
  actor: { id: string; full_name: string; role: AppRole };
}) {
  const activeMemberId = await getActiveMemberIdSupabase(input.memberId);
  if (!activeMemberId) {
    throw new Error("Active member not found.");
  }

  const { schedule, resolution } = await resolveMemberExpectedAttendanceForDateSupabase({
    memberId: input.memberId,
    attendanceDate: input.attendanceDate
  });
  if (resolution.blockedBy === "member-hold") {
    throw new Error("Member is on hold for this date.");
  }
  if (resolution.blockedBy === "center-closure") {
    throw new Error("Center is closed for this date.");
  }
  if (resolution.isScheduled) {
    throw new Error("Member is already scheduled on this date. Use the Daily Attendance roster.");
  }

  const now = toEasternISO();
  const existing = await getAttendanceRecordSupabase(input.memberId, input.attendanceDate);
  const checkInAt = existing?.check_in_at
    ? existing.check_in_at
    : resolveAttendanceTimestamp({
        attendanceDate: input.attendanceDate,
        localDateTime: "",
        localTime: input.checkInTime,
        fallbackIso: now
      });
  const checkOutAt = existing?.check_out_at ?? null;
  const [billingSyncSpec, latePickupSyncSpec] = await Promise.all([
    resolveAttendanceBillingSyncPlan({
      memberId: input.memberId,
      attendanceDate: input.attendanceDate,
      attendanceStatus: "present"
    }),
    resolveAttendanceLatePickupChargePlanSupabase({
      checkOutAt
    })
  ]);

  const saved = await saveAttendanceWorkflowMutationSupabase({
    memberId: input.memberId,
    attendanceDate: input.attendanceDate,
    operation: "unscheduled",
    status: "present",
    absentReason: null,
    absentReasonOther: null,
    checkInAt,
    checkOutAt,
    notes: "Unscheduled attendance",
    isScheduledDay: false,
    makeupScheduleId: schedule.id,
    useMakeupDay: input.useMakeupDay,
    shouldHaveExtraDayAdjustment: billingSyncSpec.shouldHaveExtraDayAdjustment,
    extraDayRate: billingSyncSpec.extraDayRate,
    latePickupTime: latePickupSyncSpec.latePickupTime,
    latePickupFeeCents: Math.round(latePickupSyncSpec.amount * 100),
    actor: input.actor,
    at: now
  });

  if (!saved) {
    throw new Error("Attendance record could not be saved.");
  }
  return saved;
}
