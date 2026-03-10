import type { AppRole, AuditAction } from "@/types/app";

export interface MockStaff {
  id: string;
  staff_id: string;
  full_name: string;
  email: string;
  email_normalized: string;
  role: AppRole;
  active: boolean;
}

export interface MockMember {
  id: string;
  display_name: string;
  locker_number: string | null;
  status: "active" | "inactive";
  discharge_date: string | null;
  discharge_reason: string | null;
  discharge_disposition: string | null;
  discharged_by: string | null;
  qr_code: string;
  enrollment_date: string | null;
  dob: string | null;
  city: string | null;
  allergies: string | null;
  code_status: string | null;
  orientation_dob_verified: boolean | null;
  orientation_city_verified: boolean | null;
  orientation_year_verified: boolean | null;
  orientation_occupation_verified: boolean | null;
  medication_management_status: string | null;
  dressing_support_status: string | null;
  assistive_devices: string | null;
  incontinence_products: string | null;
  on_site_medication_use: string | null;
  on_site_medication_list: string | null;
  diet_type: string | null;
  diet_restrictions_notes: string | null;
  mobility_status: string | null;
  mobility_aids: string | null;
  social_triggers: string | null;
  joy_sparks: string | null;
  personal_notes: string | null;
  transport_can_enter_exit_vehicle: string | null;
  transport_assistance_level: string | null;
  transport_mobility_aid: string | null;
  transport_can_remain_seated_buckled: boolean | null;
  transport_behavior_concern: string | null;
  transport_appropriate: boolean | null;
  latest_assessment_id: string | null;
  latest_assessment_date: string | null;
  latest_assessment_score: number | null;
  latest_assessment_track: string | null;
  latest_assessment_admission_review_required: boolean | null;
}

export interface MockMemberCommandCenter {
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

export interface MockMemberAttendanceSchedule {
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
  make_up_days_available: number | null;
  attendance_notes: string | null;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface MockMemberHold {
  id: string;
  member_id: string;
  start_date: string;
  end_date: string | null;
  status: "active" | "ended";
  reason: string;
  reason_other: string | null;
  notes: string | null;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  ended_by_user_id: string | null;
  ended_by_name: string | null;
}

export interface MockTransportationManifestAdjustment {
  id: string;
  selected_date: string;
  shift: "AM" | "PM";
  member_id: string;
  adjustment_type: "add" | "exclude";
  bus_number: string | null;
  transport_type: "Bus Stop" | "Door to Door" | null;
  bus_stop_name: string | null;
  door_to_door_address: string | null;
  caregiver_contact_id: string | null;
  caregiver_contact_name_snapshot: string | null;
  caregiver_contact_phone_snapshot: string | null;
  caregiver_contact_address_snapshot: string | null;
  notes: string | null;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
}

export interface MockMemberContact {
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
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface MockMemberFile {
  id: string;
  member_id: string;
  file_name: string;
  file_type: string;
  file_data_url: string | null;
  category: string;
  category_other: string | null;
  document_source?: string | null;
  uploaded_by_user_id: string;
  uploaded_by_name: string;
  uploaded_at: string;
  updated_at: string;
}

export interface MockAttendanceRecord {
  id: string;
  member_id: string;
  attendance_date: string;
  status: "present" | "absent";
  absent_reason: string | null;
  absent_reason_other: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  notes: string | null;
  recorded_by_user_id: string;
  recorded_by_name: string;
  created_at: string;
  updated_at: string;
  scheduled_day?: boolean | null;
  unscheduled_day?: boolean | null;
  billable_extra_day?: boolean | null;
  billing_status?: "Unbilled" | "Billed" | "Excluded" | null;
  linked_adjustment_id?: string | null;
}

export interface MockTimePunch {
  id: string;
  punch_id: string;
  staff_user_id: string;
  staff_id: string;
  staff_name: string;
  punch_type: "in" | "out";
  punch_at: string;
  punch_lat_long: string | null;
  site_id: string;
  within_fence: boolean;
  distance_meters: number | null;
  note: string | null;
}

export interface MockDailyActivityLog {
  id: string;
  timestamp: string;
  activity_date: string;
  staff_user_id: string;
  staff_name: string;
  staff_recording_activity: string;
  member_id: string;
  member_name: string;
  participation: number;
  participation_reason: string | null;
  activity_1_level: number;
  reason_missing_activity_1: string | null;
  activity_2_level: number;
  reason_missing_activity_2: string | null;
  activity_3_level: number;
  reason_missing_activity_3: string | null;
  activity_4_level: number;
  reason_missing_activity_4: string | null;
  activity_5_level: number;
  reason_missing_activity_5: string | null;
  notes: string | null;
  email_address: string | null;
  created_at: string;
}

export interface MockToiletLog {
  id: string;
  ratee: string;
  event_at: string;
  event_date: string;
  member_id: string;
  member_name: string;
  briefs: boolean;
  member_supplied: boolean;
  use_type: string;
  staff_user_id: string;
  staff_name: string;
  staff_assisting: string;
  linked_ancillary_charge_id?: string | null;
  notes: string | null;
}

export interface MockShowerLog {
  id: string;
  timestamp: string;
  event_at: string;
  event_date: string;
  member_id: string;
  member_name: string;
  laundry: boolean;
  briefs: boolean;
  staff_user_id: string;
  staff_name: string;
  staff_assisting: string;
  linked_ancillary_charge_id?: string | null;
  notes: string | null;
}

export interface MockTransportationLog {
  id: string;
  timestamp: string;
  first_name: string;
  member_id: string;
  member_name: string;
  pick_up_drop_off: "AM" | "PM";
  period: "AM" | "PM";
  transport_type: string;
  service_date: string;
  staff_user_id: string;
  staff_name: string;
  staff_responsible: string;
  notes: string | null;
  trip_type?: "OneWay" | "RoundTrip" | "Other" | null;
  quantity?: number;
  unit_rate?: number | null;
  total_amount?: number | null;
  billable?: boolean | null;
  billing_status?: "Unbilled" | "Billed" | "Excluded" | null;
  billing_exclusion_reason?: string | null;
  invoice_id?: string | null;
}

export interface MockPhotoUpload {
  id: string;
  member_id: string;
  member_name: string;
  photo_url: string;
  file_name: string;
  file_type: string;
  uploaded_by: string;
  uploaded_by_name: string;
  uploaded_at: string;
  upload_date: string;
  staff_clean: string;
  notes: string | null;
}

export interface MockBloodSugarLog {
  id: string;
  member_id: string;
  member_name: string;
  checked_at: string;
  reading_mg_dl: number;
  nurse_user_id: string;
  nurse_name: string;
  notes: string | null;
}

export interface MockAncillaryCategory {
  id: string;
  name: string;
  price_cents: number;
}

export interface MockAncillaryLog {
  id: string;
  timestamp: string;
  member_id: string;
  member_name: string;
  category_id: string;
  category_name: string;
  charge_type?: string | null;
  amount_cents: number;
  service_date: string;
  charge_date?: string | null;
  late_pickup_time: string | null;
  staff_user_id: string;
  staff_name: string;
  staff_recording_entry: string;
  notes: string | null;
  source_entity: string | null;
  source_entity_id: string | null;
  quantity: number;
  created_at: string;
  reconciliation_status: "open" | "reconciled" | "void";
  reconciled_by: string | null;
  reconciled_at: string | null;
  reconciliation_note: string | null;
  unit_rate?: number | null;
  total_amount?: number | null;
  billable?: boolean | null;
  billing_status?: "Unbilled" | "Billed" | "Excluded" | null;
  billing_exclusion_reason?: string | null;
  invoice_id?: string | null;
}

export interface MockCenterBillingSetting {
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

export interface MockClosureRule {
  id: string;
  name: string;
  rule_type: "fixed" | "nth_weekday";
  month: number;
  day: number | null;
  weekday: "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | null;
  occurrence: "first" | "second" | "third" | "fourth" | "last" | null;
  observed_when_weekend: "none" | "friday" | "monday" | "nearest_weekday";
  active: boolean;
  created_at: string;
  updated_at: string;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
}

export interface MockCenterClosure {
  id: string;
  closure_date: string;
  closure_name: string;
  closure_type: "Holiday" | "Weather" | "Planned" | "Emergency" | "Other";
  auto_generated: boolean;
  closure_rule_id: string | null;
  billable_override: boolean;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
}

export interface MockPayor {
  id: string;
  payor_name: string;
  payor_type: string;
  billing_contact_name: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_method: "InvoiceEmail" | "ACHDraft" | "CardOnFile" | "Manual" | "External";
  auto_draft_enabled: boolean;
  quickbooks_customer_name: string | null;
  quickbooks_customer_ref: string | null;
  status: "active" | "inactive";
  notes: string | null;
  created_at: string;
  updated_at: string;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
}

export interface MockMemberBillingSetting {
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

export interface MockBillingScheduleTemplate {
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

export interface MockBillingAdjustment {
  id: string;
  member_id: string;
  payor_id: string | null;
  adjustment_date: string;
  adjustment_type:
    | "ExtraDay"
    | "Credit"
    | "Discount"
    | "Refund"
    | "ManualCharge"
    | "ManualCredit"
    | "PriorBalance"
    | "Other";
  description: string;
  quantity: number;
  unit_rate: number;
  amount: number;
  billing_status: "Unbilled" | "Billed" | "Excluded";
  invoice_id: string | null;
  created_by_system: boolean;
  source_table: string | null;
  source_record_id: string | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: string | null;
  created_by_name: string | null;
}

export interface MockBillingBatch {
  id: string;
  batch_type: "Membership" | "Monthly" | "Mixed" | "Custom";
  billing_month: string;
  run_date: string;
  run_by_user: string;
  batch_status: "Draft" | "Reviewed" | "Finalized" | "Exported" | "Closed";
  invoice_count: number;
  total_amount: number;
  exported_at: string | null;
  completion_date: string | null;
  next_due_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MockBillingInvoice {
  id: string;
  billing_batch_id: string;
  member_id: string;
  payor_id: string | null;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  invoice_month: string;
  invoice_source: "BatchGenerated" | "Custom";
  billing_mode_snapshot: "Membership" | "Monthly" | "Custom";
  monthly_billing_basis_snapshot: "ScheduledMonthBehind" | "ActualAttendanceMonthBehind" | null;
  base_period_start: string;
  base_period_end: string;
  variable_charge_period_start: string;
  variable_charge_period_end: string;
  base_program_billed_days: number;
  base_program_day_rate: number | null;
  member_daily_rate_snapshot: number | null;
  transportation_billing_status_snapshot: "BillNormally" | "Waived" | "IncludedInProgramRate";
  base_program_closure_excluded_days: number;
  base_program_amount: number;
  transportation_amount: number;
  ancillary_amount: number;
  adjustment_amount: number;
  prior_balance_amount: number;
  discount_amount: number;
  total_amount: number;
  invoice_status: "Draft" | "Finalized" | "Sent" | "Paid" | "PartiallyPaid" | "Void";
  export_status: "NotExported" | "Exported";
  exported_at: string | null;
  billing_summary_text: string | null;
  snapshot_member_billing_id: string | null;
  snapshot_schedule_template_id: string | null;
  snapshot_center_billing_setting_id: string | null;
  frozen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MockBillingCoverage {
  id: string;
  member_id: string;
  coverage_start_date: string;
  coverage_end_date: string;
  coverage_type: "BaseProgram" | "Transportation" | "Ancillary" | "Adjustment";
  source_invoice_id: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MockBillingInvoiceLine {
  id: string;
  invoice_id: string;
  line_order: number;
  line_type: "BaseProgram" | "Transportation" | "Ancillary" | "Adjustment" | "Credit" | "PriorBalance";
  service_period_start: string | null;
  service_period_end: string | null;
  service_date: string | null;
  description: string;
  quantity: number;
  unit_rate: number;
  amount: number;
  source_table: string | null;
  source_record_id: string | null;
  created_at: string;
}

export interface MockBillingExportJob {
  id: string;
  billing_batch_id: string;
  export_type: "QuickBooksCSV" | "InternalReviewCSV" | "InvoiceSummaryCSV";
  generated_at: string;
  generated_by: string;
  file_name: string;
  status: "Success" | "Failed";
  notes: string | null;
  file_data_url: string | null;
}

export interface MockLead {
  id: string;
  lead_id: string;
  created_at: string;
  created_by_user_id: string;
  created_by_name: string;
  status: "Open" | "Won" | "Lost" | "Nurture";
  stage: string;
  stage_updated_at: string;
  inquiry_date: string;
  tour_date: string | null;
  tour_completed: boolean;
  discovery_date: string | null;
  member_start_date: string | null;
  caregiver_name: string;
  caregiver_relationship: string | null;
  caregiver_email: string | null;
  caregiver_phone: string;
  member_name: string;
  member_dob: string | null;
  lead_source: string;
  lead_source_other: string | null;
  referral_name: string | null;
  likelihood: string | null;
  next_follow_up_date: string | null;
  next_follow_up_type: string | null;
  notes_summary: string | null;
  lost_reason: string | null;
  closed_date: string | null;
  partner_id: string | null;
  referral_source_id?: string | null;
}

export interface MockLeadActivity {
  id: string;
  activity_id: string;
  lead_id: string;
  member_name: string;
  activity_at: string;
  activity_type: string;
  outcome: string;
  lost_reason: string | null;
  notes: string | null;
  next_follow_up_date: string | null;
  next_follow_up_type: string | null;
  completed_by_user_id: string;
  completed_by_name: string;
  partner_id?: string | null;
  referral_source_id?: string | null;
}

export interface MockPartner {
  id: string;
  partner_id: string;
  organization_name: string;
  referral_source_category: string;
  location: string;
  primary_phone: string;
  secondary_phone: string | null;
  primary_email: string;
  active: boolean;
  notes: string | null;
  last_touched: string | null;
  contact_name: string;
}

export interface MockReferralSource {
  id: string;
  referral_source_id: string;
  partner_id: string;
  contact_name: string;
  organization_name: string;
  job_title: string | null;
  primary_phone: string;
  secondary_phone: string | null;
  primary_email: string;
  preferred_contact_method: string;
  active: boolean;
  notes: string | null;
  last_touched: string | null;
}

export interface MockPartnerActivity {
  id: string;
  partner_activity_id: string;
  referral_source_id: string | null;
  partner_id: string;
  organization_name: string;
  contact_name: string;
  activity_at: string;
  activity_type: string;
  notes: string | null;
  completed_by: string;
  next_follow_up_date: string | null;
  next_follow_up_type: string | null;
  last_touched: string | null;
  lead_id?: string | null;
  completed_by_user_id?: string | null;
}

export interface MockAuditLog {
  id: string;
  actor_user_id: string;
  actor_name: string;
  actor_role: AppRole;
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  details_json: string;
  occurred_at: string;
}
export interface MockLeadStageHistory {
  id: string;
  lead_id: string;
  from_stage: string | null;
  to_stage: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
  changed_by_user_id: string;
  changed_by_name: string;
  reason: string | null;
  source: string;
}

export interface MockAssessment {
  id: string;
  lead_id: string | null;
  lead_stage_at_assessment: string | null;
  lead_status_at_assessment: string | null;
  member_id: string;
  member_name: string;
  assessment_date: string;
  completed_by: string;
  signed_by: string;
  complete: boolean;

  feeling_today: string;
  health_lately: string;
  allergies: string;
  code_status: string;
  orientation_dob_verified: boolean;
  orientation_city_verified: boolean;
  orientation_year_verified: boolean;
  orientation_occupation_verified: boolean;
  orientation_notes: string;

  medication_management_status: string;
  dressing_support_status: string;
  assistive_devices: string;
  incontinence_products: string;
  on_site_medication_use: string;
  on_site_medication_list: string;
  independence_notes: string;

  diet_type: string;
  diet_other: string;
  diet_restrictions_notes: string;

  mobility_steadiness: string;
  falls_history: string;
  mobility_aids: string;
  mobility_safety_notes: string;

  overwhelmed_by_noise: boolean;
  social_triggers: string;
  emotional_wellness_notes: string;

  joy_sparks: string;
  personal_notes: string;

  score_orientation_general_health: number;
  score_daily_routines_independence: number;
  score_nutrition_dietary_needs: number;
  score_mobility_safety: number;
  score_social_emotional_wellness: number;
  total_score: number;
  recommended_track: string;
  admission_review_required: boolean;

  transport_can_enter_exit_vehicle: string;
  transport_assistance_level: string;
  transport_mobility_aid: string;
  transport_can_remain_seated_buckled: boolean;
  transport_behavior_concern: string;
  transport_appropriate: boolean;
  transport_notes: string;
  vitals_hr: number;
  vitals_bp: string;
  vitals_o2_percent: number;
  vitals_rr: number;

  reviewer_name: string;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  notes: string;

  // Legacy MAR/BG fields retained for backward compatibility with older reports/data.
  vitals_notes?: string;
  mobility_notes?: string;
  cognitive_notes?: string;
  behavior_mood_notes?: string;
  adl_notes?: string;
  continence_notes?: string;
  nutrition_notes?: string;
  skin_notes?: string;
  meds_notes?: string;
  mar_prn_medication?: string;
  mar_prn_dose?: string;
  mar_prn_route?: string;
  mar_prn_frequency?: string;
  mar_prn_given_time?: string;
  mar_prn_indication?: string;
  mar_prn_effectiveness?: string;
  mar_prn_notes?: string;
  mar_not_given_medication?: string;
  mar_not_given_dose?: string;
  mar_not_given_route?: string;
  mar_not_given_frequency?: string;
  mar_not_given_administration_time?: string;
  mar_not_given_reason?: string;
  mar_not_given_comments?: string;
  blood_sugar_result?: string;
  blood_sugar_before_after?: string;
  blood_sugar_plan?: string;
  staff_initials?: string;
  risk_notes?: string;
  action_plan_notes?: string;
  care_plan_notes?: string;
}

export interface MockAssessmentResponse {
  id: string;
  assessment_id: string;
  member_id: string;
  field_key: string;
  field_label: string;
  section_type: string;
  field_value: string;
  field_value_type: "string" | "boolean" | "number" | "date";
  created_at: string;
}

export interface MockMemberHealthProfile {
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
  updated_by_user_id?: string | null;
  updated_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MockMemberDiagnosis {
  id: string;
  member_id: string;
  diagnosis_type: "primary" | "secondary";
  diagnosis_name: string;
  diagnosis_code: string | null;
  date_added: string;
  comments: string | null;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface MockMemberMedication {
  id: string;
  member_id: string;
  medication_name: string;
  date_started: string;
  medication_status: "active" | "inactive";
  inactivated_at: string | null;
  dose: string | null;
  quantity: string | null;
  form: string | null;
  frequency: string | null;
  route: string | null;
  route_laterality?: string | null;
  comments: string | null;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface MockMemberAllergy {
  id: string;
  member_id: string;
  allergy_group: "food" | "medication" | "environmental";
  allergy_name: string;
  severity: string | null;
  comments: string | null;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface MockMemberEquipment {
  id: string;
  member_id: string;
  equipment_type: string;
  provider_source: string | null;
  status: string | null;
  comments: string | null;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface MockMemberNote {
  id: string;
  member_id: string;
  note_type: string;
  note_text: string;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface MockMemberProvider {
  id: string;
  member_id: string;
  provider_name: string;
  specialty: string | null;
  specialty_other: string | null;
  practice_name: string | null;
  provider_phone: string | null;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface MockProviderDirectory {
  id: string;
  provider_name: string;
  specialty: string | null;
  specialty_other: string | null;
  practice_name: string | null;
  provider_phone: string | null;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface MockHospitalPreferenceDirectory {
  id: string;
  hospital_name: string;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface MockBusStopDirectory {
  id: string;
  bus_stop_name: string;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface MockDb {
  staff: MockStaff[];
  members: MockMember[];
  memberCommandCenters: MockMemberCommandCenter[];
  memberAttendanceSchedules: MockMemberAttendanceSchedule[];
  memberHolds: MockMemberHold[];
  transportationManifestAdjustments: MockTransportationManifestAdjustment[];
  memberContacts: MockMemberContact[];
  memberFiles: MockMemberFile[];
  attendanceRecords: MockAttendanceRecord[];
  timePunches: MockTimePunch[];
  dailyActivities: MockDailyActivityLog[];
  toiletLogs: MockToiletLog[];
  showerLogs: MockShowerLog[];
  transportationLogs: MockTransportationLog[];
  photoUploads: MockPhotoUpload[];
  bloodSugarLogs: MockBloodSugarLog[];
  ancillaryCategories: MockAncillaryCategory[];
  ancillaryLogs: MockAncillaryLog[];
  centerBillingSettings: MockCenterBillingSetting[];
  closureRules: MockClosureRule[];
  centerClosures: MockCenterClosure[];
  payors: MockPayor[];
  memberBillingSettings: MockMemberBillingSetting[];
  billingScheduleTemplates: MockBillingScheduleTemplate[];
  billingAdjustments: MockBillingAdjustment[];
  billingBatches: MockBillingBatch[];
  billingInvoices: MockBillingInvoice[];
  billingInvoiceLines: MockBillingInvoiceLine[];
  billingExportJobs: MockBillingExportJob[];
  billingCoverages: MockBillingCoverage[];
  leads: MockLead[];
  leadActivities: MockLeadActivity[];
  partners: MockPartner[];
  referralSources: MockReferralSource[];
  partnerActivities: MockPartnerActivity[];
  leadStageHistory: MockLeadStageHistory[];
  auditLogs: MockAuditLog[];
  assessments: MockAssessment[];
  assessmentResponses: MockAssessmentResponse[];
  memberHealthProfiles: MockMemberHealthProfile[];
  memberDiagnoses: MockMemberDiagnosis[];
  memberMedications: MockMemberMedication[];
  memberAllergies: MockMemberAllergy[];
  memberProviders: MockMemberProvider[];
  providerDirectory: MockProviderDirectory[];
  hospitalPreferenceDirectory: MockHospitalPreferenceDirectory[];
  busStopDirectory: MockBusStopDirectory[];
  memberEquipment: MockMemberEquipment[];
  memberNotes: MockMemberNote[];
}

export type ReviewStatus = "Pending" | "Reviewed" | "Needs Follow-up";

export interface StoredReview {
  status: ReviewStatus;
  notes: string;
  reviewed_by: string;
  reviewed_at: string;
}





