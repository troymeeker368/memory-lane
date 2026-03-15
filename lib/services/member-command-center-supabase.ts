import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import { getCarePlansForMember, getMemberCarePlanSummary } from "@/lib/services/care-plans-supabase";
import { getLatestEnrollmentPacketPofStagingSummary } from "@/lib/services/enrollment-packet-intake-staging";

export interface MccMemberRow {
  id: string;
  display_name: string;
  preferred_name: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  name: string | null;
  status: "active" | "inactive";
  locker_number: string | null;
  enrollment_date: string | null;
  dob: string | null;
  city: string | null;
  code_status: string | null;
  latest_assessment_track: string | null;
}

export interface MemberCommandCenterIndexResult {
  rows: Array<{
    member: MccMemberRow;
    profile: MemberCommandCenterRow;
    schedule: MemberAttendanceScheduleRow;
    makeupBalance: number;
    age: number | null;
    monthsEnrolled: number | null;
  }>;
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

export interface MemberCommandCenterRow {
  id: string;
  member_id: string;
  gender: "M" | "F" | null;
  payor: string | null;
  original_referral_source: string | null;
  photo_consent: boolean | null;
  profile_image_url: string | null;
  location: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  marital_status: string | null;
  primary_language: string | null;
  secondary_language: string | null;
  religion: string | null;
  ethnicity: string | null;
  is_veteran: boolean | null;
  veteran_branch: string | null;
  code_status: string | null;
  dnr: boolean | null;
  dni: boolean | null;
  polst_molst_colst: string | null;
  hospice: boolean | null;
  advanced_directives_obtained: boolean | null;
  power_of_attorney: string | null;
  funeral_home: string | null;
  legal_comments: string | null;
  diet_type: string | null;
  dietary_preferences_restrictions: string | null;
  swallowing_difficulty: string | null;
  supplements: string | null;
  food_dislikes: string | null;
  foods_to_omit: string | null;
  diet_texture: string | null;
  no_known_allergies: boolean | null;
  medication_allergies: string | null;
  food_allergies: string | null;
  environmental_allergies: string | null;
  command_center_notes: string | null;
  source_assessment_id: string | null;
  source_assessment_at: string | null;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberAttendanceScheduleRow {
  id: string;
  member_id: string;
  enrollment_date: string | null;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  full_day: boolean;
  transportation_required: boolean | null;
  transportation_mode: "Door to Door" | "Bus Stop" | null;
  transport_bus_number: string | null;
  transportation_bus_stop: string | null;
  transport_monday_period: "AM" | "PM" | null;
  transport_tuesday_period: "AM" | "PM" | null;
  transport_wednesday_period: "AM" | "PM" | null;
  transport_thursday_period: "AM" | "PM" | null;
  transport_friday_period: "AM" | "PM" | null;
  transport_monday_am_mode: "Door to Door" | "Bus Stop" | null;
  transport_monday_am_door_to_door_address: string | null;
  transport_monday_am_bus_number: string | null;
  transport_monday_am_bus_stop: string | null;
  transport_monday_pm_mode: "Door to Door" | "Bus Stop" | null;
  transport_monday_pm_door_to_door_address: string | null;
  transport_monday_pm_bus_number: string | null;
  transport_monday_pm_bus_stop: string | null;
  transport_tuesday_am_mode: "Door to Door" | "Bus Stop" | null;
  transport_tuesday_am_door_to_door_address: string | null;
  transport_tuesday_am_bus_number: string | null;
  transport_tuesday_am_bus_stop: string | null;
  transport_tuesday_pm_mode: "Door to Door" | "Bus Stop" | null;
  transport_tuesday_pm_door_to_door_address: string | null;
  transport_tuesday_pm_bus_number: string | null;
  transport_tuesday_pm_bus_stop: string | null;
  transport_wednesday_am_mode: "Door to Door" | "Bus Stop" | null;
  transport_wednesday_am_door_to_door_address: string | null;
  transport_wednesday_am_bus_number: string | null;
  transport_wednesday_am_bus_stop: string | null;
  transport_wednesday_pm_mode: "Door to Door" | "Bus Stop" | null;
  transport_wednesday_pm_door_to_door_address: string | null;
  transport_wednesday_pm_bus_number: string | null;
  transport_wednesday_pm_bus_stop: string | null;
  transport_thursday_am_mode: "Door to Door" | "Bus Stop" | null;
  transport_thursday_am_door_to_door_address: string | null;
  transport_thursday_am_bus_number: string | null;
  transport_thursday_am_bus_stop: string | null;
  transport_thursday_pm_mode: "Door to Door" | "Bus Stop" | null;
  transport_thursday_pm_door_to_door_address: string | null;
  transport_thursday_pm_bus_number: string | null;
  transport_thursday_pm_bus_stop: string | null;
  transport_friday_am_mode: "Door to Door" | "Bus Stop" | null;
  transport_friday_am_door_to_door_address: string | null;
  transport_friday_am_bus_number: string | null;
  transport_friday_am_bus_stop: string | null;
  transport_friday_pm_mode: "Door to Door" | "Bus Stop" | null;
  transport_friday_pm_door_to_door_address: string | null;
  transport_friday_pm_bus_number: string | null;
  transport_friday_pm_bus_stop: string | null;
  daily_rate: number | null;
  transportation_billing_status: "BillNormally" | "Waived" | "IncludedInProgramRate";
  billing_rate_effective_date: string | null;
  billing_notes: string | null;
  attendance_days_per_week: number | null;
  default_daily_rate: number | null;
  use_custom_daily_rate: boolean;
  custom_daily_rate: number | null;
  make_up_days_available: number;
  attendance_notes: string | null;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberContactRow {
  id: string;
  member_id: string;
  contact_name: string;
  relationship_to_member: string | null;
  category: string;
  category_other: string | null;
  email: string | null;
  cellular_number: string | null;
  work_number: string | null;
  home_number: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberFileRow {
  id: string;
  member_id: string;
  file_name: string;
  file_type: string;
  file_data_url: string | null;
  storage_object_path?: string | null;
  category: string;
  category_other: string | null;
  document_source: string | null;
  pof_request_id?: string | null;
  uploaded_by_user_id: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
  updated_at: string;
}

export interface MemberAllergyRow {
  id: string;
  member_id: string;
  allergy_group: "food" | "medication" | "environmental";
  allergy_name: string;
  severity: string | null;
  comments: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusStopDirectoryRow {
  id: string;
  bus_stop_name: string;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberBillingSettingRow {
  id: string;
  member_id: string;
  payor_id: string | null;
  use_center_default_billing_mode: boolean;
  billing_mode: "Membership" | "Monthly" | "Custom" | null;
  monthly_billing_basis: "ScheduledMonthBehind" | "ActualAttendanceMonthBehind";
  use_center_default_rate: boolean;
  custom_daily_rate: number | null;
  flat_monthly_rate: number | null;
  bill_extra_days: boolean;
  transportation_billing_status: "BillNormally" | "Waived" | "IncludedInProgramRate";
  bill_ancillary_arrears: boolean;
  active: boolean;
  effective_start_date: string;
  effective_end_date: string | null;
  billing_notes: string | null;
  created_at: string;
  updated_at: string;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
}

export interface BillingScheduleTemplateRow {
  id: string;
  member_id: string;
  effective_start_date: string;
  effective_end_date: string | null;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
}

export interface PayorRow {
  id: string;
  payor_name: string;
  status: "active" | "inactive";
}

export interface CenterBillingSettingRow {
  id: string;
  default_daily_rate: number;
  default_extra_day_rate: number | null;
  default_transport_one_way_rate: number;
  default_transport_round_trip_rate: number;
  billing_cutoff_day: number;
  default_billing_mode: "Membership" | "Monthly";
  effective_start_date: string;
  effective_end_date: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
}

export interface MakeupLedgerRow {
  id: string;
  effectiveDate: string;
  deltaDays: number;
  expiresAt: string | null;
  reason: string;
  createdByName: string;
}

type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

type EnsureCanonicalMemberOptions = {
  serviceRole?: boolean;
  actor?: {
    userId?: string | null;
    name?: string | null;
  };
};

async function getMccClient(options?: EnsureCanonicalMemberOptions) {
  if (options?.serviceRole) {
    return createSupabaseAdminClient();
  }
  return createClient();
}

function extractErrorText(error: PostgrestErrorLike | null | undefined) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
}

function isMissingTableError(error: PostgrestErrorLike | null | undefined, tableName: string) {
  const text = extractErrorText(error);
  if (!text) return false;
  const normalizedTable = tableName.trim().toLowerCase();
  if (!normalizedTable) return false;
  if (error?.code === "PGRST205") return text.includes(normalizedTable);
  return (
    text.includes(normalizedTable) &&
    (text.includes("schema cache") || text.includes("does not exist") || text.includes("relation"))
  );
}

function isMissingAnyColumnError(error: PostgrestErrorLike | null | undefined, tableName: string) {
  const text = extractErrorText(error);
  if (!text) return false;
  const table = tableName.trim().toLowerCase();
  if (!table) return false;
  return text.includes("column") && text.includes("does not exist") && text.includes(table);
}

function missingMccStorageError(input: {
  objectName:
    | "member_command_centers"
    | "member_attendance_schedules"
    | "member_contacts"
    | "member_files"
    | "bus_stop_directory"
    | "member_allergies"
    | "intake_assessments";
  migration: string;
}) {
  return new Error(
    `Missing Supabase schema object public.${input.objectName}. Apply migration ${input.migration} (and any earlier unapplied migrations), then restart Supabase/PostgREST to refresh schema cache.`
  );
}

function isUniqueConstraintError(
  error: PostgrestErrorLike | null | undefined,
  constraintName?: string
) {
  if (!error) return false;
  if (error.code === "23505") {
    if (!constraintName) return true;
    return extractErrorText(error).includes(constraintName.toLowerCase());
  }
  const text = extractErrorText(error);
  if (!text.includes("duplicate key value violates unique constraint")) return false;
  if (!constraintName) return true;
  return text.includes(constraintName.toLowerCase());
}

function toId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function normalizeLocker(value: string | null | undefined) {
  const cleaned = (value ?? "").trim();
  if (!cleaned) return null;
  if (/^\d+$/.test(cleaned)) {
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed) && parsed > 0) return String(parsed);
  }
  return cleaned.toUpperCase();
}

function sortLockerValues(a: string, b: string) {
  const aNum = Number(a);
  const bNum = Number(b);
  const aIsNum = Number.isFinite(aNum) && /^\d+$/.test(a);
  const bIsNum = Number.isFinite(bNum) && /^\d+$/.test(b);
  if (aIsNum && bIsNum) return aNum - bNum;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
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

function calculateAgeYears(dob: string | null) {
  if (!dob) return null;
  const parsedDob = new Date(`${dob}T00:00:00.000`);
  if (Number.isNaN(parsedDob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - parsedDob.getFullYear();
  const monthDelta = now.getMonth() - parsedDob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < parsedDob.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function calculateMonthsEnrolled(enrollmentDate: string | null) {
  if (!enrollmentDate) return null;
  const parsed = new Date(`${enrollmentDate}T00:00:00.000`);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - parsed.getFullYear()) * 12 + (now.getMonth() - parsed.getMonth());
  if (now.getDate() < parsed.getDate()) months -= 1;
  return months >= 0 ? months : 0;
}

function normalizeBusStopName(value: string | null | undefined) {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function resolveMccMemberId(rawMemberId: string, actionLabel: string) {
  const canonical = await resolveCanonicalMemberRef(
    {
      sourceType: "member",
      memberId: rawMemberId
    },
    { actionLabel }
  );
  if (!canonical.memberId) {
    throw new Error(`${actionLabel} expected member.id but canonical member resolution returned empty memberId.`);
  }
  return canonical.memberId;
}

function defaultCommandCenter(memberId: string): MemberCommandCenterRow {
  const now = new Date().toISOString();
  return {
    id: `mcc-${memberId}`,
    member_id: memberId,
    gender: null,
    payor: null,
    original_referral_source: null,
    photo_consent: null,
    profile_image_url: null,
    location: null,
    street_address: null,
    city: null,
    state: null,
    zip: null,
    marital_status: null,
    primary_language: "English",
    secondary_language: null,
    religion: null,
    ethnicity: null,
    is_veteran: null,
    veteran_branch: null,
    code_status: null,
    dnr: null,
    dni: null,
    polst_molst_colst: null,
    hospice: null,
    advanced_directives_obtained: null,
    power_of_attorney: null,
    funeral_home: null,
    legal_comments: null,
    diet_type: "Regular",
    dietary_preferences_restrictions: null,
    swallowing_difficulty: null,
    supplements: null,
    food_dislikes: null,
    foods_to_omit: null,
    diet_texture: "Regular",
    no_known_allergies: null,
    medication_allergies: null,
    food_allergies: null,
    environmental_allergies: null,
    command_center_notes: null,
    source_assessment_id: null,
    source_assessment_at: null,
    updated_by_user_id: null,
    updated_by_name: null,
    created_at: now,
    updated_at: now
  };
}

function defaultAttendanceSchedule(member: Pick<MccMemberRow, "id" | "enrollment_date">): MemberAttendanceScheduleRow {
  const now = new Date().toISOString();
  const monday = false;
  const tuesday = false;
  const wednesday = false;
  const thursday = false;
  const friday = false;
  const attendanceDaysPerWeek = 0;
  return {
    id: `attendance-${member.id}`,
    member_id: member.id,
    enrollment_date: member.enrollment_date,
    monday,
    tuesday,
    wednesday,
    thursday,
    friday,
    full_day: true,
    transportation_required: null,
    transportation_mode: null,
    transport_bus_number: null,
    transportation_bus_stop: null,
    transport_monday_period: null,
    transport_tuesday_period: null,
    transport_wednesday_period: null,
    transport_thursday_period: null,
    transport_friday_period: null,
    transport_monday_am_mode: null,
    transport_monday_am_door_to_door_address: null,
    transport_monday_am_bus_number: null,
    transport_monday_am_bus_stop: null,
    transport_monday_pm_mode: null,
    transport_monday_pm_door_to_door_address: null,
    transport_monday_pm_bus_number: null,
    transport_monday_pm_bus_stop: null,
    transport_tuesday_am_mode: null,
    transport_tuesday_am_door_to_door_address: null,
    transport_tuesday_am_bus_number: null,
    transport_tuesday_am_bus_stop: null,
    transport_tuesday_pm_mode: null,
    transport_tuesday_pm_door_to_door_address: null,
    transport_tuesday_pm_bus_number: null,
    transport_tuesday_pm_bus_stop: null,
    transport_wednesday_am_mode: null,
    transport_wednesday_am_door_to_door_address: null,
    transport_wednesday_am_bus_number: null,
    transport_wednesday_am_bus_stop: null,
    transport_wednesday_pm_mode: null,
    transport_wednesday_pm_door_to_door_address: null,
    transport_wednesday_pm_bus_number: null,
    transport_wednesday_pm_bus_stop: null,
    transport_thursday_am_mode: null,
    transport_thursday_am_door_to_door_address: null,
    transport_thursday_am_bus_number: null,
    transport_thursday_am_bus_stop: null,
    transport_thursday_pm_mode: null,
    transport_thursday_pm_door_to_door_address: null,
    transport_thursday_pm_bus_number: null,
    transport_thursday_pm_bus_stop: null,
    transport_friday_am_mode: null,
    transport_friday_am_door_to_door_address: null,
    transport_friday_am_bus_number: null,
    transport_friday_am_bus_stop: null,
    transport_friday_pm_mode: null,
    transport_friday_pm_door_to_door_address: null,
    transport_friday_pm_bus_number: null,
    transport_friday_pm_bus_stop: null,
    daily_rate: null,
    transportation_billing_status: "BillNormally",
    billing_rate_effective_date: member.enrollment_date,
    billing_notes: null,
    attendance_days_per_week: attendanceDaysPerWeek,
    default_daily_rate: null,
    use_custom_daily_rate: false,
    custom_daily_rate: null,
    make_up_days_available: 0,
    attendance_notes: null,
    updated_by_user_id: null,
    updated_by_name: null,
    created_at: now,
    updated_at: now
  };
}

export async function listActivePayorsSupabase() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payors")
    .select("id, payor_name, status")
    .eq("status", "active")
    .order("payor_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PayorRow[];
}

export async function listCenterBillingSettingsSupabase() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("center_billing_settings")
    .select("*")
    .order("effective_start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CenterBillingSettingRow[];
}

export async function upsertCenterBillingSettingSupabase(
  id: string | null,
  payload: Omit<CenterBillingSettingRow, "id" | "created_at" | "updated_at">
) {
  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase
      .from("center_billing_settings")
      .update(payload)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as CenterBillingSettingRow | null) ?? null;
  }
  const { data, error } = await supabase
    .from("center_billing_settings")
    .insert({ id: toId("center-billing"), ...payload })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as CenterBillingSettingRow;
}

export async function listMemberBillingSettingsSupabase(memberId: string) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listMemberBillingSettingsSupabase");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_billing_settings")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .order("effective_start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberBillingSettingRow[];
}

export async function listBillingScheduleTemplatesSupabase(memberId: string) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listBillingScheduleTemplatesSupabase");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("billing_schedule_templates")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .order("effective_start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BillingScheduleTemplateRow[];
}

export async function upsertMemberBillingSettingSupabase(
  id: string | null,
  payload: Omit<MemberBillingSettingRow, "id" | "created_at" | "updated_at">
) {
  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase.from("member_billing_settings").update(payload).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return (data as MemberBillingSettingRow | null) ?? null;
  }
  const { data, error } = await supabase
    .from("member_billing_settings")
    .insert({ id: toId("member-billing"), ...payload })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as MemberBillingSettingRow;
}

export async function upsertBillingScheduleTemplateSupabase(
  id: string | null,
  payload: Omit<BillingScheduleTemplateRow, "id" | "created_at" | "updated_at">
) {
  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase
      .from("billing_schedule_templates")
      .update(payload)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as BillingScheduleTemplateRow | null) ?? null;
  }
  const { data, error } = await supabase
    .from("billing_schedule_templates")
    .insert({ id: toId("schedule-template"), ...payload })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as BillingScheduleTemplateRow;
}

export async function listMembersSupabase(filters?: { q?: string; status?: "all" | "active" | "inactive" }) {
  const supabase = await createClient();
  const selectVariants = [
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status, locker_number, enrollment_date, dob, city, code_status, latest_assessment_track",
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status, enrollment_date, dob, city, code_status, latest_assessment_track",
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status, enrollment_date, dob, code_status, latest_assessment_track",
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status, enrollment_date, dob",
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status",
    "id, display_name, status, locker_number, enrollment_date, dob, city, code_status, latest_assessment_track",
    "id, display_name, status, enrollment_date, dob, city, code_status, latest_assessment_track",
    "id, display_name, status, enrollment_date, dob, code_status, latest_assessment_track",
    "id, display_name, status, enrollment_date, dob",
    "id, display_name, status"
  ];
  const mapRow = (row: Record<string, unknown>): MccMemberRow => ({
    id: String(row.id ?? ""),
    display_name: String(row.display_name ?? ""),
    preferred_name: typeof row.preferred_name === "string" ? row.preferred_name : null,
    first_name: typeof row.first_name === "string" ? row.first_name : null,
    last_name: typeof row.last_name === "string" ? row.last_name : null,
    full_name: typeof row.full_name === "string" ? row.full_name : null,
    name: typeof row.name === "string" ? row.name : null,
    status: row.status === "inactive" ? "inactive" : "active",
    locker_number: typeof row.locker_number === "string" ? row.locker_number : null,
    enrollment_date: typeof row.enrollment_date === "string" ? row.enrollment_date : null,
    dob: typeof row.dob === "string" ? row.dob : null,
    city: typeof row.city === "string" ? row.city : null,
    code_status: typeof row.code_status === "string" ? row.code_status : null,
    latest_assessment_track: typeof row.latest_assessment_track === "string" ? row.latest_assessment_track : null
  });

  let rows: MccMemberRow[] | null = null;
  let lastError: PostgrestErrorLike | null = null;
  for (const selectClause of selectVariants) {
    let query = supabase.from("members").select(selectClause);
    if (filters?.status && filters.status !== "all") {
      query = query.eq("status", filters.status);
    }
    const { data, error } = await query.order("display_name", { ascending: true });
    if (!error) {
      const rawRows = Array.isArray(data) ? (data as unknown[]) : [];
      rows = rawRows.map((row) => mapRow((row ?? {}) as Record<string, unknown>));
      break;
    }
    lastError = error;
    if (!isMissingAnyColumnError(error, "members")) {
      throw new Error(error.message ?? "Unable to query members.");
    }
  }
  if (!rows) {
    throw new Error(lastError?.message ?? "Unable to query members.");
  }

  const q = (filters?.q ?? "").trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (row) =>
      row.display_name.toLowerCase().includes(q) ||
      String(row.locker_number ?? "").toLowerCase().includes(q)
  );
}

async function listMembersPageSupabase(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
  page?: number;
  pageSize?: number;
}) {
  const supabase = await createClient();
  const page = Number.isFinite(filters?.page) && Number(filters?.page) > 0 ? Math.floor(Number(filters?.page)) : 1;
  const pageSize =
    Number.isFinite(filters?.pageSize) && Number(filters?.pageSize) > 0 ? Math.floor(Number(filters?.pageSize)) : 25;
  const q = (filters?.q ?? "").trim();
  const selectVariants = [
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status, locker_number, enrollment_date, dob, city, code_status, latest_assessment_track",
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status, enrollment_date, dob, city, code_status, latest_assessment_track",
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status, enrollment_date, dob, code_status, latest_assessment_track",
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status, enrollment_date, dob",
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status",
    "id, display_name, status, locker_number, enrollment_date, dob, city, code_status, latest_assessment_track",
    "id, display_name, status, enrollment_date, dob, city, code_status, latest_assessment_track",
    "id, display_name, status, enrollment_date, dob, code_status, latest_assessment_track",
    "id, display_name, status, enrollment_date, dob",
    "id, display_name, status"
  ];
  const mapRow = (row: Record<string, unknown>): MccMemberRow => ({
    id: String(row.id ?? ""),
    display_name: String(row.display_name ?? ""),
    preferred_name: typeof row.preferred_name === "string" ? row.preferred_name : null,
    first_name: typeof row.first_name === "string" ? row.first_name : null,
    last_name: typeof row.last_name === "string" ? row.last_name : null,
    full_name: typeof row.full_name === "string" ? row.full_name : null,
    name: typeof row.name === "string" ? row.name : null,
    status: row.status === "inactive" ? "inactive" : "active",
    locker_number: typeof row.locker_number === "string" ? row.locker_number : null,
    enrollment_date: typeof row.enrollment_date === "string" ? row.enrollment_date : null,
    dob: typeof row.dob === "string" ? row.dob : null,
    city: typeof row.city === "string" ? row.city : null,
    code_status: typeof row.code_status === "string" ? row.code_status : null,
    latest_assessment_track: typeof row.latest_assessment_track === "string" ? row.latest_assessment_track : null
  });

  let rows: MccMemberRow[] | null = null;
  let totalRows = 0;
  let lastError: PostgrestErrorLike | null = null;
  for (const selectClause of selectVariants) {
    let query: any = supabase
      .from("members")
      .select(selectClause, { count: "exact" })
      .order("display_name", { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (filters?.status && filters.status !== "all") {
      query = query.eq("status", filters.status);
    }
    if (q) {
      query = query.ilike("display_name", `%${q.replace(/[%,_]/g, (match) => `\\${match}`)}%`);
    }
    const { data, error, count } = await query;
    if (!error) {
      rows = ((data ?? []) as Record<string, unknown>[]).map((row) => mapRow(row));
      totalRows = count ?? rows.length;
      break;
    }
    lastError = error;
    if (!isMissingAnyColumnError(error, "members")) {
      throw new Error(error.message ?? "Unable to query members.");
    }
  }
  if (!rows) {
    throw new Error(lastError?.message ?? "Unable to query members.");
  }
  return {
    rows,
    page,
    pageSize,
    totalRows,
    totalPages: Math.max(1, Math.ceil(totalRows / pageSize))
  };
}

export async function getMemberSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "getMemberSupabase");
  const supabase = await getMccClient(options);
  const selectVariants = [
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status, locker_number, enrollment_date, dob, city, code_status, latest_assessment_track",
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status, enrollment_date, dob, city, code_status, latest_assessment_track",
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status, enrollment_date, dob, code_status, latest_assessment_track",
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status, enrollment_date, dob",
    "id, display_name, preferred_name, first_name, last_name, full_name, name, status",
    "id, display_name, status, locker_number, enrollment_date, dob, city, code_status, latest_assessment_track",
    "id, display_name, status, enrollment_date, dob, city, code_status, latest_assessment_track",
    "id, display_name, status, enrollment_date, dob, code_status, latest_assessment_track",
    "id, display_name, status, enrollment_date, dob",
    "id, display_name, status"
  ];
  const mapRow = (row: Record<string, unknown>): MccMemberRow => ({
    id: String(row.id ?? ""),
    display_name: String(row.display_name ?? ""),
    preferred_name: typeof row.preferred_name === "string" ? row.preferred_name : null,
    first_name: typeof row.first_name === "string" ? row.first_name : null,
    last_name: typeof row.last_name === "string" ? row.last_name : null,
    full_name: typeof row.full_name === "string" ? row.full_name : null,
    name: typeof row.name === "string" ? row.name : null,
    status: row.status === "inactive" ? "inactive" : "active",
    locker_number: typeof row.locker_number === "string" ? row.locker_number : null,
    enrollment_date: typeof row.enrollment_date === "string" ? row.enrollment_date : null,
    dob: typeof row.dob === "string" ? row.dob : null,
    city: typeof row.city === "string" ? row.city : null,
    code_status: typeof row.code_status === "string" ? row.code_status : null,
    latest_assessment_track: typeof row.latest_assessment_track === "string" ? row.latest_assessment_track : null
  });

  let lastError: PostgrestErrorLike | null = null;
  for (const selectClause of selectVariants) {
    const { data, error } = await supabase.from("members").select(selectClause).eq("id", canonicalMemberId).maybeSingle();
    if (!error) {
      if (!data) return null;
      return mapRow((data as unknown as Record<string, unknown>) ?? {});
    }
    lastError = error;
    if (!isMissingAnyColumnError(error, "members")) {
      throw new Error(error.message ?? "Unable to fetch member.");
    }
  }
  throw new Error(lastError?.message ?? "Unable to fetch member.");
}

export async function updateMemberSupabase(memberId: string, patch: Record<string, unknown>) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "updateMemberSupabase");
  const supabase = await createClient();
  const { data, error } = await supabase.from("members").update(patch).eq("id", canonicalMemberId).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MccMemberRow | null) ?? null;
}

export async function ensureMemberCommandCenterProfileSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "ensureMemberCommandCenterProfileSupabase");
  const supabase = await getMccClient(options);
  const { data, error } = await supabase
    .from("member_command_centers")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .limit(1);
  if (error) {
    if (isMissingTableError(error, "member_command_centers")) {
      throw missingMccStorageError({
        objectName: "member_command_centers",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(error.message);
  }
  const existing = Array.isArray(data) ? data[0] : null;
  if (existing) return existing as MemberCommandCenterRow;

  const created = {
    ...defaultCommandCenter(canonicalMemberId),
    updated_by_user_id: options?.actor?.userId ?? null,
    updated_by_name: options?.actor?.name ?? null
  };
  const { data: inserted, error: insertError } = await supabase
    .from("member_command_centers")
    .insert(created)
    .select("*")
    .single();
  if (insertError) {
    if (isMissingTableError(insertError, "member_command_centers")) {
      throw missingMccStorageError({
        objectName: "member_command_centers",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    if (isUniqueConstraintError(insertError)) {
      const { data: recovered, error: recoverError } = await supabase
        .from("member_command_centers")
        .select("*")
        .eq("member_id", canonicalMemberId)
        .limit(1);
      if (recoverError) {
        if (isMissingTableError(recoverError, "member_command_centers")) {
          throw missingMccStorageError({
            objectName: "member_command_centers",
            migration: "0011_member_command_center_aux_schema.sql"
          });
        }
        throw new Error(recoverError.message);
      }
      const recoveredRow = Array.isArray(recovered) ? recovered[0] : null;
      if (recoveredRow) return recoveredRow as MemberCommandCenterRow;

      const { data: recoveredById, error: recoverByIdError } = await supabase
        .from("member_command_centers")
        .select("*")
        .eq("id", created.id)
        .limit(1);
      if (recoverByIdError) {
        if (isMissingTableError(recoverByIdError, "member_command_centers")) {
          throw missingMccStorageError({
            objectName: "member_command_centers",
            migration: "0011_member_command_center_aux_schema.sql"
          });
        }
        throw new Error(recoverByIdError.message);
      }
      const recoveredByIdRow = Array.isArray(recoveredById) ? recoveredById[0] : null;
      if (recoveredByIdRow) return recoveredByIdRow as MemberCommandCenterRow;
    }
    throw new Error(insertError.message);
  }
  return inserted as MemberCommandCenterRow;
}

export async function ensureMemberAttendanceScheduleSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "ensureMemberAttendanceScheduleSupabase");
  const supabase = await getMccClient(options);
  const member = await getMemberSupabase(canonicalMemberId, options);
  if (!member) {
    throw new Error(`ensureMemberAttendanceScheduleSupabase could not find member ${canonicalMemberId}.`);
  }
  const { data, error } = await supabase
    .from("member_attendance_schedules")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .limit(1);
  if (error) {
    if (isMissingTableError(error, "member_attendance_schedules")) {
      throw missingMccStorageError({
        objectName: "member_attendance_schedules",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(error.message);
  }
  const existing = Array.isArray(data) ? data[0] : null;
  if (existing) return existing as MemberAttendanceScheduleRow;

  const created = {
    ...defaultAttendanceSchedule(member),
    updated_by_user_id: options?.actor?.userId ?? null,
    updated_by_name: options?.actor?.name ?? null
  };
  const { data: inserted, error: insertError } = await supabase
    .from("member_attendance_schedules")
    .insert(created)
    .select("*")
    .single();
  if (insertError) {
    if (isMissingTableError(insertError, "member_attendance_schedules")) {
      throw missingMccStorageError({
        objectName: "member_attendance_schedules",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    if (isUniqueConstraintError(insertError)) {
      const { data: recovered, error: recoverError } = await supabase
        .from("member_attendance_schedules")
        .select("*")
        .eq("member_id", canonicalMemberId)
        .limit(1);
      if (recoverError) {
        if (isMissingTableError(recoverError, "member_attendance_schedules")) {
          throw missingMccStorageError({
            objectName: "member_attendance_schedules",
            migration: "0011_member_command_center_aux_schema.sql"
          });
        }
        throw new Error(recoverError.message);
      }
      const recoveredRow = Array.isArray(recovered) ? recovered[0] : null;
      if (recoveredRow) return recoveredRow as MemberAttendanceScheduleRow;

      const { data: recoveredById, error: recoverByIdError } = await supabase
        .from("member_attendance_schedules")
        .select("*")
        .eq("id", created.id)
        .limit(1);
      if (recoverByIdError) {
        if (isMissingTableError(recoverByIdError, "member_attendance_schedules")) {
          throw missingMccStorageError({
            objectName: "member_attendance_schedules",
            migration: "0011_member_command_center_aux_schema.sql"
          });
        }
        throw new Error(recoverByIdError.message);
      }
      const recoveredByIdRow = Array.isArray(recoveredById) ? recoveredById[0] : null;
      if (recoveredByIdRow) return recoveredByIdRow as MemberAttendanceScheduleRow;
    }
    throw new Error(insertError.message);
  }
  return inserted as MemberAttendanceScheduleRow;
}

export async function updateMemberCommandCenterProfileSupabase(id: string, patch: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_command_centers")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MemberCommandCenterRow | null) ?? null;
}

export async function updateMemberAttendanceScheduleSupabase(id: string, patch: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_attendance_schedules")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MemberAttendanceScheduleRow | null) ?? null;
}

export async function listMemberContactsSupabase(memberId: string) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listMemberContactsSupabase");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_contacts")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberContactRow[];
}

export async function upsertMemberContactSupabase(input: {
  id?: string;
  member_id: string;
  contact_name: string;
  relationship_to_member: string | null;
  category: string;
  category_other: string | null;
  email: string | null;
  cellular_number: string | null;
  work_number: string | null;
  home_number: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}) {
  const canonicalMemberId = await resolveMccMemberId(input.member_id, "upsertMemberContactSupabase");
  const supabase = await createClient();
  if (input.id) {
    const { data, error } = await supabase
      .from("member_contacts")
      .update({
        member_id: canonicalMemberId,
        contact_name: input.contact_name,
        relationship_to_member: input.relationship_to_member,
        category: input.category,
        category_other: input.category_other,
        email: input.email,
        cellular_number: input.cellular_number,
        work_number: input.work_number,
        home_number: input.home_number,
        street_address: input.street_address,
        city: input.city,
        state: input.state,
        zip: input.zip,
        updated_at: input.updated_at
      })
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as MemberContactRow | null) ?? null;
  }
  const { data, error } = await supabase
    .from("member_contacts")
    .insert({ ...input, member_id: canonicalMemberId, id: toId("contact") })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as MemberContactRow;
}

export async function deleteMemberContactSupabase(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("member_contacts").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return true;
}

export async function listMemberFilesSupabase(memberId: string) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listMemberFilesSupabase");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_files")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberFileRow[];
}

export async function listMemberAllergiesSupabase(memberId: string) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listMemberAllergiesSupabase");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_allergies")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberAllergyRow[];
}

export async function addMemberAllergySupabase(input: Omit<MemberAllergyRow, "id">) {
  const canonicalMemberId = await resolveMccMemberId(input.member_id, "addMemberAllergySupabase");
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase
    .from("member_allergies")
    .insert({ ...input, member_id: canonicalMemberId, id: toId("allergy") })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as MemberAllergyRow;
}

export async function updateMemberAllergySupabase(id: string, patch: Partial<MemberAllergyRow>) {
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase.from("member_allergies").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MemberAllergyRow | null) ?? null;
}

export async function deleteMemberAllergySupabase(id: string) {
  const supabase = await createClient({ serviceRole: true });
  const { error } = await supabase.from("member_allergies").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return true;
}

export async function listBusStopDirectorySupabase() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("bus_stop_directory").select("*").order("bus_stop_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BusStopDirectoryRow[];
}

export async function upsertBusStopDirectoryFromValuesSupabase(input: {
  busStopNames: Array<string | null | undefined>;
  actor: { id: string; full_name: string };
  now: string;
}) {
  const supabase = await createClient();
  const names = Array.from(
    new Set(
      input.busStopNames
        .map((value) => normalizeBusStopName(value))
        .filter((value): value is string => Boolean(value))
    )
  );
  if (names.length === 0) return;
  const { data: existing, error } = await supabase.from("bus_stop_directory").select("*");
  if (error) throw new Error(error.message);
  const existingByName = new Map(
    ((existing ?? []) as BusStopDirectoryRow[]).map((row) => [row.bus_stop_name.trim().toLowerCase(), row] as const)
  );
  for (const name of names) {
    const key = name.toLowerCase();
    const matched = existingByName.get(key);
    if (matched) {
      const { error: updateError } = await supabase
        .from("bus_stop_directory")
        .update({ bus_stop_name: name, updated_at: input.now })
        .eq("id", matched.id);
      if (updateError) throw new Error(updateError.message);
      continue;
    }
    const id = `bus-stop-${slugify(name) || randomUUID()}`;
    const { error: insertError } = await supabase.from("bus_stop_directory").insert({
      id,
      bus_stop_name: name,
      created_by_user_id: input.actor.id,
      created_by_name: input.actor.full_name,
      created_at: input.now,
      updated_at: input.now
    });
    if (insertError && !insertError.message.toLowerCase().includes("duplicate")) {
      throw new Error(insertError.message);
    }
  }
}

export async function getAvailableLockerNumbersForMemberSupabase(memberId: string) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "getAvailableLockerNumbersForMemberSupabase");
  const members = await listMembersSupabase({ status: "all" });
  const member = members.find((row) => row.id === canonicalMemberId) ?? null;
  const currentLocker = normalizeLocker(member?.locker_number ?? null);
  const usedByOtherActive = new Set(
    members
      .filter((row) => row.status === "active" && row.id !== canonicalMemberId)
      .map((row) => normalizeLocker(row.locker_number))
      .filter((value): value is string => Boolean(value))
  );
  const pool = new Set<string>();
  for (let locker = 1; locker <= 72; locker += 1) pool.add(String(locker));
  members.forEach((row) => {
    const locker = normalizeLocker(row.locker_number);
    if (locker) pool.add(locker);
  });
  if (currentLocker) pool.add(currentLocker);
  return [...pool]
    .filter((locker) => !usedByOtherActive.has(locker) || locker === currentLocker)
    .sort(sortLockerValues);
}

export async function getMemberCommandCenterIndexSupabase(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
  page?: number;
  pageSize?: number;
}): Promise<MemberCommandCenterIndexResult> {
  const membersPage = await listMembersPageSupabase(filters);
  const members = membersPage.rows;
  if (members.length === 0) {
    return {
      rows: [],
      page: membersPage.page,
      pageSize: membersPage.pageSize,
      totalRows: membersPage.totalRows,
      totalPages: membersPage.totalPages
    };
  }
  const supabase = await createClient();
  const memberIds = members.map((row) => row.id);
  const [{ data: profilesData, error: profilesError }, { data: schedulesData, error: schedulesError }] = await Promise.all([
    supabase.from("member_command_centers").select("*").in("member_id", memberIds),
    supabase.from("member_attendance_schedules").select("*").in("member_id", memberIds)
  ]);
  const profiles = (() => {
    if (!profilesError) return (profilesData ?? []) as MemberCommandCenterRow[];
    if (isMissingTableError(profilesError, "member_command_centers")) {
      throw missingMccStorageError({
        objectName: "member_command_centers",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(profilesError.message);
  })();
  const schedules = (() => {
    if (!schedulesError) return (schedulesData ?? []) as MemberAttendanceScheduleRow[];
    if (isMissingTableError(schedulesError, "member_attendance_schedules")) {
      throw missingMccStorageError({
        objectName: "member_attendance_schedules",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(schedulesError.message);
  })();

  const profileByMember = new Map(profiles.map((row) => [row.member_id, row] as const));
  const scheduleByMember = new Map(schedules.map((row) => [row.member_id, row] as const));

  const missingProfileMemberIds = members
    .map((member) => member.id)
    .filter((memberId) => !profileByMember.has(memberId));
  if (missingProfileMemberIds.length > 0) {
    const ensuredProfiles = await Promise.all(
      missingProfileMemberIds.map((memberId) => ensureMemberCommandCenterProfileSupabase(memberId))
    );
    ensuredProfiles.forEach((profile) => {
      if (!profile) return;
      profileByMember.set(profile.member_id, profile);
    });
  }

  const missingScheduleMemberIds = members
    .map((member) => member.id)
    .filter((memberId) => !scheduleByMember.has(memberId));
  if (missingScheduleMemberIds.length > 0) {
    const ensuredSchedules = await Promise.all(
      missingScheduleMemberIds.map((memberId) => ensureMemberAttendanceScheduleSupabase(memberId))
    );
    ensuredSchedules.forEach((schedule, index) => {
      if (!schedule) {
        throw new Error(
          `Unable to ensure attendance schedule for member ${missingScheduleMemberIds[index]}.`
        );
      }
      scheduleByMember.set(schedule.member_id, schedule);
    });
  }

  const rows = members
    .map((member) => {
      const profile = profileByMember.get(member.id);
      if (!profile) {
        throw new Error(`Missing member command center profile for member ${member.id}.`);
      }
      const schedule = scheduleByMember.get(member.id);
      if (!schedule) {
        throw new Error(`Missing member attendance schedule for member ${member.id}.`);
      }
      return {
        member,
        profile,
        schedule,
        makeupBalance: schedule.make_up_days_available ?? 0,
        age: calculateAgeYears(member.dob),
        monthsEnrolled: calculateMonthsEnrolled(schedule.enrollment_date ?? member.enrollment_date)
      };
    })
    .sort((a, b) => sortByLastName(a.member.display_name, b.member.display_name));
  return {
    rows,
    page: membersPage.page,
    pageSize: membersPage.pageSize,
    totalRows: membersPage.totalRows,
    totalPages: membersPage.totalPages
  };
}

export async function getMemberCommandCenterDetailSupabase(memberId: string) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "getMemberCommandCenterDetailSupabase");
  const member = await getMemberSupabase(canonicalMemberId);
  if (!member) return null;
  const [profile, schedule, contacts, files, busStopDirectory, mhpAllergies, carePlanSummary, carePlans, enrollmentPacketIntakeAlert] = await Promise.all([
    ensureMemberCommandCenterProfileSupabase(canonicalMemberId),
    ensureMemberAttendanceScheduleSupabase(canonicalMemberId),
    listMemberContactsSupabase(canonicalMemberId),
    listMemberFilesSupabase(canonicalMemberId),
    listBusStopDirectorySupabase(),
    listMemberAllergiesSupabase(canonicalMemberId),
    getMemberCarePlanSummary(canonicalMemberId),
    getCarePlansForMember(canonicalMemberId),
    getLatestEnrollmentPacketPofStagingSummary(canonicalMemberId)
  ]);
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("intake_assessments")
    .select("id", { count: "exact", head: true })
    .eq("member_id", canonicalMemberId);
  if (error) {
    if (isMissingTableError(error, "intake_assessments")) {
      throw missingMccStorageError({
        objectName: "intake_assessments",
        migration: "0006_intake_pof_mhp_supabase.sql"
      });
    }
    throw new Error(error.message);
  }
  const safeAssessmentsCount = count ?? 0;

  return {
    member,
    profile,
    schedule: schedule
      ? {
          ...schedule,
          make_up_days_available: schedule.make_up_days_available ?? 0
        }
      : null,
    contacts,
    files,
    busStopDirectory,
    mhpAllergies,
    makeupBalance: schedule?.make_up_days_available ?? 0,
    makeupLedger: [] as MakeupLedgerRow[],
    assessmentsCount: safeAssessmentsCount,
    carePlansCount: carePlans.length,
    carePlanSummary,
    enrollmentPacketIntakeAlert,
    age: calculateAgeYears(member.dob),
    monthsEnrolled: calculateMonthsEnrolled(schedule?.enrollment_date ?? member.enrollment_date)
  };
}

export async function getTransportationAddRiderMemberOptionsSupabase() {
  const supabase = await createClient();
  const { data: membersData, error: membersError } = await supabase
    .from("members")
    .select("id, display_name, status")
    .eq("status", "active")
    .order("display_name", { ascending: true });
  if (membersError) throw new Error(membersError.message);
  const members = (membersData ?? []) as Array<{ id: string; display_name: string; status: "active" | "inactive" }>;
  if (members.length === 0) return [];
  const memberIds = members.map((row) => row.id);
  const [commandCentersResult, contactsResult] = await Promise.all([
    supabase.from("member_command_centers").select("*").in("member_id", memberIds),
    supabase.from("member_contacts").select("*").in("member_id", memberIds)
  ]);

  const commandCenters = (() => {
    if (!commandCentersResult.error) return (commandCentersResult.data ?? []) as MemberCommandCenterRow[];
    if (isMissingTableError(commandCentersResult.error, "member_command_centers")) {
      throw missingMccStorageError({
        objectName: "member_command_centers",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(commandCentersResult.error.message);
  })();

  const contacts = (() => {
    if (!contactsResult.error) return (contactsResult.data ?? []) as MemberContactRow[];
    if (isMissingTableError(contactsResult.error, "member_contacts")) {
      throw missingMccStorageError({
        objectName: "member_contacts",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(contactsResult.error.message);
  })();

  const commandCenterByMember = new Map(
    commandCenters.map((row) => [row.member_id, row] as const)
  );
  const contactPriority = (category: string | null | undefined): number => {
    const normalized = (category ?? "").trim().toLowerCase();
    if (normalized === "responsible party") return 1;
    if (normalized === "care provider") return 2;
    if (normalized === "emergency contact") return 3;
    if (normalized === "spouse") return 4;
    if (normalized === "child") return 5;
    if (normalized === "payor") return 6;
    if (normalized === "other") return 7;
    return 8;
  };
  const preferredContactByMember = new Map<string, MemberContactRow>();
  [...contacts]
    .sort((left, right) => {
      const memberCompare = left.member_id.localeCompare(right.member_id);
      if (memberCompare !== 0) return memberCompare;
      const categoryCompare = contactPriority(left.category) - contactPriority(right.category);
      if (categoryCompare !== 0) return categoryCompare;
      if (left.updated_at === right.updated_at) return 0;
      return left.updated_at > right.updated_at ? -1 : 1;
    })
    .forEach((contact) => {
      if (!preferredContactByMember.has(contact.member_id)) {
        preferredContactByMember.set(contact.member_id, contact);
      }
    });

  const joinAddress = (parts: Array<string | null | undefined>) =>
    parts.map((value) => (value ?? "").trim()).filter(Boolean).join(", ") || null;

  return members.map((member) => {
    const commandCenter = commandCenterByMember.get(member.id);
    const preferredContact = preferredContactByMember.get(member.id);
    return {
      id: member.id,
      displayName: member.display_name,
      defaultDoorToDoorAddress: joinAddress([
        commandCenter?.street_address ?? null,
        commandCenter?.city ?? null,
        commandCenter?.state ?? null,
        commandCenter?.zip ?? null
      ]),
      defaultContactId: preferredContact?.id ?? null,
      defaultContactName: preferredContact?.contact_name ?? null,
      defaultContactPhone:
        preferredContact?.cellular_number ?? preferredContact?.home_number ?? preferredContact?.work_number ?? null,
      defaultContactAddress: joinAddress([
        preferredContact?.street_address ?? null,
        preferredContact?.city ?? null,
        preferredContact?.state ?? null,
        preferredContact?.zip ?? null
      ])
    };
  });
}
