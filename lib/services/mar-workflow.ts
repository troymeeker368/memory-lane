import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import {
  MAR_NOT_GIVEN_REASON_OPTIONS,
  MAR_PRN_OUTCOME_OPTIONS,
  type MarAdministrationHistoryRow,
  type MarNotGivenReason,
  type MarPrnOption,
  type MarPrnOutcome,
  type MarTodayRow,
  type MarWorkflowSnapshot
} from "@/lib/services/mar-shared";
import { createClient } from "@/lib/supabase/server";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
import { buildMissingSchemaMessage, isMissingSchemaObjectError } from "@/lib/supabase/schema-errors";
import { easternDateTimeLocalToISO, toEasternDate, toEasternISO } from "@/lib/timezone";

export { MAR_NOT_GIVEN_REASON_OPTIONS, MAR_PRN_OUTCOME_OPTIONS };
export type {
  MarAdministrationHistoryRow,
  MarNotGivenReason,
  MarPrnOption,
  MarPrnOutcome,
  MarTodayRow,
  MarWorkflowSnapshot
};

type PhysicianOrderForSyncRow = {
  id: string;
  member_id: string;
  status: string;
};

type PofMedicationRow = {
  id: string;
  member_id: string;
  medication_name: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  instructions: string | null;
  prn: boolean | null;
  active: boolean | null;
  given_at_center: boolean | null;
  scheduled_times: string[] | null;
  start_date: string | null;
  end_date: string | null;
};

type MemberMedicationForMarRow = {
  id: string;
  member_id: string;
  medication_name: string;
  date_started: string | null;
  inactivated_at: string | null;
  medication_status: "active" | "inactive" | null;
  dose: string | null;
  frequency: string | null;
  route: string | null;
  given_at_center: boolean | null;
  prn: boolean | null;
  prn_instructions: string | null;
  scheduled_times: string[] | null;
  comments: string | null;
};

type MarScheduleRow = {
  id: string;
  pof_medication_id: string;
  scheduled_time: string;
  active: boolean;
  medication_name: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  instructions: string | null;
  prn: boolean;
  start_date: string | null;
  end_date: string | null;
};

type MarAdministrationLinkRow = {
  mar_schedule_id: string | null;
};

type MemberPhotoRow = {
  member_id: string;
  profile_image_url: string | null;
};

const TIME_24H_PATTERN = /^(\d{1,2}):(\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GENERATION_DAYS = 45;
const MAR_BASE_SCHEMA_MIGRATION = "0028_pof_seeded_mar_workflow.sql";
const MAR_OVERDUE_VIEW_MIGRATION = "0030_mar_overdue_view.sql";
const MHP_MEDICATIONS_MIGRATION = "0012_legacy_operational_health_alignment.sql";
const MAR_MHP_SOURCE_PREFIX = "mhp-";

type MarSchemaObjectName =
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

function toMemberPhotoLookup(rows: MemberPhotoRow[]): Map<string, string | null> {
  return new Map(rows.map((row) => [row.member_id, clean(row.profile_image_url)] as const));
}

function throwMarSupabaseError(error: unknown, objectName: MarSchemaObjectName) {
  if (!error) return;
  const migration =
    objectName === "v_mar_overdue_today"
      ? MAR_OVERDUE_VIEW_MIGRATION
      : objectName === "member_medications"
        ? MHP_MEDICATIONS_MIGRATION
        : MAR_BASE_SCHEMA_MIGRATION;
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

function clean(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function toBoolean(value: unknown, fallback = false): boolean {
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

function normalizeScheduledTimes(value: unknown): string[] {
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

function canonicalInstant(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
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

function diffDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

function buildDateRange(startDate: string, endDate: string): string[] {
  const days = diffDays(startDate, endDate);
  if (days < 0) return [];
  return Array.from({ length: days + 1 }, (_, idx) => addDays(startDate, idx));
}

function toIsoBounds(startDate: string, endDate: string) {
  return {
    startIso: easternDateTimeLocalToISO(`${startDate}T00:00`),
    endIso: easternDateTimeLocalToISO(`${endDate}T23:59`)
  };
}

function normalizeGenerationWindow(startDate?: string | null, endDate?: string | null) {
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

function isDateWithinMedicationWindow(dateValue: string, startDate?: string | null, endDate?: string | null) {
  if (startDate && compareDate(startDate, dateValue) > 0) return false;
  if (endDate && compareDate(endDate, dateValue) < 0) return false;
  return true;
}

async function resolveMarMemberId(memberId: string, actionLabel: string, serviceRole?: boolean) {
  const canonical = await resolveCanonicalMemberRef(
    {
      sourceType: "member",
      memberId,
      selectedId: memberId
    },
    { actionLabel, serviceRole }
  );
  if (!canonical.memberId) {
    throw new Error(`${actionLabel} expected member.id but canonical member resolution returned empty memberId.`);
  }
  return canonical.memberId;
}

async function resolveMarAnchorPhysicianOrderId(input: {
  memberId: string;
  preferredOrderId?: string | null;
  serviceRole?: boolean;
}) {
  const preferredOrderId = clean(input.preferredOrderId);
  if (preferredOrderId) return preferredOrderId;

  const supabase = await createClient({ serviceRole: input.serviceRole });
  const { data: profileData, error: profileError } = await supabase
    .from("member_health_profiles")
    .select("active_physician_order_id")
    .eq("member_id", input.memberId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);

  const profileOrderId = clean((profileData as { active_physician_order_id?: string | null } | null)?.active_physician_order_id);
  if (profileOrderId) return profileOrderId;

  const [{ data: orderRows, error: orderError }, { data: memberData, error: memberError }] = await Promise.all([
    supabase
      .from("physician_orders")
      .select("id, version_number")
      .eq("member_id", input.memberId)
      .order("version_number", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("members").select("display_name").eq("id", input.memberId).maybeSingle()
  ]);
  if (orderError) throw new Error(orderError.message);
  if (memberError) throw new Error(memberError.message);

  const existingOrderId = clean(((orderRows ?? [])[0] as { id?: string } | undefined)?.id);
  if (existingOrderId) return existingOrderId;

  const now = toEasternISO();
  const memberNameSnapshot = clean((memberData as { display_name?: string | null } | null)?.display_name);
  const { data: insertedOrder, error: insertError } = await supabase
    .from("physician_orders")
    .insert({
      member_id: input.memberId,
      version_number: 1,
      status: "superseded",
      is_active_signed: false,
      superseded_at: now,
      signed_at: now,
      effective_at: now,
      member_name_snapshot: memberNameSnapshot,
      signature_metadata: {
        system_generated_for: "mar_anchor",
        generated_by_service: "mar-workflow",
        generated_at: now
      },
      created_by_name: "System MAR Anchor",
      updated_by_name: "System MAR Anchor"
    })
    .select("id")
    .single();
  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      const { data: retryRows, error: retryError } = await supabase
        .from("physician_orders")
        .select("id")
        .eq("member_id", input.memberId)
        .order("version_number", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);
      if (retryError) throw new Error(retryError.message);
      const retryId = clean(((retryRows ?? [])[0] as { id?: string } | undefined)?.id);
      if (retryId) return retryId;
    }
    throw new Error(insertError.message);
  }
  const insertedOrderId = clean((insertedOrder as { id?: string } | null)?.id);
  if (!insertedOrderId) throw new Error("Unable to create MAR anchor physician order.");
  return insertedOrderId;
}

async function syncMarMedicationsFromMhp(input: {
  memberId: string;
  anchorPhysicianOrderId?: string | null;
  serviceRole?: boolean;
}) {
  const serviceRole = input.serviceRole ?? true;
  const memberId = await resolveMarMemberId(input.memberId, "syncMarMedicationsFromMhp", serviceRole);
  const supabase = await createClient({ serviceRole });
  const anchorPhysicianOrderId = await resolveMarAnchorPhysicianOrderId({
    memberId,
    preferredOrderId: input.anchorPhysicianOrderId,
    serviceRole
  });

  const { data: mhpMedicationData, error: mhpMedicationError } = await supabase
    .from("member_medications")
    .select(
      "id, member_id, medication_name, date_started, inactivated_at, medication_status, dose, frequency, route, given_at_center, prn, prn_instructions, scheduled_times, comments"
    )
    .eq("member_id", memberId)
    .eq("medication_status", "active")
    .eq("given_at_center", true);
  if (mhpMedicationError) throwMarSupabaseError(mhpMedicationError, "member_medications");

  const now = toEasternISO();
  const medicationRows = (mhpMedicationData ?? []) as MemberMedicationForMarRow[];
  const upsertRows = medicationRows
    .map((row) => {
      const medicationName = clean(row.medication_name);
      if (!medicationName) return null;

      return {
        physician_order_id: anchorPhysicianOrderId,
        member_id: memberId,
        source_medication_id: `${MAR_MHP_SOURCE_PREFIX}${row.id}`,
        medication_name: medicationName,
        strength: null,
        dose: clean(row.dose),
        route: clean(row.route),
        frequency: clean(row.frequency),
        scheduled_times: normalizeScheduledTimes(row.scheduled_times),
        given_at_center: true,
        prn: toBoolean(row.prn, false),
        prn_instructions: clean(row.prn_instructions),
        start_date: toDateValue(row.date_started),
        end_date: toDateValue(row.inactivated_at),
        active: true,
        provider: null,
        instructions: clean(row.comments),
        created_by_user_id: null,
        created_by_name: null,
        updated_by_user_id: null,
        updated_by_name: null,
        created_at: now,
        updated_at: now
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  if (upsertRows.length > 0) {
    const { error: upsertError } = await supabase
      .from("pof_medications")
      .upsert(upsertRows, { onConflict: "physician_order_id,source_medication_id" });
    if (upsertError) throwMarSupabaseError(upsertError, "pof_medications");
  }

  const { data: activeRows, error: activeRowsError } = await supabase
    .from("pof_medications")
    .select("id, physician_order_id, source_medication_id")
    .eq("member_id", memberId)
    .eq("active", true)
    .like("source_medication_id", `${MAR_MHP_SOURCE_PREFIX}%`);
  if (activeRowsError) throwMarSupabaseError(activeRowsError, "pof_medications");

  const keepSourceMedicationIds = new Set(
    upsertRows
      .map((row) => clean(row.source_medication_id))
      .filter((row): row is string => Boolean(row))
  );
  const idsToDeactivate = (activeRows ?? [])
    .filter((row: { physician_order_id: string | null; source_medication_id: string | null }) => {
      const sourceId = clean(row.source_medication_id);
      if (!sourceId) return true;
      if (clean(row.physician_order_id) !== anchorPhysicianOrderId) return true;
      return !keepSourceMedicationIds.has(sourceId);
    })
    .map((row: { id: string }) => row.id);

  if (idsToDeactivate.length > 0) {
    const { error: deactivateError } = await supabase.from("pof_medications").update({ active: false }).in("id", idsToDeactivate);
    if (deactivateError) throwMarSupabaseError(deactivateError, "pof_medications");
  }

  return { synced: upsertRows.length };
}

function mapMarHistoryRow(row: Record<string, unknown>): MarAdministrationHistoryRow | null {
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
    pofMedicationId,
    marScheduleId: clean(row.mar_schedule_id),
    administrationDate,
    scheduledTime: clean(row.scheduled_time),
    medicationName,
    dose: clean(row.dose),
    route: clean(row.route),
    status,
    notGivenReason,
    prnReason: clean(row.prn_reason),
    prnOutcome,
    prnOutcomeAssessedAt: clean(row.prn_outcome_assessed_at),
    prnFollowupNote: clean(row.prn_followup_note),
    notes: clean(row.notes),
    administeredBy,
    administeredByUserId: clean(row.administered_by_user_id),
    administeredAt,
    source,
    createdAt,
    updatedAt
  };
}

function mapMarTodayRow(row: Record<string, unknown>): MarTodayRow | null {
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
    prn: toBoolean(row.prn, false),
    scheduledTime,
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

export async function syncPofMedicationsFromSignedOrder(input: {
  physicianOrderId: string;
  serviceRole?: boolean;
}) {
  const serviceRole = input.serviceRole ?? true;
  const supabase = await createClient({ serviceRole });
  const { data, error } = await supabase
    .from("physician_orders")
    .select("id, member_id, status")
    .eq("id", input.physicianOrderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Physician order not found for MAR medication sync.");

  const order = data as PhysicianOrderForSyncRow;
  if (order.status !== "signed") {
    return { synced: 0 };
  }
  return syncMarMedicationsFromMhp({
    memberId: order.member_id,
    anchorPhysicianOrderId: order.id,
    serviceRole
  });
}

export async function generateMarSchedulesForMember(input: {
  memberId: string;
  startDate?: string | null;
  endDate?: string | null;
  serviceRole?: boolean;
}) {
  const serviceRole = input.serviceRole ?? true;
  const memberId = await resolveMarMemberId(input.memberId, "generateMarSchedulesForMember", serviceRole);
  const { startDate, endDate } = normalizeGenerationWindow(input.startDate, input.endDate);
  const { startIso, endIso } = toIsoBounds(startDate, endDate);
  const supabase = await createClient({ serviceRole });

  await syncMarMedicationsFromMhp({ memberId, serviceRole });

  const { data: pofRows, error: pofRowsError } = await supabase
    .from("pof_medications")
    .select(
      "id, member_id, medication_name, dose, route, frequency, instructions, prn, active, given_at_center, scheduled_times, start_date, end_date"
    )
    .eq("member_id", memberId)
    .eq("active", true)
    .eq("given_at_center", true)
    .eq("prn", false)
    .like("source_medication_id", `${MAR_MHP_SOURCE_PREFIX}%`);
  if (pofRowsError) throwMarSupabaseError(pofRowsError, "pof_medications");
  const medicationRows = (pofRows ?? []) as PofMedicationRow[];

  if (medicationRows.length === 0) {
    const { data: scheduleRows, error: scheduleError } = await supabase
      .from("mar_schedules")
      .select("id")
      .eq("member_id", memberId)
      .eq("active", true)
      .gte("scheduled_time", startIso)
      .lte("scheduled_time", endIso);
    if (scheduleError) throwMarSupabaseError(scheduleError, "mar_schedules");

    const activeScheduleIds = (scheduleRows ?? []).map((row: { id: string }) => row.id);
    if (activeScheduleIds.length > 0) {
      const { data: documentedRows, error: documentedError } = await supabase
        .from("mar_administrations")
        .select("mar_schedule_id")
        .in("mar_schedule_id", activeScheduleIds);
      if (documentedError) throwMarSupabaseError(documentedError, "mar_administrations");

      const documentedIds = new Set(
        (documentedRows ?? [])
          .map((row: MarAdministrationLinkRow) => clean(row.mar_schedule_id))
          .filter((row): row is string => Boolean(row))
      );
      const idsToDeactivate = activeScheduleIds.filter((id) => !documentedIds.has(id));
      if (idsToDeactivate.length > 0) {
        const { error: deactivateError } = await supabase.from("mar_schedules").update({ active: false }).in("id", idsToDeactivate);
        if (deactivateError) throwMarSupabaseError(deactivateError, "mar_schedules");
      }
      return { inserted: 0, patched: 0, reactivated: 0, deactivated: idsToDeactivate.length };
    }

    return { inserted: 0, patched: 0, reactivated: 0, deactivated: 0 };
  }

  const expectedRows = medicationRows.flatMap((medication) => {
    const normalizedTimes = normalizeScheduledTimes(medication.scheduled_times);
    if (normalizedTimes.length === 0) return [];

    const medStart = medication.start_date && compareDate(medication.start_date, startDate) > 0 ? medication.start_date : startDate;
    const medEnd = medication.end_date && compareDate(medication.end_date, endDate) < 0 ? medication.end_date : endDate;
    if (compareDate(medStart, medEnd) > 0) return [];

    return buildDateRange(medStart, medEnd).flatMap((dateValue) =>
      normalizedTimes.map((timeValue) => ({
        member_id: memberId,
        pof_medication_id: medication.id,
        medication_name: medication.medication_name,
        dose: medication.dose,
        route: medication.route,
        scheduled_time: easternDateTimeLocalToISO(`${dateValue}T${timeValue}`),
        frequency: medication.frequency,
        instructions: medication.instructions,
        prn: Boolean(medication.prn),
        active: true,
        start_date: medication.start_date,
        end_date: medication.end_date
      }))
    );
  });

  const expectedKeys = new Set(
    expectedRows
      .map((row) => {
        const instant = canonicalInstant(row.scheduled_time);
        return instant ? `${row.pof_medication_id}|${instant}` : null;
      })
      .filter((key): key is string => Boolean(key))
  );

  const { data: existingRows, error: existingRowsError } = await supabase
    .from("mar_schedules")
    .select(
      "id, pof_medication_id, scheduled_time, active, medication_name, dose, route, frequency, instructions, prn, start_date, end_date"
    )
    .eq("member_id", memberId)
    .gte("scheduled_time", startIso)
    .lte("scheduled_time", endIso);
  if (existingRowsError) throwMarSupabaseError(existingRowsError, "mar_schedules");

  const schedules = (existingRows ?? []) as MarScheduleRow[];
  const scheduleByKey = new Map<string, MarScheduleRow>();
  schedules.forEach((row) => {
    const instant = canonicalInstant(row.scheduled_time);
    if (!instant) return;
    scheduleByKey.set(`${row.pof_medication_id}|${instant}`, row);
  });

  const existingScheduleIds = schedules.map((row) => row.id);
  const documentedIds = new Set<string>();
  if (existingScheduleIds.length > 0) {
    const { data: documentedRows, error: documentedError } = await supabase
      .from("mar_administrations")
      .select("mar_schedule_id")
      .in("mar_schedule_id", existingScheduleIds);
    if (documentedError) throwMarSupabaseError(documentedError, "mar_administrations");
    (documentedRows ?? []).forEach((row: MarAdministrationLinkRow) => {
      const scheduleId = clean(row.mar_schedule_id);
      if (scheduleId) documentedIds.add(scheduleId);
    });
  }

  const rowsToInsert = expectedRows.filter((row) => {
    const instant = canonicalInstant(row.scheduled_time);
    if (!instant) return false;
    const existing = scheduleByKey.get(`${row.pof_medication_id}|${instant}`);
    return !existing;
  });

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await supabase.from("mar_schedules").insert(rowsToInsert);
    if (insertError && insertError.code !== "23505") {
      throwMarSupabaseError(insertError, "mar_schedules");
    }
  }

  const expectedByKey = new Map<string, (typeof expectedRows)[number]>();
  expectedRows.forEach((row) => {
    const instant = canonicalInstant(row.scheduled_time);
    if (!instant) return;
    expectedByKey.set(`${row.pof_medication_id}|${instant}`, row);
  });

  const rowsToPatch: Array<{
    id: string;
    patch: {
      medication_name: string;
      dose: string | null;
      route: string | null;
      frequency: string | null;
      instructions: string | null;
      prn: boolean;
      start_date: string | null;
      end_date: string | null;
    };
  }> = [];

  schedules.forEach((row) => {
    if (documentedIds.has(row.id)) return;
    const instant = canonicalInstant(row.scheduled_time);
    if (!instant) return;
    const expected = expectedByKey.get(`${row.pof_medication_id}|${instant}`);
    if (!expected) return;

    const medicationNameChanged = clean(row.medication_name) !== clean(expected.medication_name);
    const doseChanged = clean(row.dose) !== clean(expected.dose);
    const routeChanged = clean(row.route) !== clean(expected.route);
    const frequencyChanged = clean(row.frequency) !== clean(expected.frequency);
    const instructionsChanged = clean(row.instructions) !== clean(expected.instructions);
    const prnChanged = Boolean(row.prn) !== Boolean(expected.prn);
    const startDateChanged = toDateValue(row.start_date) !== toDateValue(expected.start_date);
    const endDateChanged = toDateValue(row.end_date) !== toDateValue(expected.end_date);

    if (
      !medicationNameChanged &&
      !doseChanged &&
      !routeChanged &&
      !frequencyChanged &&
      !instructionsChanged &&
      !prnChanged &&
      !startDateChanged &&
      !endDateChanged
    ) {
      return;
    }

    rowsToPatch.push({
      id: row.id,
      patch: {
        medication_name: expected.medication_name,
        dose: expected.dose,
        route: expected.route,
        frequency: expected.frequency,
        instructions: expected.instructions,
        prn: expected.prn,
        start_date: expected.start_date,
        end_date: expected.end_date
      }
    });
  });

  if (rowsToPatch.length > 0) {
    await Promise.all(
      rowsToPatch.map(async (row) => {
        const { error: patchError } = await supabase.from("mar_schedules").update(row.patch).eq("id", row.id);
        if (patchError) throwMarSupabaseError(patchError, "mar_schedules");
      })
    );
  }

  const idsToReactivate = schedules
    .filter((row) => {
      if (row.active) return false;
      if (documentedIds.has(row.id)) return false;
      const instant = canonicalInstant(row.scheduled_time);
      if (!instant) return false;
      return expectedKeys.has(`${row.pof_medication_id}|${instant}`);
    })
    .map((row) => row.id);

  if (idsToReactivate.length > 0) {
    const { error: reactivateError } = await supabase.from("mar_schedules").update({ active: true }).in("id", idsToReactivate);
    if (reactivateError) throwMarSupabaseError(reactivateError, "mar_schedules");
  }

  const idsToDeactivate = schedules
    .filter((row) => {
      if (!row.active) return false;
      if (documentedIds.has(row.id)) return false;
      const instant = canonicalInstant(row.scheduled_time);
      if (!instant) return false;
      return !expectedKeys.has(`${row.pof_medication_id}|${instant}`);
    })
    .map((row) => row.id);

  if (idsToDeactivate.length > 0) {
    const { error: deactivateError } = await supabase.from("mar_schedules").update({ active: false }).in("id", idsToDeactivate);
    if (deactivateError) throwMarSupabaseError(deactivateError, "mar_schedules");
  }

  return {
    inserted: rowsToInsert.length,
    patched: rowsToPatch.length,
    reactivated: idsToReactivate.length,
    deactivated: idsToDeactivate.length
  };
}

export async function syncTodayMarSchedules(options?: { serviceRole?: boolean }) {
  const serviceRole = options?.serviceRole ?? true;
  const today = toEasternDate();
  const supabase = await createClient({ serviceRole });
  const { data: memberRows, error: memberError } = await supabase
    .from("member_medications")
    .select("member_id")
    .eq("medication_status", "active")
    .eq("given_at_center", true);
  if (memberError) throwMarSupabaseError(memberError, "member_medications");

  const memberIds = Array.from(
    new Set((memberRows ?? []).map((row: { member_id: string | null }) => clean(row.member_id)).filter((row): row is string => Boolean(row)))
  );
  await Promise.all(
    memberIds.map((memberId) =>
      generateMarSchedulesForMember({
        memberId,
        startDate: today,
        endDate: today,
        serviceRole
      })
    )
  );
}

export async function getMarWorkflowSnapshot(options?: {
  serviceRole?: boolean;
  historyLimit?: number;
  prnLimit?: number;
}) {
  const serviceRole = options?.serviceRole ?? true;
  await syncTodayMarSchedules({ serviceRole });
  const todayDate = toEasternDate();

  const historyLimit = Math.max(10, Math.min(options?.historyLimit ?? 200, 500));
  const prnLimit = Math.max(10, Math.min(options?.prnLimit ?? 200, 500));
  const supabase = await createClient({ serviceRole });

  const [
    { data: todayRowsRaw, error: todayError },
    { data: overdueRowsRaw, error: overdueError },
    { data: notGivenRowsRaw, error: notGivenError },
    { data: historyRowsRaw, error: historyError },
    { data: prnRowsRaw, error: prnError },
    { data: prnAwaitingRaw, error: prnAwaitingError },
    { data: prnEffectiveRaw, error: prnEffectiveError },
    { data: prnIneffectiveRaw, error: prnIneffectiveError }
  ] = await Promise.all([
    supabase.from("v_mar_today").select("*").order("scheduled_time", { ascending: true }),
    supabase.from("v_mar_overdue_today").select("*").order("scheduled_time", { ascending: true }),
    supabase.from("v_mar_not_given_today").select("*").order("administered_at", { ascending: false }),
    supabase.from("v_mar_administration_history").select("*").order("administered_at", { ascending: false }).limit(historyLimit),
    supabase.from("v_mar_prn_log").select("*").order("administered_at", { ascending: false }).limit(prnLimit),
    supabase.from("v_mar_prn_given_awaiting_outcome").select("*").order("administered_at", { ascending: false }).limit(prnLimit),
    supabase.from("v_mar_prn_effective").select("*").order("administered_at", { ascending: false }).limit(prnLimit),
    supabase.from("v_mar_prn_ineffective").select("*").order("administered_at", { ascending: false }).limit(prnLimit)
  ]);

  if (todayError) throwMarSupabaseError(todayError, "v_mar_today");
  if (overdueError) throwMarSupabaseError(overdueError, "v_mar_overdue_today");
  if (notGivenError) throwMarSupabaseError(notGivenError, "v_mar_not_given_today");
  if (historyError) throwMarSupabaseError(historyError, "v_mar_administration_history");
  if (prnError) throwMarSupabaseError(prnError, "v_mar_prn_log");
  if (prnAwaitingError) throwMarSupabaseError(prnAwaitingError, "v_mar_prn_given_awaiting_outcome");
  if (prnEffectiveError) throwMarSupabaseError(prnEffectiveError, "v_mar_prn_effective");
  if (prnIneffectiveError) throwMarSupabaseError(prnIneffectiveError, "v_mar_prn_ineffective");

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
  const prnLog = (prnRowsRaw ?? [])
    .map((row: unknown) => mapMarHistoryRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarAdministrationHistoryRow => Boolean(row));
  const prnAwaitingOutcome = (prnAwaitingRaw ?? [])
    .map((row: unknown) => mapMarHistoryRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarAdministrationHistoryRow => Boolean(row));
  const prnEffective = (prnEffectiveRaw ?? [])
    .map((row: unknown) => mapMarHistoryRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarAdministrationHistoryRow => Boolean(row));
  const prnIneffective = (prnIneffectiveRaw ?? [])
    .map((row: unknown) => mapMarHistoryRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarAdministrationHistoryRow => Boolean(row));

  const { data: prnMedicationRows, error: prnMedicationError } = await supabase
    .from("pof_medications")
    .select("id, member_id, medication_name, dose, route, prn_instructions, start_date, end_date")
    .eq("active", true)
    .eq("given_at_center", true)
    .eq("prn", true)
    .like("source_medication_id", `${MAR_MHP_SOURCE_PREFIX}%`);
  if (prnMedicationError) throwMarSupabaseError(prnMedicationError, "pof_medications");

  const prnMemberIds = Array.from(
    new Set((prnMedicationRows ?? []).map((row: { member_id: string | null }) => clean(row.member_id)).filter((row): row is string => Boolean(row)))
  );
  let memberRows: { id: string; display_name: string }[] = [];
  if (prnMemberIds.length > 0) {
    const { data, error } = await supabase.from("members").select("id, display_name").in("id", prnMemberIds);
    if (error) throw new Error(error.message);
    memberRows = (data ?? []) as { id: string; display_name: string }[];
  }

  const memberNameById = new Map(
    memberRows.map((row: { id: string; display_name: string }) => [row.id, row.display_name] as const)
  );
  const prnMedicationOptions: MarPrnOption[] = (prnMedicationRows ?? [])
    .filter((row: { start_date: string | null; end_date: string | null }) =>
      isDateWithinMedicationWindow(todayDate, row.start_date, row.end_date)
    )
    .map((row: {
      id: string;
      member_id: string;
      medication_name: string;
      dose: string | null;
      route: string | null;
      prn_instructions: string | null;
    }) => ({
      pofMedicationId: row.id,
      memberId: row.member_id,
      memberName: memberNameById.get(row.member_id) ?? "Member",
      medicationName: row.medication_name,
      dose: row.dose,
      route: row.route,
      prnInstructions: row.prn_instructions
    }))
    .sort((left, right) => {
      const memberSort = left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" });
      if (memberSort !== 0) return memberSort;
      return left.medicationName.localeCompare(right.medicationName, undefined, { sensitivity: "base" });
    });

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
    history,
    prnLog,
    prnAwaitingOutcome,
    prnEffective,
    prnIneffective,
    prnMedicationOptions
  } satisfies MarWorkflowSnapshot;
}

export async function documentScheduledMarAdministration(input: {
  marScheduleId: string;
  status: "Given" | "Not Given";
  notGivenReason?: MarNotGivenReason | null;
  notes?: string | null;
  actor: {
    userId: string;
    fullName: string;
  };
  serviceRole?: boolean;
}) {
  const now = toEasternISO();
  const note = clean(input.notes);
  const reason =
    input.status === "Not Given" && MAR_NOT_GIVEN_REASON_OPTIONS.includes(input.notGivenReason as MarNotGivenReason)
      ? (input.notGivenReason as MarNotGivenReason)
      : null;

  if (input.status === "Not Given" && !reason) {
    throw new Error("Not Given reason is required.");
  }
  if (input.status === "Not Given" && reason === "Other" && !note) {
    throw new Error("A note is required when Not Given reason is Other.");
  }

  const supabase = await createClient({ serviceRole: input.serviceRole });
  const { data: scheduleRowData, error: scheduleError } = await supabase
    .from("mar_schedules")
    .select("id, member_id, pof_medication_id, medication_name, dose, route, scheduled_time")
    .eq("id", input.marScheduleId)
    .maybeSingle();
  if (scheduleError) throwMarSupabaseError(scheduleError, "mar_schedules");
  if (!scheduleRowData) throw new Error("MAR schedule not found.");

  const scheduleRow = scheduleRowData as {
    id: string;
    member_id: string;
    pof_medication_id: string;
    medication_name: string;
    dose: string | null;
    route: string | null;
    scheduled_time: string;
  };

  const { data: existingAdministration, error: existingAdministrationError } = await supabase
    .from("mar_administrations")
    .select("id")
    .eq("mar_schedule_id", input.marScheduleId)
    .maybeSingle();
  if (existingAdministrationError) throwMarSupabaseError(existingAdministrationError, "mar_administrations");
  if (existingAdministration?.id) {
    throw new Error("This MAR dose has already been documented.");
  }

  const { data: inserted, error: insertError } = await supabase
    .from("mar_administrations")
    .insert({
      member_id: scheduleRow.member_id,
      pof_medication_id: scheduleRow.pof_medication_id,
      mar_schedule_id: scheduleRow.id,
      administration_date: toEasternDate(now),
      scheduled_time: scheduleRow.scheduled_time,
      medication_name: scheduleRow.medication_name,
      dose: scheduleRow.dose,
      route: scheduleRow.route,
      status: input.status,
      not_given_reason: input.status === "Not Given" ? reason : null,
      prn_reason: null,
      prn_outcome: null,
      prn_outcome_assessed_at: null,
      prn_followup_note: null,
      notes: note,
      administered_by: input.actor.fullName,
      administered_by_user_id: input.actor.userId,
      administered_at: now,
      source: "scheduled"
    })
    .select("id")
    .single();
  if (insertError) throwMarSupabaseError(insertError, "mar_administrations");
  if (!inserted?.id) throw new Error("Unable to save scheduled MAR administration.");
  await recordWorkflowEvent({
    eventType: "mar_administration_documented",
    entityType: "mar_administration",
    entityId: inserted.id as string,
    actorType: "user",
    actorUserId: input.actor.userId,
    status: input.status === "Given" ? "given" : "not_given",
    severity: "low",
    metadata: {
      member_id: scheduleRow.member_id,
      mar_schedule_id: scheduleRow.id,
      pof_medication_id: scheduleRow.pof_medication_id,
      scheduled_time: scheduleRow.scheduled_time,
      not_given_reason: reason
    }
  });

  return {
    administrationId: inserted.id as string,
    memberId: scheduleRow.member_id
  };
}

export async function documentPrnMarAdministration(input: {
  pofMedicationId: string;
  prnReason: string;
  notes?: string | null;
  administeredAtIso?: string | null;
  actor: {
    userId: string;
    fullName: string;
  };
  serviceRole?: boolean;
}) {
  const administeredAt = input.administeredAtIso ? input.administeredAtIso : toEasternISO();
  const reason = clean(input.prnReason);
  if (!reason) throw new Error("PRN reason is required.");

  const supabase = await createClient({ serviceRole: input.serviceRole });
  const { data: medicationData, error: medicationError } = await supabase
    .from("pof_medications")
    .select("id, source_medication_id, member_id, medication_name, dose, route, active, given_at_center, prn")
    .eq("id", input.pofMedicationId)
    .maybeSingle();
  if (medicationError) throwMarSupabaseError(medicationError, "pof_medications");
  if (!medicationData) throw new Error("Selected PRN medication was not found.");

  const medication = medicationData as {
    id: string;
    source_medication_id: string | null;
    member_id: string;
    medication_name: string;
    dose: string | null;
    route: string | null;
    active: boolean;
    given_at_center: boolean;
    prn: boolean;
  };

  if (!medication.active || !medication.given_at_center || !medication.prn) {
    throw new Error("Selected medication is not an active center-administered PRN medication.");
  }
  if (!String(medication.source_medication_id ?? "").startsWith(MAR_MHP_SOURCE_PREFIX)) {
    throw new Error("Selected medication is not linked to the canonical MHP medication list.");
  }

  const { data: inserted, error: insertError } = await supabase
    .from("mar_administrations")
    .insert({
      member_id: medication.member_id,
      pof_medication_id: medication.id,
      mar_schedule_id: null,
      administration_date: toEasternDate(administeredAt),
      scheduled_time: null,
      medication_name: medication.medication_name,
      dose: medication.dose,
      route: medication.route,
      status: "Given",
      not_given_reason: null,
      prn_reason: reason,
      prn_outcome: null,
      prn_outcome_assessed_at: null,
      prn_followup_note: null,
      notes: clean(input.notes),
      administered_by: input.actor.fullName,
      administered_by_user_id: input.actor.userId,
      administered_at: administeredAt,
      source: "prn"
    })
    .select("id")
    .single();
  if (insertError) throwMarSupabaseError(insertError, "mar_administrations");
  if (!inserted?.id) throw new Error("Unable to save PRN MAR administration.");
  await recordWorkflowEvent({
    eventType: "mar_administration_documented",
    entityType: "mar_administration",
    entityId: inserted.id as string,
    actorType: "user",
    actorUserId: input.actor.userId,
    status: "given",
    severity: "low",
    metadata: {
      member_id: medication.member_id,
      pof_medication_id: medication.id,
      source: "prn",
      prn_reason: reason
    }
  });

  return {
    administrationId: inserted.id as string,
    memberId: medication.member_id
  };
}

export async function documentPrnOutcomeAssessment(input: {
  administrationId: string;
  prnOutcome: MarPrnOutcome;
  prnFollowupNote?: string | null;
  outcomeAssessedAtIso?: string | null;
  actor: {
    userId: string;
    fullName: string;
  };
  serviceRole?: boolean;
}) {
  const followupNote = clean(input.prnFollowupNote);
  if (input.prnOutcome === "Ineffective" && !followupNote) {
    throw new Error("Follow-up note is required when PRN outcome is Ineffective.");
  }

  const outcomeAssessedAt = input.outcomeAssessedAtIso ? input.outcomeAssessedAtIso : toEasternISO();
  const supabase = await createClient({ serviceRole: input.serviceRole });
  const { data: existingData, error: existingError } = await supabase
    .from("mar_administrations")
    .select("id, member_id, source, status")
    .eq("id", input.administrationId)
    .maybeSingle();
  if (existingError) throwMarSupabaseError(existingError, "mar_administrations");
  if (!existingData) throw new Error("PRN administration entry not found.");

  const existing = existingData as {
    id: string;
    member_id: string;
    source: "scheduled" | "prn";
    status: "Given" | "Not Given";
  };

  if (existing.source !== "prn" || existing.status !== "Given") {
    throw new Error("PRN outcome can only be documented for PRN administrations with status Given.");
  }

  const { data: updated, error: updateError } = await supabase
    .from("mar_administrations")
    .update({
      prn_outcome: input.prnOutcome,
      prn_outcome_assessed_at: outcomeAssessedAt,
      prn_followup_note: followupNote
    })
    .eq("id", input.administrationId)
    .select("id")
    .single();
  if (updateError) throwMarSupabaseError(updateError, "mar_administrations");
  if (!updated?.id) throw new Error("Unable to save PRN outcome documentation.");
  await recordWorkflowEvent({
    eventType: "mar_prn_outcome_documented",
    entityType: "mar_administration",
    entityId: updated.id as string,
    actorType: "user",
    actorUserId: input.actor.userId,
    status: input.prnOutcome.toLowerCase(),
    severity: input.prnOutcome === "Ineffective" ? "medium" : "low",
    metadata: {
      member_id: existing.member_id,
      prn_outcome: input.prnOutcome,
      prn_followup_note: followupNote
    }
  });

  return {
    administrationId: updated.id as string,
    memberId: existing.member_id
  };
}
