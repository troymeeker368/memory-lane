export const BILLING_MEMBER_RATE_SCHEDULE_SELECT =
  "member_id, daily_rate, custom_daily_rate, default_daily_rate, transportation_billing_status, billing_rate_effective_date, billing_notes";

export const BILLING_MEMBER_ATTENDANCE_SCHEDULE_SELECT =
  "member_id, daily_rate, custom_daily_rate, default_daily_rate, transportation_billing_status, monday, tuesday, wednesday, thursday, friday";

export const BILLING_ATTENDANCE_RECORD_STATUS_SELECT =
  "member_id, attendance_date, status";

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
