import {
  MAR_NOT_GIVEN_REASON_OPTIONS,
  MAR_PRN_OUTCOME_OPTIONS,
  type MarAdministrationHistoryRow,
  type MarNotGivenReason,
  type MarPrnOutcome,
  type MarTodayRow
} from "@/lib/services/mar-shared";
import {
  buildMissingSchemaColumnMessage,
  buildMissingSchemaMessage,
  isMissingSchemaColumnError,
  isMissingSchemaObjectError
} from "@/lib/supabase/schema-errors";
import type { WorkflowMilestoneResult } from "@/lib/services/lifecycle-milestones";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import { toEasternDate } from "@/lib/timezone";

const TIME_24H_PATTERN = /^(\d{1,2}):(\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GENERATION_DAYS = 45;
const MAR_BASE_SCHEMA_MIGRATION = "0028_pof_seeded_mar_workflow.sql";
const MAR_NOT_GIVEN_VIEW_ALIGNMENT_MIGRATION = "0103_mar_not_given_view_alignment.sql";
const MAR_PRN_VIEW_ALIGNMENT_MIGRATION = "0104_mar_prn_view_alignment.sql";
const MAR_OVERDUE_VIEW_MIGRATION = "0030_mar_overdue_view.sql";
const MHP_MEDICATIONS_MIGRATION = "0012_legacy_operational_health_alignment.sql";

export type MemberPhotoRow = {
  member_id: string;
  profile_image_url: string | null;
};

export type MarFollowUpAlertResult = {
  delivered: boolean;
  followUpNeeded: boolean;
  deliveryState: WorkflowMilestoneResult["deliveryState"];
  failureReason: string | null;
  repairRecordTable: "system_events" | null;
};

export type MarSchemaObjectName =
  | "pof_medications"
  | "mar_schedules"
  | "mar_administrations"
  | "member_medications"
  | "member_command_centers"
  | "v_mar_today"
  | "v_mar_overdue_today"
  | "v_mar_not_given_today"
  | "v_mar_administration_history"
  | "v_mar_prn_log"
  | "v_mar_prn_given_awaiting_outcome"
  | "v_mar_prn_effective"
  | "v_mar_prn_ineffective";

function toSupabaseErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Unknown Supabase error.";
  const candidate = error as { message?: string };
  if (typeof candidate.message === "string" && candidate.message.trim().length > 0) {
    return candidate.message;
  }
  return "Unknown Supabase error.";
}

export function clean(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

export function toMarFollowUpAlertResult(milestone: WorkflowMilestoneResult): MarFollowUpAlertResult {
  return {
    delivered: milestone.delivered,
    followUpNeeded: milestone.followUpNeeded,
    deliveryState: milestone.deliveryState,
    failureReason: milestone.failureReason,
    repairRecordTable: milestone.followUpNeeded ? "system_events" : null
  };
}

export async function recordMarFollowUpRepairAlert(input: {
  entityType: string;
  entityId: string;
  actorUserId?: string | null;
  alertKey: string;
  failureReason: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  await recordImmediateSystemAlert({
    entityType: input.entityType,
    entityId: input.entityId,
    actorUserId: input.actorUserId ?? null,
    severity: "high",
    alertKey: input.alertKey,
    metadata: {
      source_event_type: "action_required",
      notification_error: input.failureReason,
      ...(input.metadata ?? {})
    }
  });

  return {
    delivered: false,
    followUpNeeded: true,
    deliveryState: "failed",
    failureReason: input.failureReason,
    repairRecordTable: "system_events"
  } satisfies MarFollowUpAlertResult;
}

export function toMemberPhotoLookup(rows: MemberPhotoRow[]): Map<string, string | null> {
  return new Map(rows.map((row) => [row.member_id, clean(row.profile_image_url)] as const));
}

export function throwMarSupabaseError(error: unknown, objectName: MarSchemaObjectName) {
  if (!error) return;
  const isPrnViewColumnDrift =
    (objectName === "v_mar_prn_log" ||
      objectName === "v_mar_prn_given_awaiting_outcome" ||
      objectName === "v_mar_prn_effective" ||
      objectName === "v_mar_prn_ineffective") &&
    isMissingSchemaColumnError(error);
  const migration =
    objectName === "v_mar_overdue_today"
      ? MAR_OVERDUE_VIEW_MIGRATION
      : objectName === "v_mar_not_given_today" && isMissingSchemaColumnError(error, objectName)
        ? MAR_NOT_GIVEN_VIEW_ALIGNMENT_MIGRATION
        : isPrnViewColumnDrift
          ? MAR_PRN_VIEW_ALIGNMENT_MIGRATION
      : objectName === "member_medications"
        ? MHP_MEDICATIONS_MIGRATION
        : MAR_BASE_SCHEMA_MIGRATION;
  if (
    (objectName === "v_mar_not_given_today" && isMissingSchemaColumnError(error, objectName)) ||
    isPrnViewColumnDrift
  ) {
    throw new Error(
      `${buildMissingSchemaColumnMessage({
        objectName,
        migration
      })} Original error: ${toSupabaseErrorMessage(error)}`
    );
  }
  if (isMissingSchemaObjectError(error)) {
    throw new Error(
      `${buildMissingSchemaMessage({
        objectName,
        migration
      })} Original error: ${toSupabaseErrorMessage(error)}`
    );
  }
  throw new Error(toSupabaseErrorMessage(error));
}

export function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
    if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  }
  return fallback;
}

function toDateValue(value: unknown): string | null {
  const normalized = clean(value);
  if (!normalized) return null;
  return DATE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeTime24h(value: string | null | undefined): string | null {
  const normalized = clean(value);
  if (!normalized) return null;
  const match = TIME_24H_PATTERN.exec(normalized);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizeScheduledTimes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((entry) => normalizeTime24h(typeof entry === "string" ? entry : null))
          .filter((entry): entry is string => Boolean(entry))
      )
    );
  }

  const text = clean(value);
  if (!text) return [];
  return Array.from(
    new Set(
      text
        .split(/[;,]/g)
        .map((entry) => normalizeTime24h(entry))
        .filter((entry): entry is string => Boolean(entry))
    )
  );
}

function compareDate(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function addDays(dateValue: string, days: number): string {
  const [yearRaw, monthRaw, dayRaw] = dateValue.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const seed = new Date(Date.UTC(year, month - 1, day));
  seed.setUTCDate(seed.getUTCDate() + days);
  return `${seed.getUTCFullYear()}-${String(seed.getUTCMonth() + 1).padStart(2, "0")}-${String(seed.getUTCDate()).padStart(2, "0")}`;
}

export function normalizeGenerationWindow(startDate?: string | null, endDate?: string | null) {
  const today = toEasternDate();
  const rawStart = toDateValue(startDate) ?? today;
  const rawEnd = toDateValue(endDate) ?? rawStart;
  const orderedStart = compareDate(rawStart, rawEnd) <= 0 ? rawStart : rawEnd;
  const orderedEnd = compareDate(rawStart, rawEnd) <= 0 ? rawEnd : rawStart;
  const start = compareDate(orderedStart, today) < 0 ? today : orderedStart;
  const maxEnd = addDays(start, MAX_GENERATION_DAYS);
  const end = compareDate(orderedEnd, maxEnd) > 0 ? maxEnd : orderedEnd;
  return { startDate: start, endDate: end };
}

export function isDateWithinMedicationWindow(dateValue: string, startDate?: string | null, endDate?: string | null) {
  if (startDate && compareDate(startDate, dateValue) > 0) return false;
  if (endDate && compareDate(endDate, dateValue) < 0) return false;
  return true;
}

export function mapMarHistoryRow(row: Record<string, unknown>): MarAdministrationHistoryRow | null {
  const id = clean(row.id);
  const memberId = clean(row.member_id);
  const memberName = clean(row.member_name);
  const pofMedicationId = clean(row.pof_medication_id);
  const administrationDate = clean(row.administration_date);
  const medicationName = clean(row.medication_name);
  const status = clean(row.status);
  const administeredBy = clean(row.administered_by);
  const administeredAt = clean(row.administered_at);
  const source = clean(row.source);
  const createdAt = clean(row.created_at);
  const updatedAt = clean(row.updated_at);

  if (
    !id ||
    !memberId ||
    !memberName ||
    !pofMedicationId ||
    !administrationDate ||
    !medicationName ||
    (status !== "Given" && status !== "Not Given") ||
    !administeredBy ||
    !administeredAt ||
    (source !== "scheduled" && source !== "prn") ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  const notGivenReasonRaw = clean(row.not_given_reason);
  const notGivenReason = MAR_NOT_GIVEN_REASON_OPTIONS.includes(notGivenReasonRaw as MarNotGivenReason)
    ? (notGivenReasonRaw as MarNotGivenReason)
    : null;

  const prnOutcomeRaw = clean(row.prn_outcome);
  const prnOutcome = MAR_PRN_OUTCOME_OPTIONS.includes(prnOutcomeRaw as MarPrnOutcome)
    ? (prnOutcomeRaw as MarPrnOutcome)
    : null;

  return {
    id,
    memberId,
    memberName,
    medicationOrderId: null,
    pofMedicationId,
    marScheduleId: clean(row.mar_schedule_id),
    administrationDate,
    scheduledTime: clean(row.scheduled_time),
    medicationName,
    dose: clean(row.dose),
    route: clean(row.route),
    status,
    prnReason: clean(row.prn_reason),
    notGivenReason,
    prnOutcome,
    prnOutcomeAssessedAt: clean(row.prn_outcome_assessed_at),
    prnFollowupNote: clean(row.prn_followup_note),
    followupDueAt: null,
    followupStatus: null,
    requiresFollowup: source === "prn",
    notes: clean(row.notes),
    administeredBy,
    administeredByUserId: clean(row.administered_by_user_id),
    administeredAt,
    source,
    createdAt,
    updatedAt
  };
}

export function mapMarTodayRow(row: Record<string, unknown>): MarTodayRow | null {
  const marScheduleId = clean(row.mar_schedule_id);
  const memberId = clean(row.member_id);
  const memberName = clean(row.member_name);
  const pofMedicationId = clean(row.pof_medication_id);
  const medicationName = clean(row.medication_name);
  const scheduledTime = clean(row.scheduled_time);

  if (!marScheduleId || !memberId || !memberName || !pofMedicationId || !medicationName || !scheduledTime) return null;

  const statusRaw = clean(row.status);
  const status = statusRaw === "Given" || statusRaw === "Not Given" ? statusRaw : null;
  const notGivenReasonRaw = clean(row.not_given_reason);
  const notGivenReason = MAR_NOT_GIVEN_REASON_OPTIONS.includes(notGivenReasonRaw as MarNotGivenReason)
    ? (notGivenReasonRaw as MarNotGivenReason)
    : null;
  const sourceRaw = clean(row.source);
  const source = sourceRaw === "scheduled" || sourceRaw === "prn" ? sourceRaw : null;

  return {
    marScheduleId,
    memberId,
    memberName,
    memberPhotoUrl: clean(row.member_photo_url),
    pofMedicationId,
    medicationName,
    dose: clean(row.dose),
    route: clean(row.route),
    frequency: clean(row.frequency),
    instructions: clean(row.instructions),
    scheduledTime,
    prn: toBoolean(row.prn, false),
    administrationId: clean(row.administration_id),
    status,
    notGivenReason,
    prnReason: clean(row.prn_reason),
    notes: clean(row.notes),
    administeredBy: clean(row.administered_by),
    administeredByUserId: clean(row.administered_by_user_id),
    administeredAt: clean(row.administered_at),
    source,
    completed: Boolean(status)
  };
}
