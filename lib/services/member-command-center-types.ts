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
    profile: MemberCommandCenterIndexProfileRow;
    schedule: MemberCommandCenterIndexScheduleRow;
    makeupBalance: number;
    age: number | null;
    monthsEnrolled: number | null;
  }>;
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

export interface MemberCommandCenterIndexProfileRow {
  member_id: string;
  profile_image_url: string | null;
}

export interface MemberCommandCenterIndexScheduleRow {
  member_id: string;
  enrollment_date: string | null;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  make_up_days_available: number;
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
  is_payor: boolean;
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
