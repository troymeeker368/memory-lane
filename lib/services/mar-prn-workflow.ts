import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { buildIdempotencyHash } from "@/lib/services/idempotency";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import {
  type MarAdministrationHistoryRow,
  type MarPrnFollowupStatus,
  type MarPrnOption,
  type MarPrnOutcome,
  type MarPrnStatus
} from "@/lib/services/mar-shared";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

const SYNC_ACTIVE_PRN_ORDERS_RPC = "rpc_sync_active_prn_medication_orders";
const RECORD_PRN_ADMIN_RPC = "rpc_record_prn_medication_administration";
const CREATE_PRN_ORDER_AND_ADMIN_RPC = "rpc_create_prn_medication_order_and_administer";
const COMPLETE_PRN_FOLLOWUP_RPC = "rpc_complete_prn_administration_followup";
const PRN_WORKFLOW_MIGRATION = "0107_prn_medication_orders_and_logs.sql";

type MedicationOrderRow = {
  id: string;
  member_id: string;
  physician_order_id: string | null;
  pof_medication_id: string | null;
  medication_name: string;
  strength: string | null;
  form: string | null;
  route: string | null;
  directions: string | null;
  prn_reason: string | null;
  frequency_text: string | null;
  min_interval_minutes: number | null;
  max_doses_per_24h: number | null;
  max_daily_dose: number | null;
  start_date: string | null;
  end_date: string | null;
  provider_name: string | null;
  order_source: "pof" | "manual_provider_order" | "legacy_mhp" | "center_standing_order";
  status: "active" | "inactive" | "expired" | "discontinued";
  requires_review: boolean;
  requires_effectiveness_followup: boolean;
};

type PrnAdministrationLogRow = {
  id: string;
  member_id: string;
  medication_order_id: string;
  admin_datetime: string;
  dose_given: string | null;
  route_given: string | null;
  indication: string | null;
  symptom_score_before: number | null;
  followup_due_at: string | null;
  followup_status: MarPrnFollowupStatus;
  effectiveness_result: MarPrnOutcome | null;
  followup_notes: string | null;
  administered_by: string | null;
  administered_by_name: string | null;
  status: MarPrnStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function clean(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isOrderActive(row: MedicationOrderRow, dateValue: string) {
  if (row.status !== "active") return false;
  if (row.start_date && row.start_date > dateValue) return false;
  if (row.end_date && row.end_date < dateValue) return false;
  return true;
}

function buildPrnAdministrationIdempotencyKey(input: {
  medicationOrderId: string;
  administeredAt: string;
  indication: string;
  status: MarPrnStatus;
  submissionId?: string | null;
}) {
  return buildIdempotencyHash("mar-prn:administration", {
    medicationOrderId: input.medicationOrderId,
    administeredAt: input.administeredAt,
    indication: input.indication.trim().toLowerCase(),
    status: input.status,
    submissionId: clean(input.submissionId)?.toLowerCase() ?? null
  });
}

function buildPrnOrderCreationIdempotencyKey(input: {
  memberId: string;
  order: {
    physicianOrderId?: string | null;
    pofMedicationId?: string | null;
    sourceMedicationId?: string | null;
    medicationName: string;
    strength?: string | null;
    form?: string | null;
    route?: string | null;
    directions: string;
    prnReason?: string | null;
    frequencyText?: string | null;
    minIntervalMinutes?: number | null;
    maxDosesPer24h?: number | null;
    maxDailyDose?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    providerName: string;
    requiresReview?: boolean;
    requiresEffectivenessFollowup?: boolean;
  };
  administration: {
    administeredAt: string;
    indication: string;
    status: MarPrnStatus;
    submissionId?: string | null;
  };
}) {
  return buildIdempotencyHash("mar-prn:manual-order-root", {
    memberId: input.memberId,
    order: {
      physicianOrderId: clean(input.order.physicianOrderId),
      pofMedicationId: clean(input.order.pofMedicationId),
      sourceMedicationId: clean(input.order.sourceMedicationId),
      medicationName: clean(input.order.medicationName),
      strength: clean(input.order.strength),
      form: clean(input.order.form),
      route: clean(input.order.route),
      directions: clean(input.order.directions),
      prnReason: clean(input.order.prnReason),
      frequencyText: clean(input.order.frequencyText),
      minIntervalMinutes: input.order.minIntervalMinutes ?? null,
      maxDosesPer24h: input.order.maxDosesPer24h ?? null,
      maxDailyDose: clean(input.order.maxDailyDose),
      startDate: clean(input.order.startDate),
      endDate: clean(input.order.endDate),
      providerName: clean(input.order.providerName),
      requiresReview: input.order.requiresReview ?? true,
      requiresEffectivenessFollowup: input.order.requiresEffectivenessFollowup ?? true
    },
    administration: {
      administeredAt: input.administration.administeredAt,
      indication: input.administration.indication.trim().toLowerCase(),
      status: input.administration.status,
      submissionId: clean(input.administration.submissionId)?.toLowerCase() ?? null
    }
  });
}

function buildOrderOption(row: MedicationOrderRow, memberName: string): MarPrnOption {
  return {
    medicationOrderId: row.id,
    memberId: row.member_id,
    memberName,
    physicianOrderId: row.physician_order_id,
    pofMedicationId: row.pof_medication_id,
    medicationName: row.medication_name,
    strength: row.strength,
    form: row.form,
    route: row.route,
    directions: row.directions,
    prnReason: row.prn_reason,
    frequencyText: row.frequency_text,
    minIntervalMinutes: row.min_interval_minutes,
    maxDosesPer24h: row.max_doses_per_24h,
    maxDailyDose: row.max_daily_dose == null ? null : String(row.max_daily_dose),
    providerName: row.provider_name,
    orderSource: row.order_source,
    status: row.status,
    requiresReview: row.requires_review,
    requiresEffectivenessFollowup: row.requires_effectiveness_followup,
    startDate: row.start_date,
    endDate: row.end_date
  };
}

function buildHistoryRow(input: {
  log: PrnAdministrationLogRow;
  order: MedicationOrderRow;
  memberName: string;
}): MarAdministrationHistoryRow {
  return {
    id: input.log.id,
    memberId: input.log.member_id,
    memberName: input.memberName,
    medicationOrderId: input.log.medication_order_id,
    pofMedicationId: input.order.pof_medication_id,
    marScheduleId: null,
    administrationDate: toEasternDate(input.log.admin_datetime),
    scheduledTime: null,
    medicationName: input.order.medication_name,
    dose: clean(input.log.dose_given) ?? input.order.strength,
    route: clean(input.log.route_given) ?? input.order.route,
    status: input.log.status,
    notGivenReason: null,
    prnReason: clean(input.log.indication),
    prnOutcome: input.log.effectiveness_result,
    prnOutcomeAssessedAt: input.log.followup_status === "completed" ? input.log.updated_at : null,
    prnFollowupNote: clean(input.log.followup_notes),
    followupDueAt: input.log.followup_due_at,
    followupStatus: input.log.followup_status,
    requiresFollowup: input.order.requires_effectiveness_followup,
    notes: clean(input.log.notes),
    administeredBy: clean(input.log.administered_by_name) ?? "Unknown staff",
    administeredByUserId: input.log.administered_by,
    administeredAt: input.log.admin_datetime,
    source: "prn",
    createdAt: input.log.created_at,
    updatedAt: input.log.updated_at
  };
}

async function loadMemberNames(memberIds: string[], serviceRole = true) {
  if (memberIds.length === 0) return new Map<string, string>();
  const supabase = await createClient({ serviceRole });
  const { data, error } = await supabase.from("members").select("id, display_name").in("id", memberIds);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as Array<{ id: string; display_name: string | null }>).map((row) => [row.id, row.display_name ?? "Member"]));
}

async function loadMedicationOrdersByIds(orderIds: string[], serviceRole = true) {
  if (orderIds.length === 0) return new Map<string, MedicationOrderRow>();
  const supabase = await createClient({ serviceRole });
  const { data, error } = await supabase
    .from("medication_orders")
    .select(
      "id, member_id, physician_order_id, pof_medication_id, medication_name, strength, form, route, directions, prn_reason, frequency_text, min_interval_minutes, max_doses_per_24h, max_daily_dose, start_date, end_date, provider_name, order_source, status, requires_review, requires_effectiveness_followup"
    )
    .in("id", orderIds);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as MedicationOrderRow[]).map((row) => [row.id, row] as const));
}

async function loadPrnMedicationOrderOptionById(orderId: string, serviceRole = true) {
  const ordersById = await loadMedicationOrdersByIds([orderId], serviceRole);
  const row = ordersById.get(orderId);
  if (!row) throw new Error("Medication order was not found after save.");
  const memberNames = await loadMemberNames([row.member_id], serviceRole);
  return buildOrderOption(row, memberNames.get(row.member_id) ?? "Member");
}

function mapMissingRpcError(message: string, rpcName: string, migrationName = PRN_WORKFLOW_MIGRATION) {
  if (!message.includes(rpcName)) return null;
  return `PRN medication workflow RPC ${rpcName} is not available. Apply Supabase migration ${migrationName} and refresh PostgREST schema cache.`;
}

export async function syncCenterStandingPrnMedicationOrders(options?: { serviceRole?: boolean }) {
  // `rpc_sync_center_standing_prn_orders` was retired in migration 0167.
  // Keep this export for compatibility and route to the canonical active PRN sync RPC.
  return syncActivePrnMedicationOrders(options);
}

export async function syncActivePrnMedicationOrders(options?: { serviceRole?: boolean }) {
  const supabase = await createClient({ serviceRole: options?.serviceRole ?? true });
  try {
    return await invokeSupabaseRpcOrThrow<Array<{ synced_orders: number | null; inactivated_orders: number | null }>>(
      supabase,
      SYNC_ACTIVE_PRN_ORDERS_RPC,
      { p_now: toEasternISO() }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync PRN medication orders.";
    const mapped = mapMissingRpcError(message, SYNC_ACTIVE_PRN_ORDERS_RPC);
    if (mapped) throw new Error(mapped);
    throw error;
  }
}

export async function listActivePrnMedicationOptions(input?: {
  memberId?: string | null;
  serviceRole?: boolean;
}) {
  const serviceRole = input?.serviceRole ?? true;
  const supabase = await createClient({ serviceRole });
  const today = toEasternDate();
  const canonicalMemberId = input?.memberId
    ? await resolveCanonicalMemberId(input.memberId, { actionLabel: "listActivePrnMedicationOptions", serviceRole })
    : null;
  let query = supabase
    .from("medication_orders")
    .select(
      "id, member_id, physician_order_id, pof_medication_id, medication_name, strength, form, route, directions, prn_reason, frequency_text, min_interval_minutes, max_doses_per_24h, max_daily_dose, start_date, end_date, provider_name, order_source, status, requires_review, requires_effectiveness_followup"
    )
    .eq("order_type", "prn")
    .eq("status", "active");
  if (canonicalMemberId) query = query.eq("member_id", canonicalMemberId);
  const { data, error } = await query.order("medication_name", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as MedicationOrderRow[]).filter((row) => isOrderActive(row, today));
  const memberNames = await loadMemberNames(Array.from(new Set(rows.map((row) => row.member_id))), serviceRole);
  return rows
    .map((row) => buildOrderOption(row, memberNames.get(row.member_id) ?? "Member"))
    .sort((left, right) => {
      const memberSort = left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" });
      if (memberSort !== 0) return memberSort;
      return left.medicationName.localeCompare(right.medicationName, undefined, { sensitivity: "base" });
    });
}

export async function getPrnHistorySnapshot(options?: {
  memberId?: string | null;
  limit?: number;
  serviceRole?: boolean;
}) {
  const serviceRole = options?.serviceRole ?? true;
  const supabase = await createClient({ serviceRole });
  const canonicalMemberId = options?.memberId
    ? await resolveCanonicalMemberId(options.memberId, { actionLabel: "getPrnHistorySnapshot", serviceRole })
    : null;
  let query = supabase
    .from("med_administration_logs")
    .select(
      "id, member_id, medication_order_id, admin_datetime, dose_given, route_given, indication, symptom_score_before, followup_due_at, followup_status, effectiveness_result, followup_notes, administered_by, administered_by_name, status, notes, created_at, updated_at"
    )
    .eq("admin_type", "prn")
    .order("admin_datetime", { ascending: false })
    .limit(Math.max(10, Math.min(options?.limit ?? 200, 500)));
  if (canonicalMemberId) query = query.eq("member_id", canonicalMemberId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PrnAdministrationLogRow[];
  const orderIds = Array.from(new Set(rows.map((row) => row.medication_order_id)));
  const ordersById = await loadMedicationOrdersByIds(orderIds, serviceRole);
  const memberNames = await loadMemberNames(Array.from(new Set(rows.map((row) => row.member_id))), serviceRole);
  const history = rows
    .map((row) => {
      const order = ordersById.get(row.medication_order_id);
      if (!order) return null;
      return buildHistoryRow({
        log: row,
        order,
        memberName: memberNames.get(row.member_id) ?? "Member"
      });
    })
    .filter((row): row is MarAdministrationHistoryRow => Boolean(row));
  return {
    log: history,
    awaitingOutcome: history.filter((row) => row.status === "Given" && (row.followupStatus === "due" || row.followupStatus === "overdue")),
    effective: history.filter((row) => row.prnOutcome === "Effective"),
    ineffective: history.filter((row) => row.prnOutcome === "Ineffective")
  };
}

export async function documentPrnMedicationAdministration(input: {
  medicationOrderId: string;
  administeredAtIso?: string | null;
  doseGiven?: string | null;
  routeGiven?: string | null;
  indication: string;
  symptomScoreBefore?: number | null;
  followupDueAtIso?: string | null;
  status: MarPrnStatus;
  notes?: string | null;
  submissionId?: string | null;
  actor: {
    userId: string;
    fullName: string;
  };
  serviceRole?: boolean;
}) {
  const administeredAt = clean(input.administeredAtIso) ?? toEasternISO();
  const indication = clean(input.indication);
  if (!indication) throw new Error("Indication is required.");
  const idempotencyKey = buildPrnAdministrationIdempotencyKey({
    medicationOrderId: input.medicationOrderId,
    administeredAt,
    indication,
    status: input.status,
    submissionId: input.submissionId
  });

  const supabase = await createClient({ serviceRole: input.serviceRole ?? true });
  let rpcResult: Array<{
    log_id: string;
    member_id: string;
    medication_order_id: string;
    followup_due_at: string | null;
    followup_status: MarPrnFollowupStatus;
    duplicate_safe: boolean;
  }>;
  try {
    rpcResult = await invokeSupabaseRpcOrThrow(supabase, RECORD_PRN_ADMIN_RPC, {
      p_medication_order_id: input.medicationOrderId,
      p_admin_datetime: administeredAt,
      p_dose_given: clean(input.doseGiven),
      p_route_given: clean(input.routeGiven),
      p_indication: indication,
      p_symptom_score_before: input.symptomScoreBefore ?? null,
      p_followup_due_at: clean(input.followupDueAtIso),
      p_status: input.status,
      p_notes: clean(input.notes),
      p_administered_by: input.actor.userId,
      p_administered_by_name: input.actor.fullName,
      p_idempotency_key: idempotencyKey,
      p_now: toEasternISO()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save PRN medication administration.";
    const mapped = mapMissingRpcError(message, RECORD_PRN_ADMIN_RPC);
    if (mapped) throw new Error(mapped);
    throw error;
  }

  const row = rpcResult[0];
  if (!row?.log_id || !row.member_id || !row.medication_order_id) {
    throw new Error("PRN medication administration RPC did not return the saved log.");
  }

  const orderOption = await loadPrnMedicationOrderOptionById(row.medication_order_id, input.serviceRole ?? true);
  if (!row.duplicate_safe) {
    await recordWorkflowEvent({
      eventType: "mar_administration_documented",
      entityType: "med_administration_log",
      entityId: row.log_id,
      actorType: "user",
      actorUserId: input.actor.userId,
      status: input.status.toLowerCase(),
      severity: input.status === "Given" ? "low" : "medium",
      dedupeKey: `mar-prn-administration:${idempotencyKey}`,
      metadata: {
        member_id: row.member_id,
        medication_order_id: row.medication_order_id,
        pof_medication_id: orderOption.pofMedicationId,
        indication,
        followup_status: row.followup_status
      }
    });
    try {
      await recordWorkflowMilestone({
        event: {
          event_type: "mar_administration_documented",
          entity_type: "med_administration_log",
          entity_id: row.log_id,
          actor_type: "user",
          actor_id: input.actor.userId,
          actor_user_id: input.actor.userId,
          status: input.status.toLowerCase(),
          severity: input.status === "Given" ? "low" : "medium",
          metadata: {
            member_id: row.member_id,
            medication_order_id: row.medication_order_id,
            indication,
            followup_status: row.followup_status
          }
        }
      });
    } catch (error) {
      console.error("[mar-prn-workflow] unable to emit PRN administration milestone", error);
    }
  }

  return {
    administrationId: row.log_id,
    memberId: row.member_id,
    medicationOrderId: row.medication_order_id,
    administeredAt,
    followupDueAt: row.followup_due_at,
    followupStatus: row.followup_status,
    duplicateSafe: Boolean(row.duplicate_safe),
    orderOption
  };
}

export async function createPrnMedicationOrderAndAdministration(input: {
  memberId: string;
  order: {
    physicianOrderId?: string | null;
    pofMedicationId?: string | null;
    sourceMedicationId?: string | null;
    medicationName: string;
    strength?: string | null;
    form?: string | null;
    route?: string | null;
    directions: string;
    prnReason?: string | null;
    frequencyText?: string | null;
    minIntervalMinutes?: number | null;
    maxDosesPer24h?: number | null;
    maxDailyDose?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    providerName: string;
    requiresReview?: boolean;
    requiresEffectivenessFollowup?: boolean;
  };
  administration: {
    administeredAtIso?: string | null;
    doseGiven?: string | null;
    routeGiven?: string | null;
    indication: string;
    symptomScoreBefore?: number | null;
    followupDueAtIso?: string | null;
    status: MarPrnStatus;
    notes?: string | null;
    submissionId?: string | null;
  };
  actor: {
    userId: string;
    fullName: string;
  };
  serviceRole?: boolean;
}) {
  const memberId = await resolveCanonicalMemberId(input.memberId, {
    actionLabel: "createPrnMedicationOrderAndAdministration",
    serviceRole: input.serviceRole ?? true
  });
  const administeredAt = clean(input.administration.administeredAtIso) ?? toEasternISO();
  const indication = clean(input.administration.indication);
  if (!indication) throw new Error("Indication is required.");
  const orderCreationIdempotencyKey = buildPrnOrderCreationIdempotencyKey({
    memberId,
    order: input.order,
    administration: {
      administeredAt,
      indication,
      status: input.administration.status,
      submissionId: input.administration.submissionId
    }
  });
  const administrationIdempotencyKey = buildPrnAdministrationIdempotencyKey({
    medicationOrderId: orderCreationIdempotencyKey,
    administeredAt,
    indication,
    status: input.administration.status,
    submissionId: input.administration.submissionId
  });
  const supabase = await createClient({ serviceRole: input.serviceRole ?? true });
  let rpcResult: Array<{
    medication_order_id: string;
    log_id: string;
    member_id: string;
    followup_due_at: string | null;
    followup_status: MarPrnFollowupStatus;
    duplicate_safe: boolean;
  }>;
  try {
    rpcResult = await invokeSupabaseRpcOrThrow(supabase, CREATE_PRN_ORDER_AND_ADMIN_RPC, {
      p_member_id: memberId,
      p_order_payload: {
        physician_order_id: clean(input.order.physicianOrderId),
        pof_medication_id: clean(input.order.pofMedicationId),
        source_medication_id: clean(input.order.sourceMedicationId),
        medication_name: clean(input.order.medicationName),
        strength: clean(input.order.strength),
        form: clean(input.order.form),
        route: clean(input.order.route),
        directions: clean(input.order.directions),
        prn_reason: clean(input.order.prnReason),
        frequency_text: clean(input.order.frequencyText),
        min_interval_minutes: input.order.minIntervalMinutes ?? null,
        max_doses_per_24h: input.order.maxDosesPer24h ?? null,
        max_daily_dose: clean(input.order.maxDailyDose),
        start_date: clean(input.order.startDate),
        end_date: clean(input.order.endDate),
        provider_name: clean(input.order.providerName),
        requires_review: input.order.requiresReview ?? true,
        requires_effectiveness_followup: input.order.requiresEffectivenessFollowup ?? true,
        creation_idempotency_key: orderCreationIdempotencyKey
      },
      p_admin_payload: {
        admin_datetime: administeredAt,
        dose_given: clean(input.administration.doseGiven),
        route_given: clean(input.administration.routeGiven),
        indication,
        symptom_score_before: input.administration.symptomScoreBefore ?? null,
        followup_due_at: clean(input.administration.followupDueAtIso),
        status: input.administration.status,
        notes: clean(input.administration.notes),
        idempotency_key: administrationIdempotencyKey
      },
      p_actor_user_id: input.actor.userId,
      p_actor_name: input.actor.fullName,
      p_now: toEasternISO()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create PRN medication order.";
    const mapped = mapMissingRpcError(message, CREATE_PRN_ORDER_AND_ADMIN_RPC);
    if (mapped) throw new Error(mapped);
    throw error;
  }
  const row = rpcResult[0];
  if (!row?.medication_order_id || !row.log_id || !row.member_id) {
    throw new Error("PRN order RPC did not return the saved order and administration.");
  }
  const orderOption = await loadPrnMedicationOrderOptionById(row.medication_order_id, input.serviceRole ?? true);
  if (!row.duplicate_safe) {
    await recordWorkflowEvent({
      eventType: "mar_prn_order_created",
      entityType: "medication_order",
      entityId: row.medication_order_id,
      actorType: "user",
      actorUserId: input.actor.userId,
      status: "created",
      severity: orderOption.requiresReview ? "medium" : "low",
      dedupeKey: `mar-prn-order-created:${orderCreationIdempotencyKey}`,
      metadata: {
        member_id: row.member_id,
        medication_name: orderOption.medicationName,
        order_source: orderOption.orderSource,
        requires_review: orderOption.requiresReview,
        administration_log_id: row.log_id
      }
    });
  }
  return {
    medicationOrderId: row.medication_order_id,
    administrationId: row.log_id,
    memberId: row.member_id,
    administeredAt,
    followupDueAt: row.followup_due_at,
    followupStatus: row.followup_status,
    duplicateSafe: Boolean(row.duplicate_safe),
    orderOption
  };
}

export async function documentPrnFollowupAssessment(input: {
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
  const supabase = await createClient({ serviceRole: input.serviceRole ?? true });
  let rpcResult: Array<{
    log_id: string;
    member_id: string;
    medication_order_id: string;
    followup_due_at: string | null;
    followup_status: MarPrnFollowupStatus;
    duplicate_safe: boolean;
  }>;
  const outcomeAssessedAt = clean(input.outcomeAssessedAtIso) ?? toEasternISO();
  try {
    rpcResult = await invokeSupabaseRpcOrThrow(supabase, COMPLETE_PRN_FOLLOWUP_RPC, {
      p_log_id: input.administrationId,
      p_effectiveness_result: input.prnOutcome,
      p_followup_notes: clean(input.prnFollowupNote),
      p_assessed_at: outcomeAssessedAt,
      p_now: toEasternISO()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save PRN follow-up.";
    const mapped = mapMissingRpcError(message, COMPLETE_PRN_FOLLOWUP_RPC);
    if (mapped) throw new Error(mapped);
    throw error;
  }
  const row = rpcResult[0];
  if (!row?.log_id || !row.member_id) throw new Error("PRN follow-up RPC did not return the saved log.");
  const followupDedupeKey = buildIdempotencyHash("mar-prn:followup", {
    administrationId: row.log_id,
    prnOutcome: input.prnOutcome,
    prnFollowupNote: clean(input.prnFollowupNote),
    outcomeAssessedAt
  });
  if (!row.duplicate_safe) {
    await recordWorkflowEvent({
      eventType: "mar_prn_followup_completed",
      entityType: "med_administration_log",
      entityId: row.log_id,
      actorType: "user",
      actorUserId: input.actor.userId,
      status: input.prnOutcome.toLowerCase(),
      severity: input.prnOutcome === "Ineffective" ? "high" : "low",
      dedupeKey: `mar-prn-followup:${followupDedupeKey}`,
      metadata: {
        member_id: row.member_id,
        medication_order_id: row.medication_order_id,
        followup_status: row.followup_status
      }
    });
    if (input.prnOutcome === "Ineffective") {
      try {
        await recordWorkflowMilestone({
          event: {
            eventType: "action_required",
            entityType: "med_administration_log",
            entityId: row.log_id,
            actorType: "user",
            actorUserId: input.actor.userId,
            status: "open",
            severity: "high",
            metadata: {
              member_id: row.member_id,
              medication_order_id: row.medication_order_id,
              title: "PRN Follow-up Needed",
              message: "A PRN medication was documented as ineffective. Review the member and complete follow-up now.",
              priority: "high",
              action_url: `/health/mar?memberId=${row.member_id}`
            }
          }
        });
      } catch (error) {
        console.error("[mar-prn-workflow] unable to emit PRN follow-up notification", error);
      }
    }
  }
  return {
    administrationId: row.log_id,
    memberId: row.member_id,
    medicationOrderId: row.medication_order_id,
    followupDueAt: row.followup_due_at,
    followupStatus: row.followup_status,
    outcomeAssessedAt,
    duplicateSafe: Boolean(row.duplicate_safe)
  };
}
