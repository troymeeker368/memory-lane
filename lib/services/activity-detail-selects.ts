export const MEMBER_DETAIL_DAILY_ACTIVITY_SELECT =
  "id, activity_date, activity_1_level, activity_2_level, activity_3_level, activity_4_level, activity_5_level, staff_name";

export const MEMBER_DETAIL_TOILET_SELECT = "id, event_at, use_type, staff_name";

export const MEMBER_DETAIL_SHOWER_SELECT = "id, event_at, laundry, staff_name";

export const MEMBER_DETAIL_TRANSPORTATION_SELECT = "id, service_date, pick_up_drop_off, transport_type, staff_name";

export const MEMBER_DETAIL_BLOOD_SUGAR_SELECT = "id, checked_at, reading_mg_dl, nurse_name";

export const MEMBER_DETAIL_ANCILLARY_SELECT = "id, service_date, category_name, amount_cents, staff_name";

export const MEMBER_DETAIL_ASSESSMENT_SELECT =
  "id, assessment_date, total_score, recommended_track, completed_by, reviewer_name, admission_review_required, created_at";

export const MEMBER_DETAIL_PHOTO_SELECT = "id, uploaded_at, uploaded_by_name, photo_url";

export const STAFF_DETAIL_PUNCH_SELECT = "id, punch_type, punch_at, within_fence";

export const STAFF_DETAIL_DAILY_ACTIVITY_SELECT =
  "id, member_id, activity_date, activity_1_level, activity_2_level, activity_3_level, activity_4_level, activity_5_level, staff_name, created_at";

export const STAFF_DETAIL_TOILET_SELECT = "id, member_id, event_at, use_type, briefs, staff_name";

export const STAFF_DETAIL_SHOWER_SELECT = "id, member_id, event_at, laundry, briefs, staff_name";

export const STAFF_DETAIL_TRANSPORTATION_SELECT =
  "id, member_id, service_date, pick_up_drop_off, transport_type, period, first_name, staff_name, created_at";

export const STAFF_DETAIL_ANCILLARY_SELECT = "id, member_id, service_date, category_name, amount_cents, staff_name, created_at";

export const STAFF_DETAIL_LEAD_ACTIVITY_SELECT = "id, lead_id, member_name, activity_at, activity_type, outcome, completed_by_name";

export const STAFF_DETAIL_ASSESSMENT_SELECT =
  "id, member_id, assessment_date, total_score, recommended_track, completed_by, reviewer_name, admission_review_required, created_at";
