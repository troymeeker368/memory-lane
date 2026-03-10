import { canonicalLeadStage, canonicalLeadStatus, isOpenLeadStatus } from "@/lib/canonical";
import { addMockRecord, getMockDb } from "@/lib/mock-repo";
import { isMockMode } from "@/lib/runtime";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

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

function ensureSalesStageCoverage(db: ReturnType<typeof getMockDb>) {
  const required = [
    { stage: "Inquiry", source: "Referral" },
    { stage: "Tour", source: "Website" },
    { stage: "Enrollment in Progress", source: "Referral" },
    { stage: "Nurture", source: "Community Event" }
  ];

  required.forEach((req, idx) => {
    const exists = db.leads.some((lead) => hasStage(lead.stage, [req.stage]) && isOpenLeadStatus(lead.status));
    if (!exists) {
      addMockRecord("leads", {
        lead_id: `L-SEED-${idx + 1}`,
        created_at: toEasternISO(),
        created_by_user_id: db.staff[0]?.id ?? "",
        created_by_name: db.staff[0]?.full_name ?? "Manager",
        status: req.stage === "Nurture" ? "Nurture" : "Open",
        stage: req.stage,
        stage_updated_at: toEasternISO(),
        inquiry_date: toEasternDate(new Date(Date.now() - (idx + 2) * 86400000)),
        tour_date: null,
        tour_completed: false,
        discovery_date: null,
        member_start_date: null,
        caregiver_name: `Caregiver ${idx + 1}`,
        caregiver_relationship: "Family",
        caregiver_email: `caregiver${idx + 1}@example.com`,
        caregiver_phone: "803-555-1000",
        member_name: `Prospect ${req.stage}`,
        lead_source: req.source,
        referral_name: req.source === "Referral" ? "Referral Source" : null,
        likelihood: "Warm",
        next_follow_up_date: toEasternDate(new Date(Date.now() + (idx + 1) * 86400000)),
        next_follow_up_type: "Call",
        notes_summary: `Seeded ${req.stage} pipeline lead`,
        lost_reason: null,
        closed_date: null,
        partner_id: null
      });
    }
  });
}

export async function getSalesWorkflows() {
  const db = getMockDb();

  if (isMockMode()) {
    ensureSalesStageCoverage(db);

    const openLeads: typeof db.leads = [];
    const wonLeads: typeof db.leads = [];
    const lostLeads: typeof db.leads = [];
    const inquiryLeads: typeof db.leads = [];
    const tourLeads: typeof db.leads = [];
    const eipLeads: typeof db.leads = [];
    const nurtureLeads: typeof db.leads = [];
    const referralOnlyLeads: typeof db.leads = [];

    db.leads.forEach((lead) => {
      const stage = canonicalLeadStage(lead.stage);
      const status = canonicalLeadStatus(lead.status, stage);
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
        if (normalize(lead.lead_source).includes("referral")) referralOnlyLeads.push(normalizedLead);
        return;
      }

      if (status === "Won") {
        wonLeads.push(normalizedLead);
      } else if (status === "Lost") {
        lostLeads.push(normalizedLead);
      }
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

    return {
      openLeads: [...openLeads].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
      wonLeads: [...wonLeads].sort((a, b) => (a.closed_date ?? "" < (b.closed_date ?? "") ? 1 : -1)),
      lostLeads: [...lostLeads].sort((a, b) => (a.closed_date ?? "" < (b.closed_date ?? "") ? 1 : -1)),
      inquiryLeads,
      tourLeads,
      eipLeads,
      nurtureLeads,
      referralOnlyLeads,
      stageCounts,
      activities: [...db.leadActivities].sort((a, b) => (a.activity_at < b.activity_at ? 1 : -1)),
      partners: db.partners,
      referralSources: db.referralSources,
      partnerActivities: db.partnerActivities
    };
  }

  return {
    openLeads: [],
    wonLeads: [],
    lostLeads: [],
    inquiryLeads: [],
    tourLeads: [],
    eipLeads: [],
    nurtureLeads: [],
    referralOnlyLeads: [],
    stageCounts: [],
    activities: [],
    partners: [],
    referralSources: [],
    partnerActivities: []
  };
}

