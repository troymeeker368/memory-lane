import "server-only";

import {
  getSalesPartnerByIdOrCodeSupabase,
  getSalesReferralSourceByIdOrCodeSupabase,
  getSalesReferralSourcesForPartnerIdsSupabase,
  type SalesPartnerRow,
  type SalesReferralSourceRow
} from "@/lib/services/sales-crm-read-model";
import { createClient } from "@/lib/supabase/server";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const NEVER_MATCH_UUID = "00000000-0000-0000-0000-000000000000";
const LEAD_LIST_SELECT =
  "id, member_name, stage, caregiver_name, lead_source, inquiry_date, created_at";
const LEAD_ACTIVITY_SELECT =
  "id, lead_id, referral_source_id, activity_at, activity_type, outcome, notes, member_name";
const PARTNER_ACTIVITY_SELECT =
  "id, partner_id, referral_source_id, activity_at, activity_type, contact_name, next_follow_up_date, next_follow_up_type, notes";

type PartnerDetailRow = {
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

function normalizePartnerDetailRow(row: SalesPartnerRow | null): PartnerDetailRow | null {
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

type ReferralSourceListRow = {
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

type PartnerLeadRow = {
  id: string;
  member_name: string | null;
  stage: string | null;
  caregiver_name: string | null;
  lead_source: string | null;
  inquiry_date: string;
  created_at: string;
};

type PartnerLeadActivityRow = {
  id: string;
  lead_id: string | null;
  referral_source_id: string | null;
  activity_at: string;
  activity_type: string | null;
  outcome: string | null;
  notes: string | null;
  member_name: string | null;
};

type PartnerActivityRow = {
  id: string;
  partner_id: string | null;
  referral_source_id: string | null;
  activity_at: string;
  activity_type: string | null;
  contact_name: string | null;
  next_follow_up_date: string;
  next_follow_up_type: string | null;
  notes: string | null;
};

export async function getPartnerDetail(partnerId: string) {
  const supabase = await createClient();
  const partner = normalizePartnerDetailRow(await getSalesPartnerByIdOrCodeSupabase(partnerId));
  if (!partner) return null;

  const referralSources = await getSalesReferralSourcesForPartnerIdsSupabase([partner.id]);

  const sourceUuidIds = referralSources
    .map((source) => String(source.id ?? ""))
    .filter((id) => isUuid(id));
  const partnerUuid = isUuid(String(partner.id ?? "")) ? String(partner.id) : null;

  const leadFilters = [
    partnerUuid ? `partner_id.eq.${partnerUuid}` : null,
    ...sourceUuidIds.map((id) => `referral_source_id.eq.${id}`)
  ].filter(Boolean) as string[];
  const leadsQueryBase = supabase
    .from("leads")
    .select(LEAD_LIST_SELECT)
    .order("created_at", { ascending: false })
    .limit(200);
  const { data: leads, error: leadsError } = leadFilters.length > 0
    ? await leadsQueryBase.or(leadFilters.join(","))
    : await leadsQueryBase.eq("id", NEVER_MATCH_UUID);
  if (leadsError) throw new Error(leadsError.message);

  const leadIds = (leads ?? []).map((lead) => String(lead.id)).filter((id) => isUuid(id));

  let leadActivitiesQuery = supabase
    .from("lead_activities")
    .select(LEAD_ACTIVITY_SELECT)
    .order("activity_at", { ascending: false })
    .limit(200);
  if (leadIds.length > 0) {
    leadActivitiesQuery = leadActivitiesQuery.in("lead_id", leadIds);
  } else {
    leadActivitiesQuery = leadActivitiesQuery.eq("lead_id", NEVER_MATCH_UUID);
  }
  const { data: leadActivities, error: leadActivitiesError } = await leadActivitiesQuery;
  if (leadActivitiesError) throw new Error(leadActivitiesError.message);

  const partnerActivityFilters = [
    partnerUuid ? `partner_id.eq.${partnerUuid}` : null,
    ...sourceUuidIds.map((id) => `referral_source_id.eq.${id}`)
  ].filter(Boolean) as string[];
  let partnerActivitiesQuery = supabase
    .from("partner_activities")
    .select(PARTNER_ACTIVITY_SELECT)
    .order("activity_at", { ascending: false })
    .limit(200);
  if (partnerActivityFilters.length > 0) {
    partnerActivitiesQuery = partnerActivitiesQuery.or(partnerActivityFilters.join(","));
  } else {
    partnerActivitiesQuery = partnerActivitiesQuery.eq("lead_id", NEVER_MATCH_UUID);
  }
  const { data: partnerActivities, error: partnerActivitiesError } = await partnerActivitiesQuery;
  if (partnerActivitiesError) throw new Error(partnerActivitiesError.message);

  return {
    partner,
    referralSources: (referralSources as unknown) as ReferralSourceListRow[],
    leads: (((leads ?? []) as unknown) as PartnerLeadRow[]).map((lead) => ({
      ...lead,
      inquiry_date: String(lead.inquiry_date ?? "")
    })),
    leadActivities: ((leadActivities ?? []) as unknown) as PartnerLeadActivityRow[],
    partnerActivities: (((partnerActivities ?? []) as unknown) as PartnerActivityRow[]).map((activity) => ({
      ...activity,
      next_follow_up_date: String(activity.next_follow_up_date ?? "")
    }))
  };
}

export async function getReferralSourceDetail(sourceId: string) {
  const supabase = await createClient();
  const referralSource = (await getSalesReferralSourceByIdOrCodeSupabase(sourceId)) as SalesReferralSourceRow | null;
  if (!referralSource) return null;

  const sourceUuid = isUuid(String(referralSource.id ?? "")) ? String(referralSource.id) : null;
  const partnerKey = String(referralSource.partner_id ?? "");
  const partnerUuid = isUuid(partnerKey) ? partnerKey : null;

  const partnerPromise = partnerKey ? getSalesPartnerByIdOrCodeSupabase(partnerKey) : Promise.resolve(null);

  const leadQueryFilters = [
    sourceUuid ? `referral_source_id.eq.${sourceUuid}` : null,
    partnerUuid ? `partner_id.eq.${partnerUuid}` : null
  ].filter(Boolean) as string[];

  const leadsQueryBase = supabase.from("leads").select(LEAD_LIST_SELECT).order("created_at", { ascending: false }).limit(200);
  const leadsQuery =
    leadQueryFilters.length > 0 ? leadsQueryBase.or(leadQueryFilters.join(",")) : leadsQueryBase.eq("id", NEVER_MATCH_UUID);

  let leadActivitiesQuery = supabase
    .from("lead_activities")
    .select(LEAD_ACTIVITY_SELECT)
    .order("activity_at", { ascending: false })
    .limit(200);
  if (sourceUuid) {
    leadActivitiesQuery = leadActivitiesQuery.eq("referral_source_id", sourceUuid);
  } else {
    leadActivitiesQuery = leadActivitiesQuery.eq("lead_id", NEVER_MATCH_UUID);
  }

  let partnerActivitiesQuery = supabase
    .from("partner_activities")
    .select(PARTNER_ACTIVITY_SELECT)
    .order("activity_at", { ascending: false })
    .limit(200);
  const referralActivityFilters = [
    sourceUuid ? `referral_source_id.eq.${sourceUuid}` : null,
    partnerUuid ? `partner_id.eq.${partnerUuid}` : null
  ].filter(Boolean) as string[];
  if (referralActivityFilters.length > 0) {
    partnerActivitiesQuery = partnerActivitiesQuery.or(referralActivityFilters.join(","));
  } else {
    partnerActivitiesQuery = partnerActivitiesQuery.eq("lead_id", NEVER_MATCH_UUID);
  }

  const [partnerResult, leadsResult, leadActivitiesResult, partnerActivitiesResult] = await Promise.all([
    partnerPromise,
    leadsQuery,
    leadActivitiesQuery,
    partnerActivitiesQuery
  ]);

  if (leadsResult.error) throw new Error(leadsResult.error.message);
  if (leadActivitiesResult.error) throw new Error(leadActivitiesResult.error.message);
  if (partnerActivitiesResult.error) throw new Error(partnerActivitiesResult.error.message);

  return {
    referralSource,
    partner: normalizePartnerDetailRow(partnerResult),
    leads: ((((leadsResult.data ?? []) as unknown) as PartnerLeadRow[])).map((lead) => ({
      ...lead,
      inquiry_date: String(lead.inquiry_date ?? "")
    })),
    leadActivities: ((leadActivitiesResult.data ?? []) as unknown) as PartnerLeadActivityRow[],
    partnerActivities: ((((partnerActivitiesResult.data ?? []) as unknown) as PartnerActivityRow[])).map((activity) => ({
      ...activity,
      next_follow_up_date: String(activity.next_follow_up_date ?? "")
    }))
  };
}
