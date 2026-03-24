import { resolveCanonicalLeadRef } from "@/lib/services/canonical-person-ref";
import { createClient } from "@/lib/supabase/server";

const NEVER_MATCH_UUID = "00000000-0000-0000-0000-000000000000";
const LEAD_DETAIL_SELECT = [
  "id",
  "stage",
  "status",
  "inquiry_date",
  "member_name",
  "caregiver_name",
  "caregiver_relationship",
  "caregiver_phone",
  "caregiver_email",
  "member_start_date",
  "lead_source",
  "partner_id",
  "referral_source_id",
  "referral_name",
  "likelihood",
  "next_follow_up_date",
  "next_follow_up_type"
].join(", ");
const PARTNER_DETAIL_SELECT =
  "id, partner_id, organization_name, category, referral_source_category, contact_name, location, primary_phone, primary_email, notes, last_touched";
const REFERRAL_SOURCE_DETAIL_SELECT =
  "id, referral_source_id, partner_id, contact_name, organization_name, job_title, primary_phone, primary_email, preferred_contact_method, last_touched";
const LEAD_ACTIVITY_DETAIL_SELECT =
  "id, lead_id, activity_at, activity_type, outcome, next_follow_up_date, next_follow_up_type, notes, member_name";
const LEAD_STAGE_HISTORY_SELECT =
  "id, lead_id, changed_at, from_stage, to_stage, from_status, to_status, changed_by_name, source, reason";
const PARTNER_ACTIVITY_DETAIL_SELECT =
  "id, activity_at, activity_type, organization_name, contact_name, notes";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isInvalidUuidFilterError(message: string) {
  return message.toLowerCase().includes("invalid input syntax for type uuid");
}

export async function getLeadDetail(leadId: string) {
  const canonical = await resolveCanonicalLeadRef(
    {
      sourceType: "lead",
      leadId,
      selectedId: leadId
    },
    {
      actionLabel: "getLeadDetail"
    }
  );
  if (!canonical.leadId) {
    throw new Error("getLeadDetail expected lead.id but canonical lead resolution returned empty leadId.");
  }
  const canonicalLeadId = canonical.leadId;

  const supabase = await createClient();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select(LEAD_DETAIL_SELECT)
    .eq("id", canonicalLeadId)
    .maybeSingle();
  if (leadError) throw new Error(leadError.message);
  if (!lead) return null;

  const partnerId = String(lead.partner_id ?? "").trim();
  const referralSourceId = String(lead.referral_source_id ?? "").trim();
  const referralName = String(lead.referral_name ?? "").trim();

  const partnerPromise = partnerId
    ? (() => {
        const filters = [
          isUuid(partnerId) ? `id.eq.${partnerId}` : null,
          `partner_id.eq.${partnerId}`
        ].filter(Boolean) as string[];
        return supabase.from("community_partner_organizations").select(PARTNER_DETAIL_SELECT).or(filters.join(",")).maybeSingle();
      })()
    : Promise.resolve({ data: null, error: null } as const);

  const referralSourcePromise = referralSourceId
    ? (() => {
        const filters = [
          isUuid(referralSourceId) ? `id.eq.${referralSourceId}` : null,
          `referral_source_id.eq.${referralSourceId}`
        ].filter(Boolean) as string[];
        return supabase.from("referral_sources").select(REFERRAL_SOURCE_DETAIL_SELECT).or(filters.join(",")).maybeSingle();
      })()
    : referralName
      ? supabase
          .from("referral_sources")
          .select(REFERRAL_SOURCE_DETAIL_SELECT)
          .or(`contact_name.eq.${referralName},organization_name.eq.${referralName}`)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as const);

  const [activitiesResult, stageHistoryResult, partnerResult, referralSourceResult] = await Promise.all([
    supabase
      .from("lead_activities")
      .select(LEAD_ACTIVITY_DETAIL_SELECT)
      .eq("lead_id", canonicalLeadId)
      .order("activity_at", { ascending: false }),
    supabase
      .from("lead_stage_history")
      .select(LEAD_STAGE_HISTORY_SELECT)
      .eq("lead_id", canonicalLeadId)
      .order("changed_at", { ascending: false }),
    partnerPromise,
    referralSourcePromise
  ]);

  if (activitiesResult.error) throw new Error(activitiesResult.error.message);
  if (stageHistoryResult.error) throw new Error(stageHistoryResult.error.message);
  if (partnerResult.error && !isInvalidUuidFilterError(partnerResult.error.message)) {
    throw new Error(partnerResult.error.message);
  }
  if (referralSourceResult.error && !isInvalidUuidFilterError(referralSourceResult.error.message)) {
    throw new Error(referralSourceResult.error.message);
  }

  const partner = partnerResult.error ? null : partnerResult.data ?? null;
  const referralSource = referralSourceResult.error ? null : referralSourceResult.data ?? null;

  let partnerActivitiesQuery = supabase
    .from("partner_activities")
    .select(PARTNER_ACTIVITY_DETAIL_SELECT)
    .order("activity_at", { ascending: false })
    .limit(200);
  const partnerFilters = [
    isUuid(String(lead.id ?? "")) ? `lead_id.eq.${lead.id}` : null,
    isUuid(String(partner?.id ?? "")) ? `partner_id.eq.${partner?.id}` : null,
    isUuid(String(referralSource?.id ?? "")) ? `referral_source_id.eq.${referralSource?.id}` : null
  ].filter(Boolean);
  if (partnerFilters.length > 0) {
    partnerActivitiesQuery = partnerActivitiesQuery.or(partnerFilters.join(","));
  } else {
    partnerActivitiesQuery = partnerActivitiesQuery.eq("lead_id", NEVER_MATCH_UUID);
  }

  const { data: partnerActivities, error: partnerActivitiesError } = await partnerActivitiesQuery;
  if (partnerActivitiesError) throw new Error(partnerActivitiesError.message);

  return {
    lead,
    activities: activitiesResult.data ?? [],
    stageHistory: stageHistoryResult.data ?? [],
    canonicalMemberId: canonical.memberId ?? null,
    partner,
    referralSource,
    partnerActivities: partnerActivities ?? []
  };
}
