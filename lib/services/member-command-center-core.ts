import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import {
  buildMemberContactsSchemaOutOfDateError,
  isMemberContactsPayorColumnMissingError,
  MEMBER_CONTACT_SELECT_WITH_PAYOR
} from "@/lib/services/member-contact-payor-schema";
import type {
  MccMemberRow,
  MemberAttendanceScheduleRow,
  MemberCommandCenterRow,
  MemberContactRow
} from "@/lib/services/member-command-center-types";

export type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type EnsureCanonicalMemberOptions = {
  serviceRole?: boolean;
  canonicalInput?: boolean;
  actor?: {
    userId?: string | null;
    name?: string | null;
  };
};

export async function getMccClient(options?: EnsureCanonicalMemberOptions) {
  if (options?.serviceRole) {
    return createSupabaseAdminClient();
  }
  return createClient();
}

function extractErrorText(error: PostgrestErrorLike | null | undefined) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
}

export function isMissingTableError(error: PostgrestErrorLike | null | undefined, tableName: string) {
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

export function isMissingAnyColumnError(error: PostgrestErrorLike | null | undefined, tableName: string) {
  const text = extractErrorText(error);
  if (!text) return false;
  const table = tableName.trim().toLowerCase();
  if (!table) return false;
  return text.includes("column") && text.includes("does not exist") && text.includes(table);
}

export function mapMemberContactRow(row: Record<string, unknown>): MemberContactRow {
  return {
    id: String(row.id ?? ""),
    member_id: String(row.member_id ?? ""),
    contact_name: String(row.contact_name ?? ""),
    relationship_to_member: typeof row.relationship_to_member === "string" ? row.relationship_to_member : null,
    category: String(row.category ?? "Other"),
    category_other: typeof row.category_other === "string" ? row.category_other : null,
    email: typeof row.email === "string" ? row.email : null,
    cellular_number: typeof row.cellular_number === "string" ? row.cellular_number : null,
    work_number: typeof row.work_number === "string" ? row.work_number : null,
    home_number: typeof row.home_number === "string" ? row.home_number : null,
    street_address: typeof row.street_address === "string" ? row.street_address : null,
    city: typeof row.city === "string" ? row.city : null,
    state: typeof row.state === "string" ? row.state : null,
    zip: typeof row.zip === "string" ? row.zip : null,
    is_payor: row.is_payor === true,
    created_by_user_id: typeof row.created_by_user_id === "string" ? row.created_by_user_id : null,
    created_by_name: typeof row.created_by_name === "string" ? row.created_by_name : null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? "")
  };
}

export async function selectMemberContactsRows(
  runQuery: (selectClause: string) => PromiseLike<{ data: unknown[] | null; error: PostgrestErrorLike | null }>
) {
  const result = await runQuery(MEMBER_CONTACT_SELECT_WITH_PAYOR);
  if (result.error) {
    if (isMemberContactsPayorColumnMissingError(result.error)) {
      throw buildMemberContactsSchemaOutOfDateError();
    }
    throw new Error(result.error.message ?? "Unable to query member contacts.");
  }
  return ((result.data ?? []) as Record<string, unknown>[]).map((row) => mapMemberContactRow(row));
}

export function coerceMemberContactWriteError(error: PostgrestErrorLike | null | undefined) {
  if (isMemberContactsPayorColumnMissingError(error)) {
    return buildMemberContactsSchemaOutOfDateError();
  }
  return new Error(error?.message ?? "Unable to save member contact.");
}

export function missingMccStorageError(input: {
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

export function isUniqueConstraintError(error: PostgrestErrorLike | null | undefined, constraintName?: string) {
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

export function toId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export function normalizeLocker(value: string | null | undefined) {
  const cleaned = (value ?? "").trim();
  if (!cleaned) return null;
  if (/^\d+$/.test(cleaned)) {
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed) && parsed > 0) return String(parsed);
  }
  return cleaned.toUpperCase();
}

export function sortLockerValues(a: string, b: string) {
  const aNum = Number(a);
  const bNum = Number(b);
  const aIsNum = Number.isFinite(aNum) && /^\d+$/.test(a);
  const bIsNum = Number.isFinite(bNum) && /^\d+$/.test(b);
  if (aIsNum && bIsNum) return aNum - bNum;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function sortByLastName(a: string, b: string) {
  const toKey = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return fullName.toLowerCase();
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1).join(" ");
    return `${last}, ${first}`.toLowerCase();
  };
  return toKey(a).localeCompare(toKey(b));
}

export function calculateAgeYears(dob: string | null) {
  if (!dob) return null;
  const parsedDob = new Date(`${dob}T00:00:00.000`);
  if (Number.isNaN(parsedDob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - parsedDob.getFullYear();
  const monthDelta = now.getMonth() - parsedDob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < parsedDob.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

export function calculateMonthsEnrolled(enrollmentDate: string | null) {
  if (!enrollmentDate) return null;
  const parsed = new Date(`${enrollmentDate}T00:00:00.000`);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - parsed.getFullYear()) * 12 + (now.getMonth() - parsed.getMonth());
  if (now.getDate() < parsed.getDate()) months -= 1;
  return months >= 0 ? months : 0;
}

export function normalizeBusStopName(value: string | null | undefined) {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function resolveMccMemberId(
  rawMemberId: string,
  actionLabel: string,
  options?: Pick<EnsureCanonicalMemberOptions, "canonicalInput" | "serviceRole">
) {
  if (options?.canonicalInput) {
    return rawMemberId;
  }
  return resolveCanonicalMemberId(rawMemberId, {
    actionLabel,
    serviceRole: options?.serviceRole
  });
}

export function defaultCommandCenter(memberId: string): MemberCommandCenterRow {
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

export function defaultAttendanceSchedule(member: Pick<MccMemberRow, "id" | "enrollment_date">): MemberAttendanceScheduleRow {
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
