import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { createClient } from "@/lib/supabase/server";

type EnrollmentPacketStagingFlags = {
  medicationDuringDayRequired: boolean;
  oxygenUse: boolean;
  recentFalls: boolean;
  behavioralRisk: boolean;
  mobilityAssistanceRequired: boolean;
};

export type EnrollmentPacketPofStagingSummary = {
  stagingId: string;
  packetId: string;
  memberId: string;
  leadId: string | null;
  requestStatus: string | null;
  reviewRequired: boolean;
  importedAt: string | null;
  updatedAt: string | null;
  caregiverName: string | null;
  initiatedByUserId: string | null;
  initiatedByName: string | null;
  sourceLabel: string;
  riskSignals: string[];
  flags: EnrollmentPacketStagingFlags;
  prefillPayload: Record<string, unknown>;
};

type StagingRow = {
  id: string;
  packet_id: string;
  member_id: string;
  prefill_payload: Record<string, unknown> | null;
  review_required: boolean;
  updated_at: string;
};

type RequestRow = {
  id: string;
  lead_id: string | null;
  sender_user_id: string | null;
  completed_at: string | null;
  status: string | null;
};

type SignatureRow = {
  signer_name: string | null;
};

function clean(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return null;
  if (["yes", "y", "true", "1"].includes(normalized)) return true;
  if (["no", "n", "false", "0"].includes(normalized)) return false;
  return null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clean(item)).filter((item): item is string => Boolean(item));
}

function includeSignal(signals: string[], condition: boolean, text: string) {
  if (!condition) return;
  if (!signals.includes(text)) signals.push(text);
}

export function deriveEnrollmentPacketPofRiskSignals(payload: Record<string, unknown>) {
  const medicationDuringDayRequired =
    readBoolean(payload.medicationDuringDayRequired) === true || clean(payload.medicationsDuringDay) != null;
  const oxygenUse =
    readBoolean(payload.oxygenUseRequired) === true ||
    clean(payload.oxygenUse) != null ||
    clean(payload.oxygenFlowRate) != null;
  const recentFalls =
    readBoolean(payload.recentFalls) === true || readBoolean(payload.fallsWithinLast3Months) === true;
  const behavioralRiskSelections = readStringArray(payload.behavioralRiskSelections);
  const behavioralRisk = behavioralRiskSelections.length > 0;
  const mobilityAssistanceRequired =
    readBoolean(payload.mobilityAssistanceRequired) === true || clean(payload.mobilitySupport) != null;

  const riskSignals: string[] = [];
  includeSignal(riskSignals, medicationDuringDayRequired, "Medication during day required");
  includeSignal(riskSignals, oxygenUse, "Oxygen support indicated");
  includeSignal(riskSignals, recentFalls, "Falls reported within last 3 months");
  includeSignal(riskSignals, mobilityAssistanceRequired, "Mobility assistance required");
  if (behavioralRisk) {
    riskSignals.push(`Behavioral risk indicators: ${behavioralRiskSelections.join(", ")}`);
  }

  return {
    riskSignals,
    flags: {
      medicationDuringDayRequired,
      oxygenUse,
      recentFalls,
      behavioralRisk,
      mobilityAssistanceRequired
    }
  };
}

export async function getLatestEnrollmentPacketPofStagingSummary(
  memberId: string,
  options?: { serviceRole?: boolean }
): Promise<EnrollmentPacketPofStagingSummary | null> {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, {
    actionLabel: "getLatestEnrollmentPacketPofStagingSummary"
  });

  const supabase = await createClient({ serviceRole: options?.serviceRole });
  const { data: stagingRow, error: stagingError } = await supabase
    .from("enrollment_packet_pof_staging")
    .select("id, packet_id, member_id, prefill_payload, review_required, updated_at")
    .eq("member_id", canonicalMemberId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (stagingError) throw new Error(stagingError.message);
  if (!stagingRow) return null;

  const staging = stagingRow as StagingRow;
  const prefillPayload =
    staging.prefill_payload && typeof staging.prefill_payload === "object" ? staging.prefill_payload : {};

  const { data: requestRow, error: requestError } = await supabase
    .from("enrollment_packet_requests")
    .select("id, lead_id, sender_user_id, completed_at, status")
    .eq("id", staging.packet_id)
    .maybeSingle();
  if (requestError) throw new Error(requestError.message);
  const request = (requestRow ?? null) as RequestRow | null;

  const { data: caregiverSignatureRow, error: signatureError } = await supabase
    .from("enrollment_packet_signatures")
    .select("signer_name")
    .eq("packet_id", staging.packet_id)
    .eq("signer_role", "caregiver")
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (signatureError) throw new Error(signatureError.message);
  const caregiverSignature = (caregiverSignatureRow ?? null) as SignatureRow | null;

  let initiatedByName: string | null = null;
  if (request?.sender_user_id) {
    const { data: senderRow } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", request.sender_user_id)
      .maybeSingle();
    initiatedByName = clean((senderRow as { full_name?: string | null } | null)?.full_name);
  }

  const derived = deriveEnrollmentPacketPofRiskSignals(prefillPayload);
  return {
    stagingId: staging.id,
    packetId: staging.packet_id,
    memberId: staging.member_id,
    leadId: request?.lead_id ?? null,
    requestStatus: clean(request?.status),
    reviewRequired: Boolean(staging.review_required),
    importedAt: request?.completed_at ?? null,
    updatedAt: staging.updated_at ?? null,
    caregiverName: clean(caregiverSignature?.signer_name) ?? clean(prefillPayload.caregiverProvidedBy),
    initiatedByUserId: request?.sender_user_id ?? null,
    initiatedByName,
    sourceLabel: clean(prefillPayload.sourceLabel) ?? "Caregiver Provided Intake",
    riskSignals: derived.riskSignals,
    flags: derived.flags,
    prefillPayload
  };
}

export async function markEnrollmentPacketPofStagingReviewed(input: {
  memberId: string;
  actorUserId: string | null;
  actorName: string | null;
  serviceRole?: boolean;
}) {
  const canonicalMemberId = await resolveCanonicalMemberId(input.memberId, {
    actionLabel: "markEnrollmentPacketPofStagingReviewed"
  });

  const supabase = await createClient({ serviceRole: input.serviceRole });
  const { data: latestPending, error: latestPendingError } = await supabase
    .from("enrollment_packet_pof_staging")
    .select("id")
    .eq("member_id", canonicalMemberId)
    .eq("review_required", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestPendingError) {
    console.error("[enrollment_packet_pof_staging] unable to load latest pending review row", {
      memberId: canonicalMemberId,
      error: latestPendingError.message
    });
    return false;
  }
  if (!latestPending?.id) return true;

  const { error } = await supabase
    .from("enrollment_packet_pof_staging")
    .update({
      review_required: false,
      updated_by_user_id: clean(input.actorUserId),
      updated_by_name: clean(input.actorName)
    })
    .eq("id", latestPending.id);

  if (error) {
    console.error("[enrollment_packet_pof_staging] unable to mark review completed", {
      memberId: canonicalMemberId,
      error: error.message
    });
    return false;
  }

  return true;
}
