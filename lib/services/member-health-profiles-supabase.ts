import { createClient } from "@/lib/supabase/server";
import { buildSupabaseIlikePattern } from "@/lib/services/supabase-ilike";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import {
  buildMissingMemberHealthProfileShellError,
  calculateAge,
  newestTimestamp,
  newestUpdate,
  resolveMemberHealthProfileDetailReadPlan,
  sortByLastName,
  sortDesc,
  toLatestMemberAssessmentSummary
} from "@/lib/services/member-health-profiles-helpers";
import {
  HOSPITAL_PREFERENCE_DIRECTORY_SELECT,
  MEMBER_ALLERGY_SELECT,
  MEMBER_DIAGNOSIS_SELECT,
  MEMBER_EQUIPMENT_SELECT,
  MEMBER_HEALTH_PROFILE_SELECT,
  MEMBER_MEDICATION_SELECT,
  MEMBER_NOTE_SELECT,
  MEMBER_PROVIDER_SELECT,
  MHP_TABS,
  type MhpTab,
  PROVIDER_DIRECTORY_SELECT
} from "@/lib/services/member-health-profiles-selects";
import { toIntakeDraftPofStatus } from "@/lib/services/intake-draft-pof-readiness";
import {
  listIntakePostSignFollowUpTasksByAssessmentIds,
  type IntakePostSignFollowUpTask
} from "@/lib/services/intake-post-sign-follow-up";
import { resolveIntakePostSignReadiness, type IntakePostSignReadinessStatus } from "@/lib/services/intake-post-sign-readiness";
import { toEasternISO } from "@/lib/timezone";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { listSharedMemberIndexPageSupabase } from "@/lib/services/member-list-read";

export {
  HOSPITAL_PREFERENCE_DIRECTORY_SELECT,
  MEMBER_ALLERGY_SELECT,
  MEMBER_DIAGNOSIS_SELECT,
  MEMBER_EQUIPMENT_SELECT,
  MEMBER_HEALTH_PROFILE_SELECT,
  MEMBER_MEDICATION_SELECT,
  MEMBER_NOTE_SELECT,
  MEMBER_PROVIDER_SELECT,
  MHP_TABS,
  type MhpTab,
  PROVIDER_DIRECTORY_SELECT
} from "@/lib/services/member-health-profiles-selects";

const MHP_SUMMARY_COUNTS_RPC = "rpc_get_member_health_profile_summary_counts";
const MHP_SUMMARY_COUNTS_RPC_MIGRATION = "0102_mhp_summary_counts_rpc.sql";

type MemberHealthProfileDetailOptions = {
  tab?: MhpTab;
  includeProviderDirectory?: boolean;
  includeHospitalPreferenceDirectory?: boolean;
  includeAssessments?: boolean;
  includeDiagnoses?: boolean;
  includeMedications?: boolean;
  includeAllergies?: boolean;
  includeProviders?: boolean;
  includeEquipment?: boolean;
  includeNotes?: boolean;
};

type MemberHealthProfileAssessmentOptions = {
  includeAll?: boolean;
  limit?: number;
  supabase?: Awaited<ReturnType<typeof createClient>>;
};

type MemberRow = {
  id: string;
  display_name: string;
  status: "active" | "inactive";
  dob: string | null;
  enrollment_date: string | null;
  city: string | null;
  code_status: string | null;
  latest_assessment_id: string | null;
  latest_assessment_date: string | null;
  latest_assessment_track: string | null;
  latest_assessment_admission_review_required: boolean | null;
};

export interface MemberHealthProfileIndexResult {
  rows: Array<{
    member: MemberRow;
    profile: MemberHealthProfileRow;
    latestAssessment: IntakeAssessmentRow | null;
    age: number | null;
    alerts: string[];
    profileNeedsBackfill: boolean;
  }>;
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  activeCount: number;
  withAlertsCount: number;
}

export type MemberHealthProfileRow = {
  id: string;
  member_id: string;
  gender: string | null;
  payor: string | null;
  original_referral_source: string | null;
  photo_consent: boolean | null;
  profile_image_url: string | null;
  primary_caregiver_name: string | null;
  primary_caregiver_phone: string | null;
  responsible_party_name: string | null;
  responsible_party_phone: string | null;
  provider_name: string | null;
  provider_phone: string | null;
  important_alerts: string | null;
  diet_type: string | null;
  dietary_restrictions: string | null;
  swallowing_difficulty: string | null;
  diet_texture: string | null;
  supplements: string | null;
  foods_to_omit: string | null;
  ambulation: string | null;
  transferring: string | null;
  bathing: string | null;
  dressing: string | null;
  eating: string | null;
  bladder_continence: string | null;
  bowel_continence: string | null;
  toileting: string | null;
  toileting_needs: string | null;
  toileting_comments: string | null;
  hearing: string | null;
  vision: string | null;
  dental: string | null;
  speech_verbal_status: string | null;
  speech_comments: string | null;
  personal_appearance_hygiene_grooming: string | null;
  may_self_medicate: boolean | null;
  medication_manager_name: string | null;
  orientation_dob: string | null;
  orientation_city: string | null;
  orientation_current_year: string | null;
  orientation_former_occupation: string | null;
  memory_impairment: string | null;
  memory_severity: string | null;
  wandering: boolean | null;
  combative_disruptive: boolean | null;
  sleep_issues: boolean | null;
  self_harm_unsafe: boolean | null;
  impaired_judgement: boolean | null;
  delirium: boolean | null;
  disorientation: boolean | null;
  agitation_resistive: boolean | null;
  screaming_loud_noises: boolean | null;
  exhibitionism_disrobing: boolean | null;
  exit_seeking: boolean | null;
  cognitive_behavior_comments: string | null;
  code_status: string | null;
  dnr: boolean | null;
  dni: boolean | null;
  polst_molst_colst: string | null;
  hospice: boolean | null;
  advanced_directives_obtained: boolean | null;
  power_of_attorney: string | null;
  hospital_preference: string | null;
  legal_comments: string | null;
  source_assessment_id: string | null;
  source_assessment_at: string | null;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type MemberDiagnosisRow = {
  id: string;
  member_id: string;
  diagnosis_type: "primary" | "secondary";
  diagnosis_name: string;
  diagnosis_code: string | null;
  date_added: string;
  comments: string | null;
  created_by_name: string | null;
  updated_at: string;
};

type MemberMedicationRow = {
  id: string;
  member_id: string;
  medication_name: string;
  date_started: string | null;
  medication_status: "active" | "inactive";
  inactivated_at: string | null;
  dose: string | null;
  quantity: string | null;
  form: string | null;
  frequency: string | null;
  route: string | null;
  route_laterality: string | null;
  given_at_center: boolean;
  prn: boolean;
  prn_instructions: string | null;
  scheduled_times: string[];
  comments: string | null;
  created_by_name: string | null;
  updated_at: string;
};

type MemberAllergyRow = {
  id: string;
  member_id: string;
  allergy_group: "food" | "medication" | "environmental";
  allergy_name: string;
  severity: string | null;
  comments: string | null;
  created_by_name: string | null;
  updated_at: string;
};

type MemberProviderRow = {
  id: string;
  member_id: string;
  provider_name: string;
  specialty: string | null;
  specialty_other: string | null;
  practice_name: string | null;
  provider_phone: string | null;
  created_by_name: string | null;
  updated_at: string;
};

type ProviderDirectoryRow = {
  id: string;
  provider_name: string;
  specialty: string | null;
  specialty_other: string | null;
  practice_name: string | null;
  provider_phone: string | null;
  updated_at: string;
};

type HospitalPreferenceDirectoryRow = {
  id: string;
  hospital_name: string;
  updated_at: string;
};

const DEFAULT_MHP_DIRECTORY_SEARCH_LIMIT = 8;
const MAX_MHP_DIRECTORY_SEARCH_LIMIT = 25;
const MHP_DIRECTORY_SEARCH_MIN_QUERY_LENGTH = 2;

type MemberEquipmentRow = {
  id: string;
  member_id: string;
  equipment_type: string;
  provider_source: string | null;
  status: string | null;
  comments: string | null;
  created_by_name: string | null;
  updated_at: string;
};

type MemberNoteRow = {
  id: string;
  member_id: string;
  note_type: string;
  note_text: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type IntakeAssessmentRow = {
  id: string;
  member_id: string;
  assessment_date: string;
  total_score: number | null;
  recommended_track: string | null;
  completed_by: string | null;
  signature_status: "unsigned" | "signed" | "voided" | null;
  draft_pof_status: string | null;
  post_sign_readiness_status?: IntakePostSignReadinessStatus;
  admission_review_required: boolean | null;
  created_at: string | null;
};

function normalizeDirectorySearchQuery(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function normalizeDirectorySearchLimit(value: number | null | undefined) {
  if (!Number.isFinite(value) || Number(value) <= 0) {
    return DEFAULT_MHP_DIRECTORY_SEARCH_LIMIT;
  }
  return Math.min(MAX_MHP_DIRECTORY_SEARCH_LIMIT, Math.floor(Number(value)));
}

function normalizeDirectoryNameKey(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export async function searchProviderDirectoryOptionsSupabase(input?: {
  q?: string;
  limit?: number;
}) {
  const query = normalizeDirectorySearchQuery(input?.q);
  if (query.length < MHP_DIRECTORY_SEARCH_MIN_QUERY_LENGTH) {
    return [] as ProviderDirectoryRow[];
  }

  const limit = normalizeDirectorySearchLimit(input?.limit);
  const fetchLimit = Math.min(limit * 5, 100);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("provider_directory")
    .select(PROVIDER_DIRECTORY_SELECT)
    .ilike("provider_name", buildSupabaseIlikePattern(query))
    .order("updated_at", { ascending: false })
    .limit(fetchLimit);

  if (error) {
    throw new Error(error.message);
  }

  const uniqueRows = new Map<string, ProviderDirectoryRow>();
  for (const row of (data ?? []) as ProviderDirectoryRow[]) {
    const key = normalizeDirectoryNameKey(row.provider_name);
    if (!key || uniqueRows.has(key)) continue;
    uniqueRows.set(key, row);
  }

  return Array.from(uniqueRows.values()).slice(0, limit);
}

export async function searchHospitalPreferenceDirectoryOptionsSupabase(input?: {
  q?: string;
  limit?: number;
}) {
  const query = normalizeDirectorySearchQuery(input?.q);
  if (query.length < MHP_DIRECTORY_SEARCH_MIN_QUERY_LENGTH) {
    return [] as HospitalPreferenceDirectoryRow[];
  }

  const limit = normalizeDirectorySearchLimit(input?.limit);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hospital_preference_directory")
    .select(HOSPITAL_PREFERENCE_DIRECTORY_SELECT)
    .ilike("hospital_name", buildSupabaseIlikePattern(query))
    .order("hospital_name", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as HospitalPreferenceDirectoryRow[]).filter(
    (row) => row.hospital_name.trim().length > 0
  );
}

export async function ensureMemberHealthProfileSupabase(memberId: string, options?: { serviceRole?: boolean }) {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, { actionLabel: "ensureMemberHealthProfileSupabase" });
  const supabase =
    options?.serviceRole === true
      ? createServiceRoleClient("member_health_profile_write_guard_read")
      : await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("member_health_profiles")
    .select(MEMBER_HEALTH_PROFILE_SELECT)
    .eq("member_id", canonicalMemberId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    return (existing as unknown) as MemberHealthProfileRow;
  }
  throw buildMissingMemberHealthProfileShellError(canonicalMemberId);
}

export async function getMemberHealthProfileIndexSupabase(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
  page?: number;
  pageSize?: number;
}): Promise<MemberHealthProfileIndexResult> {
  const supabase = await createClient();
  const queryText = filters?.q?.trim() ?? "";
  const status = filters?.status ?? "all";
  const membersPage = await listSharedMemberIndexPageSupabase({
    q: queryText,
    status,
    page: filters?.page,
    pageSize: filters?.pageSize,
    includeLockerSearch: false
  });
  const members = membersPage.rows as MemberRow[];

  type MhpSummaryCountsRpcRow = {
    active_count: number | string | null;
    with_alerts_count: number | string | null;
  };
  let summaryCounts = {
    activeCount: 0,
    withAlertsCount: 0
  };
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, MHP_SUMMARY_COUNTS_RPC, {
      p_status: status !== "all" ? status : null,
      p_query: queryText || null
    });
    const row = (Array.isArray(data) ? data[0] : null) as MhpSummaryCountsRpcRow | null;
    summaryCounts = {
      activeCount: Number(row?.active_count ?? 0),
      withAlertsCount: Number(row?.with_alerts_count ?? 0)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load member health profile summary counts.";
    if (message.includes(MHP_SUMMARY_COUNTS_RPC)) {
      throw new Error(
        `MHP summary counts RPC is not available. Apply Supabase migration ${MHP_SUMMARY_COUNTS_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }

  if (members.length === 0) {
    return {
      rows: [],
      page: membersPage.page,
      pageSize: membersPage.pageSize,
      totalRows: membersPage.totalRows,
      totalPages: membersPage.totalPages,
      activeCount: summaryCounts.activeCount,
      withAlertsCount: summaryCounts.withAlertsCount
    };
  }
  const memberIds = members.map((member) => member.id);

  const [profilesResult, mccResult] = await Promise.all([
    supabase
      .from("member_health_profiles")
      .select("member_id, profile_image_url, important_alerts, code_status")
      .in("member_id", memberIds),
    supabase.from("member_command_centers").select("member_id, profile_image_url").in("member_id", memberIds)
  ]);

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (mccResult.error) throw new Error(mccResult.error.message);

  const profileByMemberId = new Map((profilesResult.data ?? []).map((row) => [String(row.member_id), row as Partial<MemberHealthProfileRow>] as const));
  const mccPhotoByMemberId = new Map((mccResult.data ?? []).map((row) => [String(row.member_id), (row.profile_image_url as string | null) ?? null] as const));
  const missingProfileMemberIds = memberIds.filter((memberId) => !profileByMemberId.has(memberId));
  if (missingProfileMemberIds.length > 0) {
    throw buildMissingMemberHealthProfileShellError(missingProfileMemberIds[0]);
  }

  const rows = members
    .map((member) => {
      const storedProfile = profileByMemberId.get(member.id) as MemberHealthProfileRow | undefined;
      if (!storedProfile) {
        throw buildMissingMemberHealthProfileShellError(member.id);
      }
      const latestAssessment = toLatestMemberAssessmentSummary(member);
      const effectiveProfile = {
        ...storedProfile,
        profile_image_url: storedProfile.profile_image_url ?? mccPhotoByMemberId.get(member.id) ?? null
      };

      return {
        member,
        profile: effectiveProfile,
        latestAssessment,
        age: calculateAge(member.dob),
        alerts: [
          latestAssessment?.admission_review_required ? "Assessment review required" : null,
          effectiveProfile.important_alerts
        ].filter((alert): alert is string => Boolean(alert)),
        profileNeedsBackfill: false
      };
    })
    .sort((a, b) => sortByLastName(a.member.display_name, b.member.display_name));
  return {
    rows,
    page: membersPage.page,
    pageSize: membersPage.pageSize,
    totalRows: membersPage.totalRows,
    totalPages: membersPage.totalPages,
    activeCount: summaryCounts.activeCount,
    withAlertsCount: summaryCounts.withAlertsCount
  };
}

async function loadMemberHealthProfileAssessments(
  canonicalMemberId: string,
  options?: MemberHealthProfileAssessmentOptions
) {
  const supabase = options?.supabase ?? (await createClient());
  let query = supabase
    .from("intake_assessments")
    .select("id, member_id, assessment_date, total_score, recommended_track, completed_by, signature_status, draft_pof_status, created_at")
    .eq("member_id", canonicalMemberId)
    .order("assessment_date", { ascending: false })
    .order("created_at", { ascending: false });
  const requestedLimit = options?.limit;
  const explicitLimit =
    Number.isFinite(requestedLimit) && Number(requestedLimit) > 0 ? Math.floor(Number(requestedLimit)) : null;
  if (explicitLimit) {
    query = query.limit(explicitLimit);
  } else if (!options?.includeAll) {
    query = query.limit(1);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rawAssessments = sortDesc((data ?? []) as IntakeAssessmentRow[], (row) => row.created_at);
  const openFollowUpTasksByAssessmentId: Map<string, IntakePostSignFollowUpTask[]> = options?.includeAll
    ? await listIntakePostSignFollowUpTasksByAssessmentIds({
        assessmentIds: rawAssessments.map((row) => row.id)
      })
    : new Map<string, IntakePostSignFollowUpTask[]>();

  return options?.includeAll
    ? rawAssessments.map((row) => {
        const openFollowUpTaskTypes = (openFollowUpTasksByAssessmentId.get(row.id) ?? [])
          .filter((task: IntakePostSignFollowUpTask) => task.status === "action_required")
          .map((task: IntakePostSignFollowUpTask) => task.taskType);
        return {
          ...row,
          post_sign_readiness_status: resolveIntakePostSignReadiness({
            signatureStatus: row.signature_status,
            draftPofStatus: toIntakeDraftPofStatus(row.draft_pof_status),
            openFollowUpTaskTypes
          })
        };
      })
    : rawAssessments;
}

export async function getMemberHealthProfileDetailSupabase(
  memberId: string,
  options?: MemberHealthProfileDetailOptions
) {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, { actionLabel: "getMemberHealthProfileDetailSupabase" });
  const supabase = await createClient();
  const readPlan = resolveMemberHealthProfileDetailReadPlan(options);
  const { data: memberData, error: memberError } = await supabase
    .from("members")
    .select("id, display_name, status, dob, enrollment_date, city, code_status, latest_assessment_track")
    .eq("id", canonicalMemberId)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!memberData) return null;

  const member = memberData as MemberRow;

  const [
    profileResult,
    diagnosesResult,
    medicationsResult,
    allergiesResult,
    providersResult,
    equipmentResult,
    notesResult,
    assessmentsResult,
    mccResult
  ] = await Promise.all([
    supabase.from("member_health_profiles").select(MEMBER_HEALTH_PROFILE_SELECT).eq("member_id", canonicalMemberId).maybeSingle(),
    readPlan.includeDiagnoses
      ? supabase.from("member_diagnoses").select(MEMBER_DIAGNOSIS_SELECT).eq("member_id", canonicalMemberId)
      : Promise.resolve({ data: [], error: null }),
    readPlan.includeMedications
      ? supabase.from("member_medications").select(MEMBER_MEDICATION_SELECT).eq("member_id", canonicalMemberId)
      : Promise.resolve({ data: [], error: null }),
    readPlan.includeAllergies
      ? supabase.from("member_allergies").select(MEMBER_ALLERGY_SELECT).eq("member_id", canonicalMemberId)
      : Promise.resolve({ data: [], error: null }),
    readPlan.includeProviders
      ? supabase.from("member_providers").select(MEMBER_PROVIDER_SELECT).eq("member_id", canonicalMemberId)
      : Promise.resolve({ data: [], error: null }),
    readPlan.includeEquipment
      ? supabase.from("member_equipment").select(MEMBER_EQUIPMENT_SELECT).eq("member_id", canonicalMemberId)
      : Promise.resolve({ data: [], error: null }),
    readPlan.includeNotes
      ? supabase.from("member_notes").select(MEMBER_NOTE_SELECT).eq("member_id", canonicalMemberId)
      : Promise.resolve({ data: [], error: null }),
    loadMemberHealthProfileAssessments(canonicalMemberId, {
      includeAll: readPlan.includeAssessments,
      supabase
    }),
    supabase.from("member_command_centers").select("member_id, profile_image_url").eq("member_id", canonicalMemberId).maybeSingle()
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (diagnosesResult.error) throw new Error(diagnosesResult.error.message);
  if (medicationsResult.error) throw new Error(medicationsResult.error.message);
  if (allergiesResult.error) throw new Error(allergiesResult.error.message);
  if (providersResult.error) throw new Error(providersResult.error.message);
  if (equipmentResult.error) throw new Error(equipmentResult.error.message);
  if (notesResult.error) throw new Error(notesResult.error.message);
  if (mccResult.error) throw new Error(mccResult.error.message);

  const diagnoses = sortDesc((diagnosesResult.data ?? []) as MemberDiagnosisRow[], (row) => row.date_added);
  const medications = sortDesc((medicationsResult.data ?? []) as MemberMedicationRow[], (row) => row.updated_at);
  const allergies = sortDesc((allergiesResult.data ?? []) as MemberAllergyRow[], (row) => row.updated_at);
  const providers = sortDesc((providersResult.data ?? []) as MemberProviderRow[], (row) => row.updated_at);
  const providerDirectory: ProviderDirectoryRow[] = [];
  const hospitalPreferenceDirectory: HospitalPreferenceDirectoryRow[] = [];
  const equipment = sortDesc((equipmentResult.data ?? []) as MemberEquipmentRow[], (row) => row.updated_at);
  const notes = sortDesc((notesResult.data ?? []) as MemberNoteRow[], (row) => row.created_at);
  const assessments = assessmentsResult;
  const storedProfile = (profileResult.data as MemberHealthProfileRow | null) ?? null;
  if (!storedProfile) {
    throw buildMissingMemberHealthProfileShellError(canonicalMemberId);
  }

  const effectiveProfile = {
    ...storedProfile,
    profile_image_url:
      storedProfile.profile_image_url ?? ((mccResult.data as { profile_image_url: string | null } | null)?.profile_image_url ?? null)
  };

  const lastUpdatedAt =
    newestTimestamp([
      effectiveProfile.updated_at,
      ...diagnoses.map((row) => row.updated_at),
      ...medications.map((row) => row.updated_at),
      ...allergies.map((row) => row.updated_at),
      ...providers.map((row) => row.updated_at),
      ...equipment.map((row) => row.updated_at),
      ...notes.map((row) => row.updated_at)
    ]) ?? effectiveProfile.updated_at;

  const newest = newestUpdate([
    { at: effectiveProfile.updated_at, by: effectiveProfile.updated_by_name ?? null },
    ...diagnoses.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...medications.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...allergies.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...providers.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...equipment.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...notes.map((row) => ({ at: row.updated_at, by: row.created_by_name }))
  ]);

  return {
    member,
    profile: effectiveProfile,
    profileNeedsBackfill: false,
    diagnoses,
    medications,
    allergies,
    providers,
    providerDirectory,
    hospitalPreferenceDirectory,
    equipment,
    notes,
    assessments,
    lastUpdatedAt,
    lastUpdatedBy: newest.by ?? null,
    overview: {
      age: calculateAge(member.dob),
      codeStatus: effectiveProfile.code_status ?? member.code_status ?? null,
      primaryCaregiver: effectiveProfile.primary_caregiver_name,
      provider: providers[0]?.provider_name ?? effectiveProfile.provider_name
    }
  };
}

export async function getMemberHealthProfileAssessmentsSupabase(memberId: string, options?: { limit?: number }) {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, {
    actionLabel: "getMemberHealthProfileAssessmentsSupabase"
  });
  return loadMemberHealthProfileAssessments(canonicalMemberId, {
    includeAll: true,
    limit: options?.limit
  });
}

export async function backfillMissingMemberHealthProfilesSupabase(memberIds: Array<string | null | undefined>) {
  const normalizedMemberIds = Array.from(
    new Set(
      memberIds
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
  if (normalizedMemberIds.length === 0) return { inserted: 0 };

  const now = toEasternISO();
  // Historical shell backfill writes bypass authenticated write policies by design.
  const supabase = createServiceRoleClient("member_health_profile_backfill");
  const { data: existingRows, error: existingError } = await supabase
    .from("member_health_profiles")
    .select("member_id")
    .in("member_id", normalizedMemberIds);
  if (existingError) throw new Error(existingError.message);

  const existingMemberIds = new Set(((existingRows ?? []) as Array<{ member_id: string }>).map((row) => row.member_id));
  const missingMemberIds = normalizedMemberIds.filter((memberId) => !existingMemberIds.has(memberId));
  if (missingMemberIds.length === 0) return { inserted: 0 };

  const { error: insertError } = await supabase.from("member_health_profiles").insert(
    missingMemberIds.map((missingMemberId) => ({
      member_id: missingMemberId,
      created_at: now,
      updated_at: now
    }))
  );
  if (insertError) throw new Error(insertError.message);

  return { inserted: missingMemberIds.length };
}
