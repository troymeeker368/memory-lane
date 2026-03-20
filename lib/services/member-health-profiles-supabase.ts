import { createClient } from "@/lib/supabase/server";
import { buildSupabaseIlikePattern } from "@/lib/services/supabase-ilike";
import { toEasternISO } from "@/lib/timezone";

export const MHP_TABS = [
  "overview",
  "medical",
  "functional",
  "cognitive-behavioral",
  "equipment",
  "legal",
  "notes"
] as const;

export type MhpTab = (typeof MHP_TABS)[number];

type MemberRow = {
  id: string;
  display_name: string;
  status: "active" | "inactive";
  dob: string | null;
  enrollment_date: string | null;
  city: string | null;
  code_status: string | null;
  latest_assessment_track: string | null;
};

export interface MemberHealthProfileIndexResult {
  rows: Array<{
    member: MemberRow;
    profile: MemberHealthProfileRow;
    latestAssessment: IntakeAssessmentRow | null;
    age: number | null;
    alerts: string[];
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
  admission_review_required: boolean | null;
  created_at: string;
};

function sortDesc<T>(rows: T[], getValue: (row: T) => string | null | undefined) {
  return [...rows].sort((a, b) => {
    const left = getValue(a) ?? "";
    const right = getValue(b) ?? "";
    if (left === right) return 0;
    return left < right ? 1 : -1;
  });
}

function calculateAge(dob: string | null) {
  if (!dob) return null;
  const parsedDob = new Date(`${dob}T00:00:00.000`);
  if (Number.isNaN(parsedDob.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - parsedDob.getFullYear();
  const monthDelta = now.getMonth() - parsedDob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < parsedDob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function newestTimestamp(values: Array<string | null | undefined>) {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) return null;
  return valid.reduce((latest, current) => {
    const latestMs = Number.isNaN(Date.parse(latest)) ? 0 : Date.parse(latest);
    const currentMs = Number.isNaN(Date.parse(current)) ? 0 : Date.parse(current);
    return currentMs > latestMs ? current : latest;
  });
}

function newestUpdate(values: Array<{ at: string | null | undefined; by?: string | null | undefined }>) {
  let latestAt: string | null = null;
  let latestBy: string | null = null;
  values.forEach((value) => {
    if (!value.at) return;
    if (!latestAt) {
      latestAt = value.at;
      latestBy = value.by ?? null;
      return;
    }
    const latestMs = Number.isNaN(Date.parse(latestAt)) ? 0 : Date.parse(latestAt);
    const currentMs = Number.isNaN(Date.parse(value.at)) ? 0 : Date.parse(value.at);
    if (currentMs > latestMs) {
      latestAt = value.at;
      latestBy = value.by ?? null;
    }
  });
  return { at: latestAt, by: latestBy };
}

function sortByLastName(a: string, b: string) {
  const toKey = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return fullName.toLowerCase();
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1).join(" ");
    return `${last}, ${first}`.toLowerCase();
  };
  return toKey(a).localeCompare(toKey(b));
}

export async function ensureMemberHealthProfileSupabase(memberId: string, options?: { serviceRole?: boolean }) {
  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("member_health_profiles")
    .select("*")
    .eq("member_id", memberId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    return existing as MemberHealthProfileRow;
  }

  const now = toEasternISO();
  const writeSupabase = await createClient({ serviceRole: options?.serviceRole ?? true });
  const { data, error } = await writeSupabase
    .from("member_health_profiles")
    .insert({ member_id: memberId, created_at: now, updated_at: now })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as MemberHealthProfileRow;
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
  const page = Number.isFinite(filters?.page) && Number(filters?.page) > 0 ? Math.floor(Number(filters?.page)) : 1;
  const pageSize =
    Number.isFinite(filters?.pageSize) && Number(filters?.pageSize) > 0 ? Math.floor(Number(filters?.pageSize)) : 25;

  let membersQuery = supabase
    .from("members")
    .select("id, display_name, status, dob, enrollment_date, city, code_status, latest_assessment_track", { count: "exact" })
    .order("display_name", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (status !== "all") {
    membersQuery = membersQuery.eq("status", status);
  }
  if (queryText) {
    membersQuery = membersQuery.ilike("display_name", buildSupabaseIlikePattern(queryText));
  }

  const { data: membersData, error: membersError, count: totalRows } = await membersQuery;
  if (membersError) throw new Error(membersError.message);
  const members = (membersData ?? []) as MemberRow[];

  let aggregateMembersQuery = supabase
    .from("members")
    .select("id, status")
    .order("display_name", { ascending: true });
  if (status !== "all") {
    aggregateMembersQuery = aggregateMembersQuery.eq("status", status);
  }
  if (queryText) {
    aggregateMembersQuery = aggregateMembersQuery.ilike("display_name", buildSupabaseIlikePattern(queryText));
  }
  const { data: aggregateMembersData, error: aggregateMembersError } = await aggregateMembersQuery;
  if (aggregateMembersError) throw new Error(aggregateMembersError.message);
  const aggregateMembers = (aggregateMembersData ?? []) as Array<{ id: string; status: "active" | "inactive" }>;
  const activeCount = aggregateMembers.filter((member) => member.status === "active").length;

  if (members.length === 0) {
    return {
      rows: [],
      page,
      pageSize,
      totalRows: totalRows ?? 0,
      totalPages: Math.max(1, Math.ceil((totalRows ?? 0) / pageSize)),
      activeCount,
      withAlertsCount: 0
    };
  }
  const memberIds = members.map((member) => member.id);
  const aggregateMemberIds = aggregateMembers.map((member) => member.id);

  const [profilesResult, mccResult, assessmentsResult, aggregateProfilesResult, aggregateAssessmentsResult] = await Promise.all([
    supabase.from("member_health_profiles").select("*").in("member_id", memberIds),
    supabase.from("member_command_centers").select("member_id, profile_image_url").in("member_id", memberIds),
    supabase
      .from("intake_assessments")
      .select("id, member_id, assessment_date, admission_review_required, recommended_track, created_at")
      .in("member_id", memberIds)
      .order("assessment_date", { ascending: false })
      .order("created_at", { ascending: false }),
    aggregateMemberIds.length > 0
      ? supabase.from("member_health_profiles").select("member_id, important_alerts").in("member_id", aggregateMemberIds)
      : Promise.resolve({ data: [], error: null }),
    aggregateMemberIds.length > 0
      ? supabase
          .from("intake_assessments")
          .select("member_id, admission_review_required, assessment_date, created_at")
          .in("member_id", aggregateMemberIds)
          .order("assessment_date", { ascending: false })
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null })
  ]);

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (mccResult.error) throw new Error(mccResult.error.message);
  if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);
  if (aggregateProfilesResult.error) throw new Error(aggregateProfilesResult.error.message);
  if (aggregateAssessmentsResult.error) throw new Error(aggregateAssessmentsResult.error.message);

  const profileByMemberId = new Map((profilesResult.data ?? []).map((row) => [String(row.member_id), row as MemberHealthProfileRow] as const));
  const mccPhotoByMemberId = new Map((mccResult.data ?? []).map((row) => [String(row.member_id), (row.profile_image_url as string | null) ?? null] as const));

  const missingProfileMemberIds = members
    .map((member) => member.id)
    .filter((memberId) => !profileByMemberId.has(memberId));
  if (missingProfileMemberIds.length > 0) {
    const ensuredProfiles = await Promise.all(
      missingProfileMemberIds.map((memberId) => ensureMemberHealthProfileSupabase(memberId))
    );
    ensuredProfiles.forEach((profile) => {
      profileByMemberId.set(profile.member_id, profile);
    });
  }

  const latestAssessmentByMemberId = new Map<string, IntakeAssessmentRow>();
  ((assessmentsResult.data ?? []) as IntakeAssessmentRow[]).forEach((row) => {
    if (!latestAssessmentByMemberId.has(row.member_id)) {
      latestAssessmentByMemberId.set(row.member_id, row);
    }
  });

  const rows = members
    .map((member) => {
      const profile = profileByMemberId.get(member.id);
      if (!profile) {
        throw new Error(`Missing member health profile for member ${member.id}.`);
      }
      const latestAssessment = latestAssessmentByMemberId.get(member.id) ?? null;
      const effectiveProfile = {
        ...profile,
        profile_image_url: profile.profile_image_url ?? mccPhotoByMemberId.get(member.id) ?? null
      };

      return {
        member,
        profile: effectiveProfile,
        latestAssessment,
        age: calculateAge(member.dob),
        alerts: [
          latestAssessment?.admission_review_required ? "Assessment review required" : null,
          effectiveProfile.important_alerts
        ].filter((alert): alert is string => Boolean(alert))
      };
    })
    .sort((a, b) => sortByLastName(a.member.display_name, b.member.display_name));
  const aggregateAssessmentByMemberId = new Map<string, { admission_review_required: boolean | null }>();
  ((aggregateAssessmentsResult.data ?? []) as Array<{ member_id: string; admission_review_required: boolean | null }>).forEach((row) => {
    if (!aggregateAssessmentByMemberId.has(row.member_id)) {
      aggregateAssessmentByMemberId.set(row.member_id, row);
    }
  });
  const aggregateProfileByMemberId = new Map(
    ((aggregateProfilesResult.data ?? []) as Array<{ member_id: string; important_alerts: string | null }>).map((row) => [
      row.member_id,
      row.important_alerts
    ] as const)
  );
  const withAlertsCount = aggregateMemberIds.reduce((count, memberId) => {
    const assessmentAlert = aggregateAssessmentByMemberId.get(memberId)?.admission_review_required;
    const profileAlert = (aggregateProfileByMemberId.get(memberId) ?? "").trim().length > 0;
    return assessmentAlert || profileAlert ? count + 1 : count;
  }, 0);
  return {
    rows,
    page,
    pageSize,
    totalRows: totalRows ?? rows.length,
    totalPages: Math.max(1, Math.ceil((totalRows ?? rows.length) / pageSize)),
    activeCount,
    withAlertsCount
  };
}

export async function getMemberHealthProfileDetailSupabase(memberId: string) {
  const supabase = await createClient();
  const { data: memberData, error: memberError } = await supabase
    .from("members")
    .select("id, display_name, status, dob, enrollment_date, city, code_status, latest_assessment_track")
    .eq("id", memberId)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!memberData) return null;

  const member = memberData as MemberRow;
  const profile = await ensureMemberHealthProfileSupabase(memberId);

  const [
    diagnosesResult,
    medicationsResult,
    allergiesResult,
    providersResult,
    providerDirectoryResult,
    hospitalPreferenceDirectoryResult,
    equipmentResult,
    notesResult,
    assessmentsResult,
    mccResult
  ] = await Promise.all([
    supabase.from("member_diagnoses").select("*").eq("member_id", memberId),
    supabase.from("member_medications").select("*").eq("member_id", memberId),
    supabase.from("member_allergies").select("*").eq("member_id", memberId),
    supabase.from("member_providers").select("*").eq("member_id", memberId),
    supabase.from("provider_directory").select("*").order("updated_at", { ascending: false }),
    supabase.from("hospital_preference_directory").select("*").order("updated_at", { ascending: false }),
    supabase.from("member_equipment").select("*").eq("member_id", memberId),
    supabase.from("member_notes").select("*").eq("member_id", memberId),
    supabase
      .from("intake_assessments")
      .select("id, member_id, assessment_date, total_score, recommended_track, completed_by, created_at")
      .eq("member_id", memberId)
      .order("assessment_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("member_command_centers").select("member_id, profile_image_url").eq("member_id", memberId).maybeSingle()
  ]);

  if (diagnosesResult.error) throw new Error(diagnosesResult.error.message);
  if (medicationsResult.error) throw new Error(medicationsResult.error.message);
  if (allergiesResult.error) throw new Error(allergiesResult.error.message);
  if (providersResult.error) throw new Error(providersResult.error.message);
  if (providerDirectoryResult.error) throw new Error(providerDirectoryResult.error.message);
  if (hospitalPreferenceDirectoryResult.error) throw new Error(hospitalPreferenceDirectoryResult.error.message);
  if (equipmentResult.error) throw new Error(equipmentResult.error.message);
  if (notesResult.error) throw new Error(notesResult.error.message);
  if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);
  if (mccResult.error) throw new Error(mccResult.error.message);

  const diagnoses = sortDesc((diagnosesResult.data ?? []) as MemberDiagnosisRow[], (row) => row.date_added);
  const medications = sortDesc((medicationsResult.data ?? []) as MemberMedicationRow[], (row) => row.updated_at);
  const allergies = sortDesc((allergiesResult.data ?? []) as MemberAllergyRow[], (row) => row.updated_at);
  const providers = sortDesc((providersResult.data ?? []) as MemberProviderRow[], (row) => row.updated_at);
  const providerDirectory = sortDesc(
    ((providerDirectoryResult.data ?? []) as ProviderDirectoryRow[]).filter((row) => row.provider_name.trim().length > 0),
    (row) => row.updated_at
  );
  const hospitalPreferenceDirectory = sortDesc(
    ((hospitalPreferenceDirectoryResult.data ?? []) as HospitalPreferenceDirectoryRow[]).filter((row) => row.hospital_name.trim().length > 0),
    (row) => row.updated_at
  );
  const equipment = sortDesc((equipmentResult.data ?? []) as MemberEquipmentRow[], (row) => row.updated_at);
  const notes = sortDesc((notesResult.data ?? []) as MemberNoteRow[], (row) => row.created_at);
  const assessments = sortDesc((assessmentsResult.data ?? []) as IntakeAssessmentRow[], (row) => row.created_at);

  const effectiveProfile = {
    ...profile,
    profile_image_url: profile.profile_image_url ?? ((mccResult.data as { profile_image_url: string | null } | null)?.profile_image_url ?? null)
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
