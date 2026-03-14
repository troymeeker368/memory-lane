import { normalizeRoleKey } from "@/lib/permissions";
import { canAccessCarePlansForRole } from "@/lib/services/care-plan-authorization";
import { resolveCanonicalLeadRef, resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import { createClient } from "@/lib/supabase/server";
import { getCurrentPayPeriod, isDateInPayPeriod } from "@/lib/pay-period";
import type { AppRole } from "@/types/app";

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

function isStackDepthLimitError(message: string | null | undefined) {
  return /stack depth limit exceeded/i.test(String(message ?? ""));
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

export async function getMemberDetail(
  memberId: string,
  scope?: {
    role?: AppRole;
    staffUserId?: string | null;
  }
) {
  const canonical = await resolveCanonicalMemberRef(
    {
      sourceType: "member",
      memberId,
      selectedId: memberId
    },
    {
      actionLabel: "getMemberDetail"
    }
  );
  if (!canonical.memberId) {
    throw new Error("getMemberDetail expected member.id but canonical member resolution returned empty memberId.");
  }
  const canonicalMemberId = canonical.memberId;
  const supabase = await createClient();
  const { data: member, error } = await supabase.from("members").select("*").eq("id", canonicalMemberId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!member) return null;

  const normalizedRole = scope?.role ? normalizeRoleKey(scope.role) : null;
  const isStaffViewer = Boolean(normalizedRole === "program-assistant" && !!scope?.staffUserId);
  const canViewCarePlans = canAccessCarePlansForRole(normalizedRole);
  const staffUserId = scope?.staffUserId ?? null;

  const loadMemberRelations = async (client: Awaited<ReturnType<typeof createClient>>) =>
    Promise.all([
      client.from("daily_activity_logs").select("*").eq("member_id", canonicalMemberId).order("created_at", { ascending: false }),
      client.from("toilet_logs").select("*").eq("member_id", canonicalMemberId).order("event_at", { ascending: false }),
      client.from("shower_logs").select("*").eq("member_id", canonicalMemberId).order("event_at", { ascending: false }),
      client.from("transportation_logs").select("*").eq("member_id", canonicalMemberId).order("service_date", { ascending: false }),
      client.from("blood_sugar_logs").select("*").eq("member_id", canonicalMemberId).order("checked_at", { ascending: false }),
      client.from("ancillary_charge_logs").select("*").eq("member_id", canonicalMemberId).order("created_at", { ascending: false }),
      client.from("intake_assessments").select("*").eq("member_id", canonicalMemberId).order("created_at", { ascending: false }),
      client.from("member_photo_uploads").select("*").eq("member_id", canonicalMemberId).order("uploaded_at", { ascending: false })
    ]);

  let [
    dailyActivitiesResult,
    toiletsResult,
    showersResult,
    transportationResult,
    bloodSugarResult,
    ancillaryResult,
    assessmentsResult,
    photosResult
  ] = await loadMemberRelations(supabase);

  const hasStackDepthResult = [
    dailyActivitiesResult.error?.message,
    toiletsResult.error?.message,
    showersResult.error?.message,
    transportationResult.error?.message,
    bloodSugarResult.error?.message,
    ancillaryResult.error?.message,
    assessmentsResult.error?.message,
    photosResult.error?.message
  ].some((message) => isStackDepthLimitError(message));

  if (hasStackDepthResult) {
    const serviceSupabase = await createClient({ serviceRole: true });
    [
      dailyActivitiesResult,
      toiletsResult,
      showersResult,
      transportationResult,
      bloodSugarResult,
      ancillaryResult,
      assessmentsResult,
      photosResult
    ] = await loadMemberRelations(serviceSupabase);
  }

  if (dailyActivitiesResult.error) throw new Error(dailyActivitiesResult.error.message);
  if (toiletsResult.error) throw new Error(toiletsResult.error.message);
  if (showersResult.error) throw new Error(showersResult.error.message);
  if (transportationResult.error) throw new Error(transportationResult.error.message);
  if (bloodSugarResult.error) throw new Error(bloodSugarResult.error.message);
  if (ancillaryResult.error) throw new Error(ancillaryResult.error.message);
  if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);
  if (photosResult.error) throw new Error(photosResult.error.message);

  const filterByStaff = <T extends Record<string, unknown>>(rows: T[], field: string) =>
    !isStaffViewer || !staffUserId ? rows : rows.filter((row) => String(row[field] ?? "") === staffUserId);

  const dailyActivities = filterByStaff(dailyActivitiesResult.data ?? [], "staff_user_id");
  const toilets = filterByStaff(toiletsResult.data ?? [], "staff_user_id");
  const showers = filterByStaff(showersResult.data ?? [], "staff_user_id");
  const transportation = filterByStaff(transportationResult.data ?? [], "staff_user_id");
  const bloodSugar = filterByStaff(bloodSugarResult.data ?? [], "nurse_user_id");
  const ancillary = filterByStaff(ancillaryResult.data ?? [], "staff_user_id");
  const assessments = filterByStaff(assessmentsResult.data ?? [], "created_by_user_id");
  const photos = filterByStaff(photosResult.data ?? [], "uploaded_by");

  const carePlans =
    isStaffViewer || !canViewCarePlans
      ? []
      : await (await import("@/lib/services/care-plans")).getCarePlansForMember(canonicalMemberId);
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
    marToday: [] as Array<{
      id: string;
      date: string;
      medication: string;
      dose: string;
      route: string;
      frequency: string;
      scheduled_time: string;
      action: string;
      staff: string;
    }>
  };
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
  const { data: lead, error: leadError } = await supabase.from("leads").select("*").eq("id", canonicalLeadId).maybeSingle();
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
        return supabase.from("community_partner_organizations").select("*").or(filters.join(",")).maybeSingle();
      })()
    : Promise.resolve({ data: null, error: null } as const);

  const referralSourcePromise = referralSourceId
    ? (() => {
        const filters = [
          isUuid(referralSourceId) ? `id.eq.${referralSourceId}` : null,
          `referral_source_id.eq.${referralSourceId}`
        ].filter(Boolean) as string[];
        return supabase.from("referral_sources").select("*").or(filters.join(",")).maybeSingle();
      })()
    : referralName
      ? supabase
          .from("referral_sources")
          .select("*")
          .or(`contact_name.eq.${referralName},organization_name.eq.${referralName}`)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as const);

  const [activitiesResult, stageHistoryResult, partnerResult, referralSourceResult] = await Promise.all([
    supabase.from("lead_activities").select("*").eq("lead_id", canonicalLeadId).order("activity_at", { ascending: false }),
    supabase.from("lead_stage_history").select("*").eq("lead_id", canonicalLeadId).order("changed_at", { ascending: false }),
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

  let partnerActivitiesQuery = supabase.from("partner_activities").select("*").order("activity_at", { ascending: false }).limit(200);
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
