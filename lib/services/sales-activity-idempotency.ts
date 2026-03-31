import "server-only";

import { buildIdempotencyHash } from "@/lib/services/idempotency";

const RECENT_REPLAY_WINDOW_MS = 15_000;

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export type NormalizedLeadActivityReplayInput = {
  leadId: string;
  activityAt: string | null;
  activityType: string;
  outcome: string;
  lostReason: string | null;
  notes: string | null;
  nextFollowUpDate: string | null;
  nextFollowUpType: string | null;
  completedByUserId: string;
  partnerId: string | null;
  referralSourceId: string | null;
};

export type NormalizedPartnerActivityReplayInput = {
  partnerId: string;
  referralSourceId: string;
  activityAt: string | null;
  activityType: string;
  notes: string | null;
  nextFollowUpDate: string | null;
  nextFollowUpType: string | null;
  completedByName: string;
};

export function normalizeLeadActivityReplayInput(input: NormalizedLeadActivityReplayInput): NormalizedLeadActivityReplayInput {
  return {
    leadId: input.leadId,
    activityAt: clean(input.activityAt),
    activityType: input.activityType,
    outcome: input.outcome,
    lostReason: clean(input.lostReason),
    notes: clean(input.notes),
    nextFollowUpDate: clean(input.nextFollowUpDate),
    nextFollowUpType: clean(input.nextFollowUpType),
    completedByUserId: input.completedByUserId,
    partnerId: clean(input.partnerId),
    referralSourceId: clean(input.referralSourceId)
  };
}

export function normalizePartnerActivityReplayInput(
  input: NormalizedPartnerActivityReplayInput
): NormalizedPartnerActivityReplayInput {
  return {
    partnerId: input.partnerId,
    referralSourceId: input.referralSourceId,
    activityAt: clean(input.activityAt),
    activityType: input.activityType,
    notes: clean(input.notes),
    nextFollowUpDate: clean(input.nextFollowUpDate),
    nextFollowUpType: clean(input.nextFollowUpType),
    completedByName: clean(input.completedByName) ?? ""
  };
}

export function buildLeadActivityReplayKey(input: NormalizedLeadActivityReplayInput) {
  return buildIdempotencyHash("sales-lead-activity:create", input);
}

export function buildPartnerActivityReplayKey(input: NormalizedPartnerActivityReplayInput) {
  return buildIdempotencyHash("sales-partner-activity:create", input);
}

export async function findExistingLeadActivityReplayId(
  supabase: { from: (table: string) => any },
  input: NormalizedLeadActivityReplayInput,
  options?: { allowRecentWindow?: boolean }
) {
  if (input.activityAt) {
    let exactQuery = supabase
      .from("lead_activities")
      .select("id")
      .eq("lead_id", input.leadId)
      .eq("activity_at", input.activityAt)
      .eq("activity_type", input.activityType)
      .eq("outcome", input.outcome)
      .eq("completed_by_user_id", input.completedByUserId);

    exactQuery = input.lostReason === null ? exactQuery.is("lost_reason", null) : exactQuery.eq("lost_reason", input.lostReason);
    exactQuery = input.notes === null ? exactQuery.is("notes", null) : exactQuery.eq("notes", input.notes);
    exactQuery =
      input.nextFollowUpDate === null
        ? exactQuery.is("next_follow_up_date", null)
        : exactQuery.eq("next_follow_up_date", input.nextFollowUpDate);
    exactQuery =
      input.nextFollowUpType === null
        ? exactQuery.is("next_follow_up_type", null)
        : exactQuery.eq("next_follow_up_type", input.nextFollowUpType);
    exactQuery = input.partnerId === null ? exactQuery.is("partner_id", null) : exactQuery.eq("partner_id", input.partnerId);
    exactQuery =
      input.referralSourceId === null
        ? exactQuery.is("referral_source_id", null)
        : exactQuery.eq("referral_source_id", input.referralSourceId);

    const { data, error } = await exactQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.id) return String(data.id);
  }

  if (!options?.allowRecentWindow) return null;

  let recentQuery = supabase
    .from("lead_activities")
    .select("id")
    .eq("lead_id", input.leadId)
    .eq("activity_type", input.activityType)
    .eq("outcome", input.outcome)
    .eq("completed_by_user_id", input.completedByUserId)
    .gte("created_at", new Date(Date.now() - RECENT_REPLAY_WINDOW_MS).toISOString());

  recentQuery = input.lostReason === null ? recentQuery.is("lost_reason", null) : recentQuery.eq("lost_reason", input.lostReason);
  recentQuery = input.notes === null ? recentQuery.is("notes", null) : recentQuery.eq("notes", input.notes);
  recentQuery =
    input.nextFollowUpDate === null
      ? recentQuery.is("next_follow_up_date", null)
      : recentQuery.eq("next_follow_up_date", input.nextFollowUpDate);
  recentQuery =
    input.nextFollowUpType === null
      ? recentQuery.is("next_follow_up_type", null)
      : recentQuery.eq("next_follow_up_type", input.nextFollowUpType);
  recentQuery = input.partnerId === null ? recentQuery.is("partner_id", null) : recentQuery.eq("partner_id", input.partnerId);
  recentQuery =
    input.referralSourceId === null
      ? recentQuery.is("referral_source_id", null)
      : recentQuery.eq("referral_source_id", input.referralSourceId);

  const { data, error } = await recentQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

export async function findExistingPartnerActivityReplayId(
  supabase: { from: (table: string) => any },
  input: NormalizedPartnerActivityReplayInput,
  options?: { allowRecentWindow?: boolean }
) {
  if (input.activityAt) {
    let exactQuery = supabase
      .from("partner_activities")
      .select("id")
      .eq("partner_id", input.partnerId)
      .eq("referral_source_id", input.referralSourceId)
      .eq("activity_at", input.activityAt)
      .eq("activity_type", input.activityType)
      .eq("completed_by_name", input.completedByName);

    exactQuery = input.notes === null ? exactQuery.is("notes", null) : exactQuery.eq("notes", input.notes);
    exactQuery =
      input.nextFollowUpDate === null
        ? exactQuery.is("next_follow_up_date", null)
        : exactQuery.eq("next_follow_up_date", input.nextFollowUpDate);
    exactQuery =
      input.nextFollowUpType === null
        ? exactQuery.is("next_follow_up_type", null)
        : exactQuery.eq("next_follow_up_type", input.nextFollowUpType);

    const { data, error } = await exactQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.id) return String(data.id);
  }

  if (!options?.allowRecentWindow) return null;

  let recentQuery = supabase
    .from("partner_activities")
    .select("id")
    .eq("partner_id", input.partnerId)
    .eq("referral_source_id", input.referralSourceId)
    .eq("activity_type", input.activityType)
    .eq("completed_by_name", input.completedByName)
    .gte("created_at", new Date(Date.now() - RECENT_REPLAY_WINDOW_MS).toISOString());

  recentQuery = input.notes === null ? recentQuery.is("notes", null) : recentQuery.eq("notes", input.notes);
  recentQuery =
    input.nextFollowUpDate === null
      ? recentQuery.is("next_follow_up_date", null)
      : recentQuery.eq("next_follow_up_date", input.nextFollowUpDate);
  recentQuery =
    input.nextFollowUpType === null
      ? recentQuery.is("next_follow_up_type", null)
      : recentQuery.eq("next_follow_up_type", input.nextFollowUpType);

  const { data, error } = await recentQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}
