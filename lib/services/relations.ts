import { normalizeRoleKey } from "@/lib/permissions";
import { getLeadDetail } from "@/lib/services/lead-detail-read-model";
import { getMemberDetail } from "@/lib/services/member-detail-read-model";
import { createClient } from "@/lib/supabase/server";
import { getCurrentPayPeriod, isDateInPayPeriod } from "@/lib/pay-period";
import type { AppRole } from "@/types/app";

export { getLeadDetail, getMemberDetail };

function sortDesc<T>(rows: T[], getValue: (row: T) => string) {
  return [...rows].sort((a, b) => (getValue(a) < getValue(b) ? 1 : -1));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const NEVER_MATCH_UUID = "00000000-0000-0000-0000-000000000000";

function isInvalidUuidFilterError(message: string) {
  return message.toLowerCase().includes("invalid input syntax for type uuid");
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
      if (hours > 0) total += hours;
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

export async function getAssessmentDetail(assessmentId: string) {
  const supabase = await createClient();
  const { data: assessment, error: assessmentError } = await supabase
    .from("intake_assessments")
    .select("*, member:members!intake_assessments_member_id_fkey(*)")
    .eq("id", assessmentId)
    .maybeSingle();
  if (assessmentError) throw new Error(assessmentError.message);
  if (!assessment) return null;

  const { getIntakeAssessmentSignatureState } = await import("@/lib/services/intake-assessment-esign");
  const signature = await getIntakeAssessmentSignatureState(assessmentId);
  const { data: responses, error: responsesError } = await supabase
    .from("assessment_responses")
    .select("*")
    .eq("assessment_id", assessmentId)
    .order("section_type", { ascending: true })
    .order("field_label", { ascending: true });
  if (responsesError) throw new Error(responsesError.message);

  return {
    assessment: {
      ...assessment,
      signed_by: signature.signedByName,
      signed_by_user_id: signature.signedByUserId,
      signed_at: signature.signedAt,
      signature_status: signature.status,
      signature_metadata: signature.signatureMetadata,
      signature_artifact_storage_path: signature.signatureArtifactStoragePath,
      signature_artifact_member_file_id: signature.signatureArtifactMemberFileId,
      member_name: assessment.member?.display_name ?? "Unknown Member"
    },
    member: assessment.member ?? null,
    responses: responses ?? [],
    signature
  }
}

export async function getStaffDetail(staffId: string) {
  const supabase = await createClient();
  const { data: staff, error: staffError } = await supabase.from("profiles").select("*").eq("id", staffId).maybeSingle();
  if (staffError) throw new Error(staffError.message);
  if (!staff) return null;

  const [punchesResult, dailyActivitiesResult, toiletsResult, showersResult, transportationResult, ancillaryResult, leadActivitiesResult, assessmentsResult] =
    await Promise.all([
      supabase.from("time_punches").select("*").eq("staff_user_id", staffId).order("punch_at", { ascending: false }),
      supabase.from("daily_activity_logs").select("*").eq("staff_user_id", staffId).order("created_at", { ascending: false }),
      supabase.from("toilet_logs").select("*").eq("staff_user_id", staffId).order("event_at", { ascending: false }),
      supabase.from("shower_logs").select("*").eq("staff_user_id", staffId).order("event_at", { ascending: false }),
      supabase.from("transportation_logs").select("*").eq("staff_user_id", staffId).order("service_date", { ascending: false }),
      supabase.from("ancillary_charge_logs").select("*").eq("staff_user_id", staffId).order("created_at", { ascending: false }),
      supabase.from("lead_activities").select("*").eq("completed_by_user_id", staffId).order("activity_at", { ascending: false }),
      supabase.from("intake_assessments").select("*").eq("created_by_user_id", staffId).order("created_at", { ascending: false })
    ]);

  if (punchesResult.error) throw new Error(punchesResult.error.message);
  if (dailyActivitiesResult.error) throw new Error(dailyActivitiesResult.error.message);
  if (toiletsResult.error) throw new Error(toiletsResult.error.message);
  if (showersResult.error) throw new Error(showersResult.error.message);
  if (transportationResult.error) throw new Error(transportationResult.error.message);
  if (ancillaryResult.error) throw new Error(ancillaryResult.error.message);
  if (leadActivitiesResult.error) throw new Error(leadActivitiesResult.error.message);
  if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);

  const punches = sortDesc((punchesResult.data ?? []) as Array<{ punch_at: string }>, (r) => r.punch_at);

  return {
    staff,
    punches,
    dailyActivities: dailyActivitiesResult.data ?? [],
    toilets: toiletsResult.data ?? [],
    showers: showersResult.data ?? [],
    transportation: transportationResult.data ?? [],
    ancillary: ancillaryResult.data ?? [],
    leadActivities: leadActivitiesResult.data ?? [],
    assessments: assessmentsResult.data ?? [],
    punchSummary: summarizePunches(
      punches.map((row: any) => ({
        punch_type: row.punch_type,
        punch_at: row.punch_at
      }))
    )
  };
}

export async function getTimeReviewDetail(staffId: string) {
  const supabase = await createClient();
  const { data: staff, error: staffError } = await supabase.from("profiles").select("*").eq("id", staffId).maybeSingle();
  if (staffError) throw new Error(staffError.message);
  if (!staff) return null;

  const period = getCurrentPayPeriod();
  const { data: punches, error: punchesError } = await supabase
    .from("time_punches")
    .select("punch_type, punch_at")
    .eq("staff_user_id", staffId)
    .order("punch_at", { ascending: false });
  if (punchesError) throw new Error(punchesError.message);

  const periodPunches = (punches ?? []).filter((p: any) => isDateInPayPeriod(p.punch_at, period));
  const summary = summarizePunches(periodPunches as Array<{ punch_type: "in" | "out"; punch_at: string }>);

  return {
    staff,
    punches: periodPunches,
    payPeriod: period.label,
    ...summary
  };
}
