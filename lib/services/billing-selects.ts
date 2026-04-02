export const BILLING_MEMBER_RATE_SCHEDULE_SELECT =
  "member_id, daily_rate, custom_daily_rate, default_daily_rate, transportation_billing_status, billing_rate_effective_date, billing_notes";

export const BILLING_CENTER_SETTING_SELECT =
  "id, default_daily_rate, default_extra_day_rate, default_transport_one_way_rate, default_transport_round_trip_rate, billing_cutoff_day, default_billing_mode, effective_start_date, effective_end_date, active, created_at, updated_at, updated_by_user_id, updated_by_name";

export const BILLING_MEMBER_SETTING_SELECT =
  "id, member_id, payor_id, use_center_default_billing_mode, billing_mode, monthly_billing_basis, use_center_default_rate, custom_daily_rate, flat_monthly_rate, bill_extra_days, transportation_billing_status, bill_ancillary_arrears, active, effective_start_date, effective_end_date, billing_notes, created_at, updated_at, updated_by_user_id, updated_by_name";

export const BILLING_SCHEDULE_TEMPLATE_SELECT =
  "id, member_id, effective_start_date, effective_end_date, monday, tuesday, wednesday, thursday, friday, saturday, sunday, active, notes, created_at, updated_at, updated_by_user_id, updated_by_name";

export const BILLING_MEMBER_ATTENDANCE_SCHEDULE_SELECT =
  "member_id, daily_rate, custom_daily_rate, default_daily_rate, transportation_billing_status, monday, tuesday, wednesday, thursday, friday";

export const BILLING_ATTENDANCE_RECORD_STATUS_SELECT =
  "id, member_id, attendance_date, status";

export const BILLING_TRANSPORTATION_LOG_SELECT =
  "id, member_id, service_date, transport_type, quantity, unit_rate, total_amount, billing_status, billing_exclusion_reason, billable";

export const BILLING_ANCILLARY_CHARGE_LOG_SELECT =
  "id, member_id, category_id, service_date, quantity, unit_rate, amount, billing_status, billing_exclusion_reason";

export const BILLING_ADJUSTMENT_PREVIEW_SELECT =
  "id, member_id, adjustment_date, description, quantity, unit_rate, amount, billing_status, adjustment_type";

export const BILLING_ADJUSTMENT_QUEUE_SELECT =
  "id, member_id, adjustment_date, description, quantity, unit_rate, amount, billing_status, exclusion_reason";

export const BILLING_MEMBER_LOOKUP_SELECT = "id, display_name";

export const BILLING_ACTIVE_MEMBER_LOOKUP_SELECT = "id, display_name, status";

export const BILLING_ANCILLARY_CATEGORY_SELECT = "id, name, price_cents";
