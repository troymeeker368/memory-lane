import type {
  MemberAttendanceScheduleRow,
  MemberCommandCenterIndexProfileRow,
  MemberCommandCenterIndexScheduleRow,
  MemberCommandCenterRow
} from "@/lib/services/member-command-center-types";

export const MEMBER_COMMAND_CENTER_INDEX_PROFILE_SELECT = "member_id, profile_image_url";
export const MEMBER_COMMAND_CENTER_INDEX_SCHEDULE_SELECT =
  "member_id, enrollment_date, monday, tuesday, wednesday, thursday, friday, make_up_days_available";
export const MEMBER_COMMAND_CENTER_ADD_RIDER_ADDRESS_SELECT = "member_id, street_address, city, state, zip";

// MCC detail screens intentionally hydrate the full canonical shell rows in one read.
export const MEMBER_COMMAND_CENTER_DETAIL_SELECT = [
  "id",
  "member_id",
  "gender",
  "payor",
  "original_referral_source",
  "photo_consent",
  "profile_image_url",
  "location",
  "street_address",
  "city",
  "state",
  "zip",
  "marital_status",
  "primary_language",
  "secondary_language",
  "religion",
  "ethnicity",
  "is_veteran",
  "veteran_branch",
  "code_status",
  "dnr",
  "dni",
  "polst_molst_colst",
  "hospice",
  "advanced_directives_obtained",
  "power_of_attorney",
  "funeral_home",
  "legal_comments",
  "diet_type",
  "dietary_preferences_restrictions",
  "swallowing_difficulty",
  "supplements",
  "food_dislikes",
  "foods_to_omit",
  "diet_texture",
  "no_known_allergies",
  "medication_allergies",
  "food_allergies",
  "environmental_allergies",
  "command_center_notes",
  "source_assessment_id",
  "source_assessment_at",
  "updated_by_user_id",
  "updated_by_name",
  "created_at",
  "updated_at"
].join(", ");

// Attendance detail uses the full schedule row because transport and billing editors share this read path.
export const MEMBER_ATTENDANCE_SCHEDULE_DETAIL_SELECT = [
  "id",
  "member_id",
  "enrollment_date",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "full_day",
  "transportation_required",
  "transportation_mode",
  "transport_bus_number",
  "transportation_bus_stop",
  "transport_monday_period",
  "transport_tuesday_period",
  "transport_wednesday_period",
  "transport_thursday_period",
  "transport_friday_period",
  "transport_monday_am_mode",
  "transport_monday_am_door_to_door_address",
  "transport_monday_am_bus_number",
  "transport_monday_am_bus_stop",
  "transport_monday_pm_mode",
  "transport_monday_pm_door_to_door_address",
  "transport_monday_pm_bus_number",
  "transport_monday_pm_bus_stop",
  "transport_tuesday_am_mode",
  "transport_tuesday_am_door_to_door_address",
  "transport_tuesday_am_bus_number",
  "transport_tuesday_am_bus_stop",
  "transport_tuesday_pm_mode",
  "transport_tuesday_pm_door_to_door_address",
  "transport_tuesday_pm_bus_number",
  "transport_tuesday_pm_bus_stop",
  "transport_wednesday_am_mode",
  "transport_wednesday_am_door_to_door_address",
  "transport_wednesday_am_bus_number",
  "transport_wednesday_am_bus_stop",
  "transport_wednesday_pm_mode",
  "transport_wednesday_pm_door_to_door_address",
  "transport_wednesday_pm_bus_number",
  "transport_wednesday_pm_bus_stop",
  "transport_thursday_am_mode",
  "transport_thursday_am_door_to_door_address",
  "transport_thursday_am_bus_number",
  "transport_thursday_am_bus_stop",
  "transport_thursday_pm_mode",
  "transport_thursday_pm_door_to_door_address",
  "transport_thursday_pm_bus_number",
  "transport_thursday_pm_bus_stop",
  "transport_friday_am_mode",
  "transport_friday_am_door_to_door_address",
  "transport_friday_am_bus_number",
  "transport_friday_am_bus_stop",
  "transport_friday_pm_mode",
  "transport_friday_pm_door_to_door_address",
  "transport_friday_pm_bus_number",
  "transport_friday_pm_bus_stop",
  "daily_rate",
  "transportation_billing_status",
  "billing_rate_effective_date",
  "billing_notes",
  "attendance_days_per_week",
  "default_daily_rate",
  "use_custom_daily_rate",
  "custom_daily_rate",
  "make_up_days_available",
  "attendance_notes",
  "updated_by_user_id",
  "updated_by_name",
  "created_at",
  "updated_at"
].join(", ");

export const MEMBER_ALLERGY_LIST_SELECT =
  "id, member_id, allergy_group, allergy_name, severity, comments, created_by_user_id, created_by_name, created_at, updated_at";
export const BUS_STOP_DIRECTORY_SELECT = "id, bus_stop_name, created_by_user_id, created_by_name, created_at, updated_at";
export const LEGACY_INLINE_MEMBER_FILE_SENTINEL = "__legacy_inline_member_file__";

export function toMemberCommandCenterIndexProfileRow(
  row: Pick<MemberCommandCenterRow, "member_id" | "profile_image_url">
): MemberCommandCenterIndexProfileRow {
  return {
    member_id: row.member_id,
    profile_image_url: row.profile_image_url ?? null
  };
}

export function toMemberCommandCenterIndexScheduleRow(
  row: Pick<
    MemberAttendanceScheduleRow,
    "member_id" | "enrollment_date" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "make_up_days_available"
  >
): MemberCommandCenterIndexScheduleRow {
  return {
    member_id: row.member_id,
    enrollment_date: row.enrollment_date ?? null,
    monday: Boolean(row.monday),
    tuesday: Boolean(row.tuesday),
    wednesday: Boolean(row.wednesday),
    thursday: Boolean(row.thursday),
    friday: Boolean(row.friday),
    make_up_days_available: Number.isFinite(row.make_up_days_available) ? row.make_up_days_available : 0
  };
}
