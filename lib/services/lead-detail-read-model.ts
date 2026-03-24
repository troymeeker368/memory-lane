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
const PARTNER_DETAIL_SELECT = "id, partner_id, organization_name, category, location, primary_phone, primary_email, notes, last_touched";
const REFERRAL_SOURCE_DETAIL_SELECT =
  "id, referral_source_id, partner_id, contact_name, organization_name, job_title, primary_phone, primary_email, preferred_contact_method, last_touched";
const LEAD_ACTIVITY_DETAIL_SELECT =
  "id, lead_id, activity_at, activity_type, outcome, next_follow_up_date, next_follow_up_type, notes, member_name";
const LEAD_STAGE_HISTORY_SELECT =
  "id, lead_id, changed_at, from_stage, to_stage, from_status, to_status, changed_by_name, source, reason";
const PARTNER_ACTIVITY_DETAIL_SELECT =
  "id, activity_at, activity_type, organization_name, contact_name, notes";

type LeadDetailRow = {
  id: string;
  stage: string;
  status: string;
  inquiry_date: string;
  member_name: string;
  caregiver_name: string | null;
  caregiver_relationship: string | null;
  caregiver_phone: string | null;
  caregiver_email: string | null;
  member_start_date: string | null;
  lead_source: string | null;
  partner_id: string | null;
  referral_source_id: string | null;
  referral_name: string | null;
  likelihood: string | null;
  next_follow_up_date: string | null;
  next_follow_up_type: string | null;
};

type LeadDetailActivityRow = {
  id: string;
  lead_id: string | null;
  activity_at: string;
  activity_type: string | null;
  outcome: string | null;
  next_follow_up_date: string;
  next_follow_up_type: string | null;
  notes: string | null;
  member_name: string | null;
};

type LeadStageHistoryRow = {
  id: string;
  lead_id: string | null;
  changed_at: string;
  from_stage: string | null;
  to_stage: string | null;
  from_status: string | null;
  to_status: string | null;
  changed_by_name: string | null;
  source: string | null;
  reason: string | null;
};

type LeadPartnerRow = {
  id: string;
  partner_id: string | null;
  organization_name: string | null;
  category: string | null;
  referral_source_category: string | null;
  contact_name: string | null;
  location: string | null;
  primary_phone: string | null;
  primary_email: string | null;
  notes: string | null;
  last_touched: string | null;
};

function normalizeLeadPartnerRow(row: Record<string, unknown> | null): LeadPartnerRow | null {
  if (!row) return null;
  const category = typeof row.category === "string" ? row.category : null;
  return {
    id: String(row.id ?? ""),
    partner_id: typeof row.partner_id === "string" ? row.partner_id : null,
    organization_name: typeof row.organization_name === "string" ? row.organization_name : null,
    category,
    referral_source_category: category,
    contact_name: null,
    location: typeof row.location === "string" ? row.location : null,
    primary_phone: typeof row.primary_phone === "string" ? row.primary_phone : null,
    primary_email: typeof row.primary_email === "string" ? row.primary_email : null,
    notes: typeof row.notes === "string" ? row.notes : null,
    last_touched: typeof row.last_touched === "string" ? row.last_touched : null
  };
}

type LeadReferralSourceRow = {
  id: string;
  referral_source_id: string | null;
  partner_id: string | null;
  contact_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  primary_phone: string | null;
  primary_email: string | null;
  preferred_contact_method: string | null;
  last_touched: string | null;
};

type LeadPartnerActivityRow = {
  id: string;
  activity_at: string;
  activity_type: string | null;
  organization_name: string | null;
  contact_name: string | null;
  notes: string | null;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isInvalidUuidFilterError(message: string) {
  return message.toLowerCase().includes("invalid input syntax for type uuid");
}

export async function getLeadDetail(leadId: string): Promise<{
  lead: LeadDetailRow;
  activities: LeadDetailActivityRow[];
  stageHistory: LeadStageHistoryRow[];
  canonicalMemberId: string | null;
  partner: LeadPartnerRow | null;
  referralSource: LeadReferralSourceRow | null;
  partnerActivities: LeadPartnerActivityRow[];
} | null> {
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
  const leadResult = await supabase
    .from("leads")
    .select(LEAD_DETAIL_SELECT)
    .eq("id", canonicalLeadId)
    .maybeSingle();
  if (leadResult.error) throw new Error(leadResult.error.message);
  const rawLead = (leadResult.data as unknown as LeadDetailRow | null) ?? null;
  if (!rawLead) return null;
  const lead: LeadDetailRow = {
    ...rawLead,
    stage: String(rawLead.stage ?? ""),
    status: String(rawLead.status ?? ""),
    inquiry_date: String(rawLead.inquiry_date ?? ""),
    member_name: String(rawLead.member_name ?? "")
  };

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

  const partner = partnerResult.error ? null : normalizeLeadPartnerRow((partnerResult.data as Record<string, unknown> | null) ?? null);
  const referralSource = referralSourceResult.error
    ? null
    : ((referralSourceResult.data as unknown as LeadReferralSourceRow | null) ?? null);

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
    activities: (((activitiesResult.data ?? []) as unknown) as LeadDetailActivityRow[]).map((activity) => ({
      ...activity,
      next_follow_up_date: String(activity.next_follow_up_date ?? "")
    })),
    stageHistory: ((stageHistoryResult.data ?? []) as unknown) as LeadStageHistoryRow[],
    canonicalMemberId: canonical.memberId ?? null,
    partner,
    referralSource,
    partnerActivities: ((partnerActivities ?? []) as unknown) as LeadPartnerActivityRow[]
  };
}
