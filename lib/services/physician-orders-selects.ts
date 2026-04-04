export const POF_POST_SIGN_QUEUE_SELECT =
  "id, physician_order_id, member_id, pof_request_id, status, attempt_count, next_retry_at, signature_completed_at, queued_at, last_error, last_failed_step";

export const PHYSICIAN_ORDER_INDEX_SELECT =
  "id, member_id, status, level_of_care, provider_name, sent_at, next_renewal_due_date, signed_at, updated_at, members!physician_orders_member_id_fkey(display_name)";

export const PHYSICIAN_ORDER_MEMBER_HISTORY_SELECT =
  "id, member_id, member_name_snapshot, provider_name, status, sent_at, signed_at, next_renewal_due_date, updated_by_name, updated_at";

export const PHYSICIAN_ORDER_WITH_MEMBER_SELECT =
  "id, member_id, intake_assessment_id, member_name_snapshot, member_dob_snapshot, sex, level_of_care, dnr_selected, vitals_blood_pressure, vitals_pulse, vitals_oxygen_saturation, vitals_respiration, diagnoses, allergies, medications, standing_orders, clinical_support, operational_flags, provider_name, provider_signature, provider_signature_date, status, created_by_user_id, created_by_name, created_at, sent_at, updated_by_user_id, updated_by_name, next_renewal_due_date, signed_by_name, signed_at, superseded_at, superseded_by, updated_at, members!physician_orders_member_id_fkey(display_name)";
