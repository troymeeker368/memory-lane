import { canonicalLeadStage, canonicalLeadStatus } from "@/lib/canonical";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export type CanonicalLeadStage =
  | "Inquiry"
  | "Tour"
  | "Enrollment in Progress"
  | "Nurture"
  | "Closed - Won"
  | "Closed - Lost";

export type CanonicalLeadBusinessStatus = "Open" | "Won" | "Lost" | "Nurture";
export type LeadDbStatus = "open" | "won" | "lost";

export interface LeadStageTransitionResult {
  leadId: string;
  fromStage: string | null;
  toStage: CanonicalLeadStage;
  fromStatus: LeadDbStatus | null;
  toStatus: LeadDbStatus;
  businessStatus: CanonicalLeadBusinessStatus;
}

function toDbStatus(status: CanonicalLeadBusinessStatus): LeadDbStatus {
  if (status === "Won") return "won";
  if (status === "Lost") return "lost";
  return "open";
}

function normalizeCanonicalStage(stage: string): CanonicalLeadStage {
  const normalized = canonicalLeadStage(stage);
  if (normalized === "Tour") return "Tour";
  if (normalized === "Enrollment in Progress") return "Enrollment in Progress";
  if (normalized === "Nurture") return "Nurture";
  if (normalized === "Closed - Won") return "Closed - Won";
  if (normalized === "Closed - Lost") return "Closed - Lost";
  return "Inquiry";
}

function resolveCanonicalLeadTransition(input: {
  requestedStage: string;
  requestedStatus: string;
}) {
  let stage = normalizeCanonicalStage(input.requestedStage);
  let businessStatus = canonicalLeadStatus(input.requestedStatus, stage) as CanonicalLeadBusinessStatus;

  if (stage === "Closed - Lost") businessStatus = "Lost";
  if (businessStatus === "Lost") stage = "Closed - Lost";
  if (businessStatus === "Won") stage = "Closed - Won";
  if (businessStatus === "Nurture" && stage !== "Nurture") stage = "Nurture";

  businessStatus = canonicalLeadStatus(businessStatus, stage) as CanonicalLeadBusinessStatus;
  return {
    stage,
    businessStatus,
    dbStatus: toDbStatus(businessStatus)
  };
}

export async function applyLeadStageTransitionSupabase(input: {
  leadId: string;
  requestedStage: string;
  requestedStatus: string;
  actorUserId: string;
  actorName: string;
  source: string;
  reason?: string | null;
  additionalLeadPatch?: Record<string, unknown>;
}) {
  const supabase = await createClient();
  const { data: existingLead, error: existingError } = await supabase
    .from("leads")
    .select("id, stage, status")
    .eq("id", input.leadId)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (!existingLead) throw new Error("Lead not found.");

  const fromStage = String(existingLead.stage ?? "");
  const fromStatus = String(existingLead.status ?? "").toLowerCase() as LeadDbStatus | "";
  const resolved = resolveCanonicalLeadTransition({
    requestedStage: input.requestedStage,
    requestedStatus: input.requestedStatus
  });
  const now = toEasternISO();

  const patch: Record<string, unknown> = {
    stage: resolved.stage,
    status: resolved.dbStatus,
    stage_updated_at: now,
    updated_at: now,
    ...(input.additionalLeadPatch ?? {})
  };

  const hasClosedDate = Object.prototype.hasOwnProperty.call(patch, "closed_date");
  const hasLostReason = Object.prototype.hasOwnProperty.call(patch, "lost_reason");
  if (resolved.businessStatus === "Lost") {
    if (!hasClosedDate) patch.closed_date = toEasternDate();
  } else if (resolved.businessStatus === "Won") {
    if (!hasClosedDate) patch.closed_date = toEasternDate();
    if (!hasLostReason) patch.lost_reason = null;
  } else {
    if (!hasClosedDate) patch.closed_date = null;
    if (!hasLostReason) patch.lost_reason = null;
  }

  const { error: updateError } = await supabase.from("leads").update(patch).eq("id", input.leadId);
  if (updateError) throw new Error(updateError.message);

  const changed = fromStage !== resolved.stage || fromStatus !== resolved.dbStatus;
  if (changed) {
    const { error: historyError } = await supabase.from("lead_stage_history").insert({
      lead_id: input.leadId,
      from_stage: fromStage || null,
      to_stage: resolved.stage,
      from_status: fromStatus || null,
      to_status: resolved.dbStatus,
      changed_by_user_id: input.actorUserId,
      changed_by_name: input.actorName,
      reason: input.reason ?? null,
      source: input.source,
      changed_at: now,
      created_at: now
    });
    if (historyError) throw new Error(historyError.message);
  }

  return {
    leadId: input.leadId,
    fromStage: fromStage || null,
    toStage: resolved.stage,
    fromStatus: fromStatus || null,
    toStatus: resolved.dbStatus,
    businessStatus: resolved.businessStatus
  } satisfies LeadStageTransitionResult;
}
