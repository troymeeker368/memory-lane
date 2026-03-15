import "server-only";

import { createClient } from "@/lib/supabase/server";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isInvalidUuidFilterError(message: string) {
  return message.toLowerCase().includes("invalid input syntax for type uuid");
}

const NEVER_MATCH_UUID = "00000000-0000-0000-0000-000000000000";

export async function getPartnerDetail(partnerId: string) {
  const supabase = await createClient();
  const partnerFilters = [
    isUuid(partnerId) ? `id.eq.${partnerId}` : null,
    `partner_id.eq.${partnerId}`
  ].filter(Boolean) as string[];
  const { data: partner, error: partnerError } = await supabase
    .from("community_partner_organizations")
    .select("*")
    .or(partnerFilters.join(","))
    .maybeSingle();
  if (partnerError) throw new Error(partnerError.message);
  if (!partner) return null;

  const partnerKey = String(partner.partner_id ?? partner.id);
  const { data: referralSources, error: referralError } = await supabase
    .from("referral_sources")
    .select("*")
    .eq("partner_id", partnerKey)
    .order("organization_name", { ascending: true });
  if (referralError) throw new Error(referralError.message);

  const sourceIds = (referralSources ?? []).map((source: any) => String(source.referral_source_id ?? source.id));
  const sourceUuidIds = (referralSources ?? [])
    .map((source: any) => String(source.id ?? ""))
    .filter((id) => isUuid(id));

  const leadFilters = [`partner_id.eq.${partnerKey}`, ...sourceIds.map((id) => `referral_source_id.eq.${id}`)];
  let { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200)
    .or(leadFilters.join(","));
  if (leadsError && isInvalidUuidFilterError(leadsError.message)) {
    const fallback = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
      .eq("partner_id", partnerKey);
    leads = fallback.data;
    leadsError = fallback.error;
  }
  if (leadsError) throw new Error(leadsError.message);

  const leadIds = (leads ?? []).map((lead: any) => String(lead.id)).filter((id) => isUuid(id));

  let leadActivitiesQuery = supabase.from("lead_activities").select("*").order("activity_at", { ascending: false }).limit(200);
  if (leadIds.length > 0) {
    leadActivitiesQuery = leadActivitiesQuery.in("lead_id", leadIds);
  } else {
    leadActivitiesQuery = leadActivitiesQuery.eq("lead_id", NEVER_MATCH_UUID);
  }
  const { data: leadActivities, error: leadActivitiesError } = await leadActivitiesQuery;
  if (leadActivitiesError) throw new Error(leadActivitiesError.message);

  const partnerActivityFilters = [
    isUuid(String(partner.id ?? "")) ? `partner_id.eq.${partner.id}` : null,
    ...sourceUuidIds.map((id) => `referral_source_id.eq.${id}`)
  ].filter(Boolean) as string[];
  let partnerActivitiesQuery = supabase.from("partner_activities").select("*").order("activity_at", { ascending: false }).limit(200);
  if (partnerActivityFilters.length > 0) {
    partnerActivitiesQuery = partnerActivitiesQuery.or(partnerActivityFilters.join(","));
  } else {
    partnerActivitiesQuery = partnerActivitiesQuery.eq("lead_id", NEVER_MATCH_UUID);
  }
  const { data: partnerActivities, error: partnerActivitiesError } = await partnerActivitiesQuery;
  if (partnerActivitiesError) throw new Error(partnerActivitiesError.message);

  return {
    partner,
    referralSources: referralSources ?? [],
    leads: leads ?? [],
    leadActivities: leadActivities ?? [],
    partnerActivities: partnerActivities ?? []
  };
}

export async function getReferralSourceDetail(sourceId: string) {
  const supabase = await createClient();
  const referralSourceFilters = [
    isUuid(sourceId) ? `id.eq.${sourceId}` : null,
    `referral_source_id.eq.${sourceId}`
  ].filter(Boolean) as string[];
  const { data: referralSource, error: referralError } = await supabase
    .from("referral_sources")
    .select("*")
    .or(referralSourceFilters.join(","))
    .maybeSingle();
  if (referralError) throw new Error(referralError.message);
  if (!referralSource) return null;

  const sourceKey = String(referralSource.referral_source_id ?? referralSource.id);
  const sourceUuid = isUuid(String(referralSource.id ?? "")) ? String(referralSource.id) : null;
  const partnerKey = String(referralSource.partner_id ?? "");
  const partnerUuid = isUuid(partnerKey) ? partnerKey : null;

  const partnerPromise = partnerKey
    ? (() => {
        const filters = [
          isUuid(partnerKey) ? `id.eq.${partnerKey}` : null,
          `partner_id.eq.${partnerKey}`
        ].filter(Boolean) as string[];
        return supabase.from("community_partner_organizations").select("*").or(filters.join(",")).maybeSingle();
      })()
    : Promise.resolve({ data: null, error: null } as const);

  const leadQueryFilters = [
    sourceKey ? `referral_source_id.eq.${sourceKey}` : null,
    partnerKey ? `partner_id.eq.${partnerKey}` : null
  ].filter(Boolean) as string[];

  const leadsQueryBase = supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(200);
  const leadsQuery =
    leadQueryFilters.length > 0 ? leadsQueryBase.or(leadQueryFilters.join(",")) : leadsQueryBase.eq("id", NEVER_MATCH_UUID);

  let leadActivitiesQuery = supabase.from("lead_activities").select("*").order("activity_at", { ascending: false }).limit(200);
  if (sourceUuid) {
    leadActivitiesQuery = leadActivitiesQuery.eq("referral_source_id", sourceUuid);
  } else {
    leadActivitiesQuery = leadActivitiesQuery.eq("lead_id", NEVER_MATCH_UUID);
  }

  let partnerActivitiesQuery = supabase.from("partner_activities").select("*").order("activity_at", { ascending: false }).limit(200);
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

  if (partnerResult.error) throw new Error(partnerResult.error.message);
  if (leadsResult.error && isInvalidUuidFilterError(leadsResult.error.message)) {
    const fallback = partnerKey
      ? await supabase.from("leads").select("*").eq("partner_id", partnerKey).order("created_at", { ascending: false }).limit(200)
      : await supabase.from("leads").select("*").eq("id", NEVER_MATCH_UUID).order("created_at", { ascending: false }).limit(200);
    if (fallback.error) throw new Error(fallback.error.message);
    return {
      referralSource,
      partner: partnerResult.data ?? null,
      leads: fallback.data ?? [],
      leadActivities: leadActivitiesResult.data ?? [],
      partnerActivities: partnerActivitiesResult.data ?? []
    };
  }
  if (leadsResult.error) throw new Error(leadsResult.error.message);
  if (leadActivitiesResult.error) throw new Error(leadActivitiesResult.error.message);
  if (partnerActivitiesResult.error) throw new Error(partnerActivitiesResult.error.message);

  return {
    referralSource,
    partner: partnerResult.data ?? null,
    leads: leadsResult.data ?? [],
    leadActivities: leadActivitiesResult.data ?? [],
    partnerActivities: partnerActivitiesResult.data ?? []
  };
}
