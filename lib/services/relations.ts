import { getMockDb } from "@/lib/mock-repo";
import { isMockMode } from "@/lib/runtime";
import { getCarePlansForMember } from "@/lib/services/care-plans";
import { getCurrentPayPeriod, isDateInPayPeriod } from "@/lib/pay-period";
import { toEasternDate } from "@/lib/timezone";

function sortDesc<T>(rows: T[], getValue: (row: T) => string) {
  return [...rows].sort((a, b) => (getValue(a) < getValue(b) ? 1 : -1));
}

function summarizePunches(punches: { punch_type: "in" | "out"; punch_at: string }[]) {
  const ordered = [...punches].sort((a, b) => (a.punch_at > b.punch_at ? 1 : -1));
  let total = 0;
  const exceptions: string[] = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const current = ordered[i];
    const next = ordered[i + 1];

    if (current.punch_type === "in") {
      if (!next || next.punch_type !== "out") {
        exceptions.push(`Missing clock-out after ${current.punch_at}`);
        continue;
      }

      const hours = (new Date(next.punch_at).getTime() - new Date(current.punch_at).getTime()) / 3600000;
      if (hours > 12) {
        exceptions.push(`Long shift (${hours.toFixed(2)}h) on ${current.punch_at.slice(0, 10)}`);
      }
      if (hours > 0) {
        total += hours;
      }
    }
  }

  const mealDeduction = total >= 6 ? 0.5 : 0;
  return {
    totalHours: Number(total.toFixed(2)),
    mealDeduction,
    adjustedHours: Number((total - mealDeduction).toFixed(2)),
    exceptions
  };
}

export async function getMemberDetail(
  memberId: string,
  scope?: {
    role?: "admin" | "manager" | "nurse" | "staff";
    staffUserId?: string | null;
  }
) {
  if (!isMockMode()) {
    // TODO(backend): replace with joined member + related logs query set.
    // TODO(backend): apply strict staff-only authored-entry visibility for staff role.
    return null;
  }

  const db = getMockDb();
  const member = db.members.find((m) => m.id === memberId);
  if (!member) return null;

  const isStaffViewer = scope?.role === "staff" && !!scope.staffUserId;
  const staffUserId = scope?.staffUserId ?? null;

  const dailyActivities = sortDesc(
    db.dailyActivities.filter((r) => r.member_id === memberId && (!isStaffViewer || r.staff_user_id === staffUserId)),
    (r) => r.created_at
  );
  const toilets = sortDesc(
    db.toiletLogs.filter((r) => r.member_id === memberId && (!isStaffViewer || r.staff_user_id === staffUserId)),
    (r) => r.event_at
  );
  const showers = sortDesc(
    db.showerLogs.filter((r) => r.member_id === memberId && (!isStaffViewer || r.staff_user_id === staffUserId)),
    (r) => r.event_at
  );
  const transportation = sortDesc(
    db.transportationLogs.filter((r) => r.member_id === memberId && (!isStaffViewer || r.staff_user_id === staffUserId)),
    (r) => `${r.service_date}T00:00:00.000Z`
  );
  const bloodSugar = sortDesc(
    db.bloodSugarLogs.filter((r) => r.member_id === memberId && (!isStaffViewer || r.nurse_user_id === staffUserId)),
    (r) => r.checked_at
  );
  const ancillary = sortDesc(
    db.ancillaryLogs.filter((r) => r.member_id === memberId && (!isStaffViewer || r.staff_user_id === staffUserId)),
    (r) => r.created_at
  );
  const assessments = sortDesc(
    db.assessments.filter((r) => r.member_id === memberId && (!isStaffViewer || r.created_by_user_id === staffUserId)),
    (r) => r.created_at
  );
  const photos = sortDesc(
    db.photoUploads.filter((r) => r.member_id === memberId && (!isStaffViewer || r.uploaded_by === staffUserId)),
    (r) => r.uploaded_at
  );
  const carePlans = isStaffViewer ? [] : getCarePlansForMember(memberId);
  const latestCarePlan = [...carePlans].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return a.reviewDate < b.reviewDate ? 1 : -1;
  })[0] ?? null;

  return {
    member,
    dailyActivities,
    toilets,
    showers,
    transportation,
    bloodSugar,
    ancillary,
    assessments,
    photos,
    carePlans,
    latestCarePlan,
    marToday: isStaffViewer
      ? []
      : [
          {
            id: `mar-${member.id}`,
            date: toEasternDate(),
            medication: "Donepezil",
            dose: "10mg",
            route: "PO",
            frequency: "Daily",
            scheduled_time: "09:00",
            action: "Given",
            staff: "Nina Nurse"
          }
        ]
  };
}

export async function getStaffDetail(staffId: string) {
  if (!isMockMode()) {
    // TODO(backend): replace with staff-centric operational joins.
    return null;
  }

  const db = getMockDb();
  const staff = db.staff.find((s) => s.id === staffId);
  if (!staff) return null;

  const punches = sortDesc(db.timePunches.filter((r) => r.staff_user_id === staffId), (r) => r.punch_at);
  const dailyActivities = sortDesc(db.dailyActivities.filter((r) => r.staff_user_id === staffId), (r) => r.created_at);
  const toilets = sortDesc(db.toiletLogs.filter((r) => r.staff_user_id === staffId), (r) => r.event_at);
  const showers = sortDesc(db.showerLogs.filter((r) => r.staff_user_id === staffId), (r) => r.event_at);
  const transportation = sortDesc(db.transportationLogs.filter((r) => r.staff_user_id === staffId), (r) => `${r.service_date}T00:00:00.000Z`);
  const ancillary = sortDesc(db.ancillaryLogs.filter((r) => r.staff_user_id === staffId), (r) => r.created_at);
  const leadActivities = sortDesc(db.leadActivities.filter((r) => r.completed_by_user_id === staffId), (r) => r.activity_at);
  const assessments = sortDesc(db.assessments.filter((r) => r.created_by_user_id === staffId), (r) => r.created_at);

  return {
    staff,
    punches,
    dailyActivities,
    toilets,
    showers,
    transportation,
    ancillary,
    leadActivities,
    assessments,
    punchSummary: summarizePunches(punches)
  };
}

export async function getLeadDetail(leadId: string) {
  if (!isMockMode()) {
    // TODO(backend): replace with lead + activities + partner/referral/partner-activity joins.
    return null;
  }

  const db = getMockDb();
  const lead = db.leads.find((l) => l.id === leadId);
  if (!lead) return null;

  const partner = lead.partner_id ? db.partners.find((p) => p.partner_id === lead.partner_id) ?? null : null;
  const referralSource = lead.referral_source_id
    ? db.referralSources.find((source) => source.referral_source_id === lead.referral_source_id || source.id === lead.referral_source_id) ?? null
    : lead.referral_name
      ? db.referralSources.find((source) => source.contact_name === lead.referral_name || source.organization_name === lead.referral_name) ?? null
      : null;

  const activities = sortDesc(db.leadActivities.filter((activity) => activity.lead_id === leadId), (activity) => activity.activity_at);
  const stageHistory = sortDesc(
    db.leadStageHistory.filter((history) => history.lead_id === leadId),
    (history) => history.changed_at
  );
  const partnerActivities = sortDesc(
    db.partnerActivities.filter((activity) => {
      if (activity.lead_id === lead.id) return true;
      if (lead.partner_id && activity.partner_id === lead.partner_id) return true;
      if (referralSource && activity.referral_source_id === referralSource.referral_source_id) return true;
      return false;
    }),
    (activity) => activity.activity_at
  );

  return {
    lead,
    activities,
    stageHistory,
    partner,
    referralSource,
    partnerActivities
  };
}

export async function getPartnerDetail(partnerId: string) {
  if (!isMockMode()) {
    // TODO(backend): replace with partner + referral source + lead joins.
    return null;
  }

  const db = getMockDb();
  const partner = db.partners.find((p) => p.id === partnerId || p.partner_id === partnerId);
  if (!partner) return null;

  const referralSources = db.referralSources.filter((source) => source.partner_id === partner.partner_id);
  const referralSourceIds = new Set(referralSources.map((source) => source.referral_source_id));

  const leads = sortDesc(
    db.leads.filter((lead) => lead.partner_id === partner.partner_id || (lead.referral_source_id ? referralSourceIds.has(lead.referral_source_id) : false)),
    (lead) => lead.created_at
  );

  const leadIds = new Set(leads.map((lead) => lead.id));
  const leadActivities = sortDesc(db.leadActivities.filter((activity) => leadIds.has(activity.lead_id)), (activity) => activity.activity_at);
  const partnerActivities = sortDesc(
    db.partnerActivities.filter((activity) => activity.partner_id === partner.partner_id || (activity.referral_source_id ? referralSourceIds.has(activity.referral_source_id) : false)),
    (activity) => activity.activity_at
  );

  return {
    partner,
    referralSources,
    leads,
    leadActivities,
    partnerActivities
  };
}

export async function getReferralSourceDetail(sourceId: string) {
  if (!isMockMode()) {
    // TODO(backend): replace with referral source + partner + linked lead/activity joins.
    return null;
  }

  const db = getMockDb();
  const referralSource = db.referralSources.find((source) => source.id === sourceId || source.referral_source_id === sourceId);
  if (!referralSource) return null;

  const partner = db.partners.find((item) => item.partner_id === referralSource.partner_id) ?? null;

  const leads = sortDesc(
    db.leads.filter((lead) => {
      if (lead.referral_source_id && lead.referral_source_id === referralSource.referral_source_id) return true;
      if (lead.referral_name === referralSource.contact_name || lead.referral_name === referralSource.organization_name) return true;
      if (lead.partner_id && lead.partner_id === referralSource.partner_id) return true;
      return false;
    }),
    (lead) => lead.created_at
  );

  const leadIds = new Set(leads.map((lead) => lead.id));
  const leadActivities = sortDesc(
    db.leadActivities.filter((activity) => {
      if (leadIds.has(activity.lead_id)) return true;
      if (activity.referral_source_id && activity.referral_source_id === referralSource.referral_source_id) return true;
      return false;
    }),
    (activity) => activity.activity_at
  );

  const partnerActivities = sortDesc(
    db.partnerActivities.filter((activity) => {
      if (activity.referral_source_id && activity.referral_source_id === referralSource.referral_source_id) return true;
      if (activity.partner_id === referralSource.partner_id) return true;
      return false;
    }),
    (activity) => activity.activity_at
  );

  return {
    referralSource,
    partner,
    leads,
    leadActivities,
    partnerActivities
  };
}

export async function getAssessmentDetail(assessmentId: string) {
  if (!isMockMode()) {
    // TODO(backend): replace with assessment + member + reviewer relation query.
    return null;
  }

  const db = getMockDb();
  const assessment = db.assessments.find((a) => a.id === assessmentId);
  if (!assessment) return null;

  const member = db.members.find((m) => m.id === assessment.member_id) ?? null;
  const responses = db.assessmentResponses
    .filter((response) => response.assessment_id === assessmentId)
    .sort((a, b) => {
      if (a.section_type === b.section_type) return a.field_label.localeCompare(b.field_label);
      return a.section_type.localeCompare(b.section_type);
    });
  return { assessment, member, responses };
}

export async function getTimeReviewDetail(staffId: string) {
  if (!isMockMode()) {
    // TODO(backend): replace with pay-period rollup and punch exception query.
    return null;
  }

  const db = getMockDb();
  const staff = db.staff.find((s) => s.id === staffId);
  if (!staff) return null;

  const period = getCurrentPayPeriod();
  const punches = sortDesc(
    db.timePunches.filter((p) => p.staff_user_id === staffId).filter((p) => isDateInPayPeriod(p.punch_at, period)),
    (p) => p.punch_at
  );
  const summary = summarizePunches(punches);

  return {
    staff,
    punches,
    payPeriod: period.label,
    ...summary
  };
}
