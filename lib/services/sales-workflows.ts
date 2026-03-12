import { canonicalLeadStage, canonicalLeadStatus, isOpenLeadStatus } from "@/lib/canonical";
import { createClient } from "@/lib/supabase/server";

const CANONICAL_STAGE_GROUPS = {
  inquiry: ["Inquiry"],
  tour: ["Tour"],
  eip: ["Enrollment in Progress", "EIP"],
  nurture: ["Nurture"]
};

function normalize(text: string | null | undefined) {
  return (text ?? "").trim().toLowerCase();
}

function hasStage(leadStage: string, allowed: string[]) {
  const normalized = normalize(canonicalLeadStage(leadStage));
  return allowed.some((stage) => normalized === normalize(canonicalLeadStage(stage)));
}

export async function getSalesWorkflows() {
  const supabase = await createClient();
  const [{ data: leads }, { data: activities }, { data: partners }, { data: referralSources }, { data: partnerActivities }] = await Promise.all([
    supabase.from("leads").select("*").order("created_at", { ascending: false }),
    supabase.from("lead_activities").select("*").order("activity_at", { ascending: false }),
    supabase.from("community_partner_organizations").select("*").order("organization_name", { ascending: true }),
    supabase.from("referral_sources").select("*").order("organization_name", { ascending: true }),
    supabase.from("partner_activities").select("*").order("activity_at", { ascending: false })
  ]);

  const allLeads = leads ?? [];
  const openLeads: typeof allLeads = [];
  const wonLeads: typeof allLeads = [];
  const lostLeads: typeof allLeads = [];
  const inquiryLeads: typeof allLeads = [];
  const tourLeads: typeof allLeads = [];
  const eipLeads: typeof allLeads = [];
  const nurtureLeads: typeof allLeads = [];
  const referralOnlyLeads: typeof allLeads = [];

  allLeads.forEach((lead) => {
    const stage = canonicalLeadStage(String(lead.stage ?? "Inquiry"));
    const status = canonicalLeadStatus(String(lead.status ?? "Open"), stage);
    const normalizedLead = {
      ...lead,
      stage,
      status
    };
    if (isOpenLeadStatus(status)) {
      openLeads.push(normalizedLead);
      if (hasStage(stage, CANONICAL_STAGE_GROUPS.inquiry)) inquiryLeads.push(normalizedLead);
      if (hasStage(stage, CANONICAL_STAGE_GROUPS.tour)) tourLeads.push(normalizedLead);
      if (hasStage(stage, CANONICAL_STAGE_GROUPS.eip)) eipLeads.push(normalizedLead);
      if (hasStage(stage, CANONICAL_STAGE_GROUPS.nurture)) nurtureLeads.push(normalizedLead);
      if (normalize(String(lead.lead_source ?? "")).includes("referral")) referralOnlyLeads.push(normalizedLead);
      return;
    }
    if (status === "Won") wonLeads.push(normalizedLead);
    if (status === "Lost") lostLeads.push(normalizedLead);
  });

  const stageCounts = [
    { stage: "Inquiry", count: inquiryLeads.length },
    { stage: "Tour", count: tourLeads.length },
    { stage: "Enrollment in Progress", count: eipLeads.length },
    { stage: "Nurture", count: nurtureLeads.length },
    { stage: "Referrals Only", count: referralOnlyLeads.length },
    { stage: "Closed - Won", count: wonLeads.length },
    { stage: "Closed - Lost", count: lostLeads.length }
  ];

  const partnerById = new Map((partners ?? []).map((partner: any) => [partner.id, partner]));
  const normalizedReferralSources = (referralSources ?? []).map((source: any) => ({
    ...source,
    partner_id: partnerById.get(source.partner_id)?.partner_id ?? source.partner_id
  }));
  const normalizedPartnerActivities = (partnerActivities ?? []).map((activity: any) => ({
    ...activity,
    completed_by: activity.completed_by ?? activity.completed_by_name ?? null
  }));

  return {
    openLeads,
    wonLeads,
    lostLeads,
    inquiryLeads,
    tourLeads,
    eipLeads,
    nurtureLeads,
    referralOnlyLeads,
    stageCounts,
    activities: activities ?? [],
    partners: partners ?? [],
    referralSources: normalizedReferralSources,
    partnerActivities: normalizedPartnerActivities
  };
}

