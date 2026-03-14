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
  provider_name: string | null;
  medications: unknown;
  signed_at: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ActiveSignedOrderRow = {
  id: string;
  member_id: string;
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

type MarScheduleRow = {
  id: string;
  pof_medication_id: string;
  scheduled_time: string;
  active: boolean;
};

type MarAdministrationLinkRow = {
  mar_schedule_id: string | null;
};

const TIME_24H_PATTERN = /^(\d{1,2}):(\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GENERATION_DAYS = 45;

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

function readField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function toRecordRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)
  );
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

async function getActiveSignedOrders(input?: { memberId?: string | null; serviceRole?: boolean }) {
  const supabase = await createClient({ serviceRole: input?.serviceRole });
  let query = supabase
    .from("physician_orders")
    .select("id, member_id")
    .eq("status", "signed")
    .eq("is_active_signed", true);

  if (input?.memberId) {
    query = query.eq("member_id", input.memberId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ActiveSignedOrderRow[];
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
  const supabase = await createClient({ serviceRole: input.serviceRole });
  const { data, error } = await supabase
    .from("physician_orders")
    .select(
      "id, member_id, status, provider_name, medications, signed_at, created_by_user_id, created_by_name, updated_by_user_id, updated_by_name, created_at, updated_at"
    )
    .eq("id", input.physicianOrderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Physician order not found for MAR medication sync.");

  const order = data as PhysicianOrderForSyncRow;
  if (order.status !== "signed") {
    return { synced: 0 };
  }

  const medicationRows = toRecordRows(order.medications);
  const now = toEasternISO();
  const fallbackStartDate = toDateValue(order.signed_at);
  const upsertRows = medicationRows
    .map((row, index) => {
      const medicationName = clean(readField(row, ["name", "medication_name"]));
      if (!medicationName) return null;

      const scheduledTimesRaw = normalizeScheduledTimes(readField(row, ["scheduledTimes", "scheduled_times"]));
      const fallbackSingleTime = normalizeTime24h(
        clean(readField(row, ["givenAtCenterTime24h", "given_at_center_time_24h"]))
      );
      const scheduledTimes =
        scheduledTimesRaw.length > 0
          ? scheduledTimesRaw
          : fallbackSingleTime
            ? [fallbackSingleTime]
            : [];

      return {
        physician_order_id: order.id,
        member_id: order.member_id,
        source_medication_id: clean(readField(row, ["id", "source_medication_id"])) ?? `medication-${index + 1}`,
        medication_name: medicationName,
        strength: clean(readField(row, ["strength", "quantity"])),
        dose: clean(readField(row, ["dose"])),
        route: clean(readField(row, ["route"])),
        frequency: clean(readField(row, ["frequency"])),
        scheduled_times: scheduledTimes,
        given_at_center: toBoolean(readField(row, ["givenAtCenter", "given_at_center"]), false),
        prn: toBoolean(readField(row, ["prn"]), false),
        prn_instructions: clean(readField(row, ["prnInstructions", "prn_instructions"])),
        start_date: toDateValue(readField(row, ["startDate", "start_date"])) ?? fallbackStartDate,
        end_date: toDateValue(readField(row, ["endDate", "end_date"])),
        active: toBoolean(readField(row, ["active"]), true),
        provider: clean(readField(row, ["provider"])) ?? clean(order.provider_name),
        instructions: clean(readField(row, ["instructions"])) ?? clean(readField(row, ["comments"])),
        created_by_user_id: order.created_by_user_id,
        created_by_name: clean(order.created_by_name),
        updated_by_user_id: order.updated_by_user_id,
        updated_by_name: clean(order.updated_by_name),
        created_at: order.created_at ?? now,
        updated_at: order.updated_at ?? now
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  if (upsertRows.length === 0) {
    return { synced: 0 };
  }

  const { error: upsertError } = await supabase
    .from("pof_medications")
    .upsert(upsertRows, { onConflict: "physician_order_id,source_medication_id" });
  if (upsertError) throw new Error(upsertError.message);

  return { synced: upsertRows.length };
}

export async function generateMarSchedulesForMember(input: {
  memberId: string;
  startDate?: string | null;
  endDate?: string | null;
  serviceRole?: boolean;
}) {
  const memberId = await resolveMarMemberId(input.memberId, "generateMarSchedulesForMember", input.serviceRole);
  const { startDate, endDate } = normalizeGenerationWindow(input.startDate, input.endDate);
  const { startIso, endIso } = toIsoBounds(startDate, endDate);
  const supabase = await createClient({ serviceRole: input.serviceRole });

  const activeOrders = await getActiveSignedOrders({ memberId, serviceRole: input.serviceRole });
  const activeOrderIds = activeOrders.map((row) => row.id);

  if (activeOrderIds.length === 0) {
    const { data: scheduleRows, error: scheduleError } = await supabase
      .from("mar_schedules")
      .select("id")
      .eq("member_id", memberId)
      .eq("active", true)
      .gte("scheduled_time", startIso)
      .lte("scheduled_time", endIso);
    if (scheduleError) throw new Error(scheduleError.message);

    const activeScheduleIds = (scheduleRows ?? []).map((row: { id: string }) => row.id);
    if (activeScheduleIds.length > 0) {
      const { data: documentedRows, error: documentedError } = await supabase
        .from("mar_administrations")
        .select("mar_schedule_id")
        .in("mar_schedule_id", activeScheduleIds);
      if (documentedError) throw new Error(documentedError.message);

      const documentedIds = new Set(
        (documentedRows ?? [])
          .map((row: MarAdministrationLinkRow) => clean(row.mar_schedule_id))
          .filter((row): row is string => Boolean(row))
      );
      const idsToDeactivate = activeScheduleIds.filter((id) => !documentedIds.has(id));
      if (idsToDeactivate.length > 0) {
        const { error: deactivateError } = await supabase.from("mar_schedules").update({ active: false }).in("id", idsToDeactivate);
        if (deactivateError) throw new Error(deactivateError.message);
      }
      return { inserted: 0, reactivated: 0, deactivated: idsToDeactivate.length };
    }

    return { inserted: 0, reactivated: 0, deactivated: 0 };
  }

  await Promise.all(
    activeOrderIds.map((orderId) => syncPofMedicationsFromSignedOrder({ physicianOrderId: orderId, serviceRole: input.serviceRole }))
  );

  const { data: pofRows, error: pofRowsError } = await supabase
    .from("pof_medications")
    .select(
      "id, member_id, medication_name, dose, route, frequency, instructions, prn, active, given_at_center, scheduled_times, start_date, end_date"
    )
    .eq("member_id", memberId)
    .eq("active", true)
    .eq("given_at_center", true)
    .in("physician_order_id", activeOrderIds);
  if (pofRowsError) throw new Error(pofRowsError.message);
  const medicationRows = (pofRows ?? []) as PofMedicationRow[];

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
    .select("id, pof_medication_id, scheduled_time, active")
    .eq("member_id", memberId)
    .gte("scheduled_time", startIso)
    .lte("scheduled_time", endIso);
  if (existingRowsError) throw new Error(existingRowsError.message);

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
    if (documentedError) throw new Error(documentedError.message);
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
      throw new Error(insertError.message);
    }
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
    if (reactivateError) throw new Error(reactivateError.message);
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
    if (deactivateError) throw new Error(deactivateError.message);
  }

  return {
    inserted: rowsToInsert.length,
    reactivated: idsToReactivate.length,
    deactivated: idsToDeactivate.length
  };
}

export async function syncTodayMarSchedules(options?: { serviceRole?: boolean }) {
  const today = toEasternDate();
  const activeOrders = await getActiveSignedOrders({ serviceRole: options?.serviceRole });
  const memberIds = Array.from(new Set(activeOrders.map((row) => row.member_id)));
  await Promise.all(
    memberIds.map((memberId) =>
      generateMarSchedulesForMember({
        memberId,
        startDate: today,
        endDate: today,
        serviceRole: options?.serviceRole
      })
    )
  );
}

export async function getMarWorkflowSnapshot(options?: {
  serviceRole?: boolean;
  historyLimit?: number;
  prnLimit?: number;
}) {
  await syncTodayMarSchedules({ serviceRole: options?.serviceRole });

  const historyLimit = Math.max(10, Math.min(options?.historyLimit ?? 200, 500));
  const prnLimit = Math.max(10, Math.min(options?.prnLimit ?? 200, 500));
  const supabase = await createClient({ serviceRole: options?.serviceRole });

  const [
    { data: todayRowsRaw, error: todayError },
    { data: notGivenRowsRaw, error: notGivenError },
    { data: historyRowsRaw, error: historyError },
    { data: prnRowsRaw, error: prnError },
    { data: prnAwaitingRaw, error: prnAwaitingError },
    { data: prnEffectiveRaw, error: prnEffectiveError },
    { data: prnIneffectiveRaw, error: prnIneffectiveError },
    activeOrdersResult
  ] = await Promise.all([
    supabase.from("v_mar_today").select("*").order("scheduled_time", { ascending: true }),
    supabase.from("v_mar_not_given_today").select("*").order("administered_at", { ascending: false }),
    supabase.from("v_mar_administration_history").select("*").order("administered_at", { ascending: false }).limit(historyLimit),
    supabase.from("v_mar_prn_log").select("*").order("administered_at", { ascending: false }).limit(prnLimit),
    supabase.from("v_mar_prn_given_awaiting_outcome").select("*").order("administered_at", { ascending: false }).limit(prnLimit),
    supabase.from("v_mar_prn_effective").select("*").order("administered_at", { ascending: false }).limit(prnLimit),
    supabase.from("v_mar_prn_ineffective").select("*").order("administered_at", { ascending: false }).limit(prnLimit),
    getActiveSignedOrders({ serviceRole: options?.serviceRole })
  ]);

  if (todayError) throw new Error(todayError.message);
  if (notGivenError) throw new Error(notGivenError.message);
  if (historyError) throw new Error(historyError.message);
  if (prnError) throw new Error(prnError.message);
  if (prnAwaitingError) throw new Error(prnAwaitingError.message);
  if (prnEffectiveError) throw new Error(prnEffectiveError.message);
  if (prnIneffectiveError) throw new Error(prnIneffectiveError.message);

  const activeOrderIds = activeOrdersResult.map((row) => row.id);
  const today = (todayRowsRaw ?? [])
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

  let prnMedicationOptions: MarPrnOption[] = [];
  if (activeOrderIds.length > 0) {
    const [{ data: pofRows, error: pofError }, { data: memberRows, error: memberError }] = await Promise.all([
      supabase
        .from("pof_medications")
        .select("id, member_id, medication_name, dose, route, prn_instructions")
        .eq("active", true)
        .eq("given_at_center", true)
        .eq("prn", true)
        .in("physician_order_id", activeOrderIds),
      supabase.from("members").select("id, display_name").in("id", Array.from(new Set(activeOrdersResult.map((row) => row.member_id))))
    ]);
    if (pofError) throw new Error(pofError.message);
    if (memberError) throw new Error(memberError.message);

    const memberNameById = new Map(
      (memberRows ?? []).map((row: { id: string; display_name: string }) => [row.id, row.display_name] as const)
    );
    prnMedicationOptions = (pofRows ?? [])
      .map((row: { id: string; member_id: string; medication_name: string; dose: string | null; route: string | null; prn_instructions: string | null }) => ({
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
  }

  return {
    today,
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
  if (scheduleError) throw new Error(scheduleError.message);
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
  if (existingAdministrationError) throw new Error(existingAdministrationError.message);
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
  if (insertError) throw new Error(insertError.message);

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
    .select("id, physician_order_id, member_id, medication_name, dose, route, active, given_at_center, prn")
    .eq("id", input.pofMedicationId)
    .maybeSingle();
  if (medicationError) throw new Error(medicationError.message);
  if (!medicationData) throw new Error("Selected PRN medication was not found.");

  const medication = medicationData as {
    id: string;
    physician_order_id: string;
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

  const { data: orderData, error: orderError } = await supabase
    .from("physician_orders")
    .select("id")
    .eq("id", medication.physician_order_id)
    .eq("status", "signed")
    .eq("is_active_signed", true)
    .maybeSingle();
  if (orderError) throw new Error(orderError.message);
  if (!orderData) {
    throw new Error("Selected PRN medication no longer belongs to an active signed physician order.");
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
  if (insertError) throw new Error(insertError.message);

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
  if (existingError) throw new Error(existingError.message);
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
  if (updateError) throw new Error(updateError.message);

  return {
    administrationId: updated.id as string,
    memberId: existing.member_id
  };
}
