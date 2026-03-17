import "server-only";

import { createClient } from "@/lib/supabase/server";
import { insertAuditLogEntry } from "@/lib/services/audit-log-service";
import { getActiveCenterBillingSetting } from "@/lib/services/billing-supabase";
import {
  getTransportationRunManifestSupabase,
  type TransportationRunManifestRow
} from "@/lib/services/transportation-run-manifest-supabase";
import {
  buildTransportationPostingScopeKey,
  TRANSPORTATION_DRIVER_EXCLUSION_REASONS,
  type TransportationDriverExclusionReason
} from "@/lib/services/transportation-run-shared";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { toEasternISO } from "@/lib/timezone";

type Shift = "AM" | "PM";

const POST_TRANSPORTATION_RUN_RPC = "rpc_post_transportation_run";
const TRANSPORTATION_RUN_POSTING_MIGRATION = "0081_transportation_run_posting.sql";

export interface TransportationRunManualExclusionInput {
  memberId: string;
  reason: TransportationDriverExclusionReason;
  notes?: string | null;
}

export interface TransportationRunPostResult {
  runId: string;
  expectedRiders: number;
  postedRiders: number;
  excludedRiders: number;
  skippedDuplicates: number;
  waivedNonbillableRiders: number;
}

type RpcResultPayload = {
  run_id?: string;
  expected_riders?: number;
  posted_riders?: number;
  excluded_riders?: number;
  skipped_duplicates?: number;
  waived_nonbillable_riders?: number;
};

function isMissingTransportRunRpc(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const text = [
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "",
    "details" in error ? String((error as { details?: unknown }).details ?? "") : "",
    "hint" in error ? String((error as { hint?: unknown }).hint ?? "") : "",
    "cause" in error && typeof (error as { cause?: unknown }).cause === "object"
      ? String(((error as { cause?: { message?: unknown } }).cause?.message ?? ""))
      : ""
  ]
    .join(" ")
    .toLowerCase();
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return code === "PGRST202" || text.includes(POST_TRANSPORTATION_RUN_RPC.toLowerCase());
}

function transportRunRpcUnavailableMessage() {
  return `Transportation run posting RPC is not available yet. Apply Supabase migration ${TRANSPORTATION_RUN_POSTING_MIGRATION} first.`;
}

function normalizeManualExclusionReason(value: string): TransportationDriverExclusionReason {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (TRANSPORTATION_DRIVER_EXCLUSION_REASONS.includes(normalized as TransportationDriverExclusionReason)) {
    return normalized as TransportationDriverExclusionReason;
  }
  throw new Error("Invalid transportation exclusion reason.");
}

function trimOptionalText(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function postingReasonCodeForRow(row: TransportationRunManifestRow) {
  if (row.billable) return "none";
  if (row.billingStatus === "Waived") return "billing-waived";
  if (row.billingStatus === "IncludedInProgramRate") return "included-in-program-rate";
  return "none";
}

function mapAutomaticExclusionReason(row: TransportationRunManifestRow) {
  if (row.operationalReasonCode === "absent") return "absent";
  if (row.operationalReasonCode === "inactive") return "inactive";
  if (row.operationalReasonCode === "outside-route-dates") return "outside-route-dates";
  if (row.operationalReasonCode === "member-hold") return "member-hold";
  if (row.operationalReasonCode === "already-posted") return "already-posted";
  return "excluded";
}

function toPostingRow(input: {
  row: TransportationRunManifestRow;
  serviceDate: string;
  shift: Shift;
  oneWayRate: number;
  roundTripRate: number;
  manualExclusionByMemberId: Map<string, { reason: TransportationDriverExclusionReason; notes: string | null }>;
}) {
  const manualExclusion = input.manualExclusionByMemberId.get(input.row.memberId) ?? null;
  const base = {
    member_id: input.row.memberId,
    member_name: input.row.memberName,
    first_name: input.row.firstName,
    service_date: input.serviceDate,
    shift: input.shift,
    bus_number: input.row.busNumber,
    rider_source: input.row.riderSource,
    transport_type: input.row.transportType,
    bus_stop_name: input.row.busStopName,
    door_to_door_address: input.row.doorToDoorAddress,
    caregiver_contact_id: input.row.caregiverContactId,
    caregiver_contact_name_snapshot: input.row.caregiverContactName,
    caregiver_contact_phone_snapshot: input.row.caregiverContactPhone,
    caregiver_contact_address_snapshot: input.row.caregiverContactAddress,
    transportation_billing_status_snapshot: input.row.billingStatus,
    billable: input.row.billable,
    one_way_rate: input.row.billable ? input.oneWayRate : 0,
    round_trip_rate: input.row.billable ? input.roundTripRate : 0,
    posting_scope_key: buildTransportationPostingScopeKey({
      memberId: input.row.memberId,
      serviceDate: input.serviceDate,
      shift: input.shift
    })
  };

  if (manualExclusion) {
    return {
      ...base,
      result_status: "excluded",
      reason_code: manualExclusion.reason,
      reason_notes: manualExclusion.notes
    };
  }

  if (input.row.operationalStatus === "eligible") {
    return {
      ...base,
      result_status: "posted",
      reason_code: postingReasonCodeForRow(input.row),
      reason_notes: trimOptionalText(input.row.notes)
    };
  }

  if (input.row.operationalStatus === "already-posted") {
    return {
      ...base,
      result_status: "duplicate_skipped",
      reason_code: "already-posted",
      reason_notes: trimOptionalText(input.row.notes)
    };
  }

  return {
    ...base,
    billable: false,
    one_way_rate: 0,
    round_trip_rate: 0,
    result_status: "excluded",
    reason_code: mapAutomaticExclusionReason(input.row),
    reason_notes: trimOptionalText(input.row.notes)
  };
}

export async function postTransportationRunSupabase(input: {
  selectedDate: string;
  shift: Shift;
  busNumber: string;
  actor: { id: string; fullName: string; role: string };
  manualExclusions?: TransportationRunManualExclusionInput[];
}) {
  const selectedDate = normalizeOperationalDateOnly(input.selectedDate);
  const shift = input.shift === "PM" ? "PM" : "AM";
  const busNumber = String(input.busNumber ?? "").trim();
  if (!busNumber) {
    throw new Error("Transportation run bus number is required.");
  }

  const manualExclusionByMemberId = new Map<string, { reason: TransportationDriverExclusionReason; notes: string | null }>();
  (input.manualExclusions ?? []).forEach((row) => {
    const memberId = String(row.memberId ?? "").trim();
    if (!memberId) {
      throw new Error("Transportation exclusions require member ids.");
    }
    manualExclusionByMemberId.set(memberId, {
      reason: normalizeManualExclusionReason(row.reason),
      notes: trimOptionalText(row.notes)
    });
  });

  const manifest = await getTransportationRunManifestSupabase({
    selectedDate,
    shift,
    busNumber
  });

  if (manifest.rows.length === 0) {
    throw new Error("No manifest riders were resolved for this transportation run.");
  }

  const hasBillableRows = manifest.rows.some((row) => {
    const manuallyExcluded = manualExclusionByMemberId.has(row.memberId);
    return row.operationalStatus === "eligible" && row.billable && !manuallyExcluded;
  });

  const centerSetting = await getActiveCenterBillingSetting(selectedDate);
  if (hasBillableRows && !centerSetting) {
    throw new Error("No active center billing setting is available for this service date. Transportation cannot be posted safely.");
  }

  const oneWayRate = Number(centerSetting?.default_transport_one_way_rate ?? 0);
  const roundTripRate = Number(centerSetting?.default_transport_round_trip_rate ?? 0);
  const now = toEasternISO();
  const postingRows = manifest.rows.map((row) =>
    toPostingRow({
      row,
      serviceDate: selectedDate,
      shift,
      oneWayRate,
      roundTripRate,
      manualExclusionByMemberId
    })
  );

  const admin = await createClient({ serviceRole: true });
  let rpcResult: RpcResultPayload;
  try {
    rpcResult = await invokeSupabaseRpcOrThrow<RpcResultPayload>(admin, POST_TRANSPORTATION_RUN_RPC, {
      p_run: {
        service_date: selectedDate,
        shift,
        bus_number: busNumber,
        submitted_by_user_id: input.actor.id,
        submitted_by_name: input.actor.fullName,
        submitted_at: now
      },
      p_result_rows: postingRows
    });
  } catch (error) {
    if (isMissingTransportRunRpc(error)) {
      throw new Error(transportRunRpcUnavailableMessage());
    }
    throw error;
  }

  const result: TransportationRunPostResult = {
    runId: String(rpcResult.run_id ?? ""),
    expectedRiders: Number(rpcResult.expected_riders ?? 0),
    postedRiders: Number(rpcResult.posted_riders ?? 0),
    excludedRiders: Number(rpcResult.excluded_riders ?? 0),
    skippedDuplicates: Number(rpcResult.skipped_duplicates ?? 0),
    waivedNonbillableRiders: Number(rpcResult.waived_nonbillable_riders ?? 0)
  };

  if (!result.runId) {
    throw new Error("Transportation run posting did not return a run id.");
  }

  await insertAuditLogEntry({
    actorUserId: input.actor.id,
    actorRole: input.actor.role,
    action: "create_log",
    entityType: "transportation_run",
    entityId: result.runId,
    details: {
      serviceDate: selectedDate,
      shift,
      busNumber,
      expectedRiders: result.expectedRiders,
      postedRiders: result.postedRiders,
      excludedRiders: result.excludedRiders,
      skippedDuplicates: result.skippedDuplicates,
      waivedNonbillableRiders: result.waivedNonbillableRiders
    },
    serviceRole: true
  });

  await recordWorkflowEvent({
    eventType: "transportation_run_posted",
    entityType: "transportation_run",
    entityId: result.runId,
    actorType: "user",
    actorUserId: input.actor.id,
    status: "created",
    severity: "low",
    metadata: {
      service_date: selectedDate,
      shift,
      bus_number: busNumber,
      expected_riders: result.expectedRiders,
      posted_riders: result.postedRiders,
      excluded_riders: result.excludedRiders,
      skipped_duplicates: result.skippedDuplicates,
      waived_nonbillable_riders: result.waivedNonbillableRiders
    }
  });

  return result;
}
