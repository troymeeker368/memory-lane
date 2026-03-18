export const POF_POST_SIGN_QUEUE_SELECT =
  "id, physician_order_id, member_id, pof_request_id, status, attempt_count, next_retry_at, signature_completed_at, queued_at, last_error, last_failed_step";

export const PHYSICIAN_ORDER_INDEX_SELECT =
  "id, member_id, status, level_of_care, provider_name, sent_at, next_renewal_due_date, signed_at, updated_at, members!physician_orders_member_id_fkey(display_name)";

export const PHYSICIAN_ORDER_MEMBER_HISTORY_SELECT =
  "id, member_id, member_name_snapshot, provider_name, status, sent_at, signed_at, next_renewal_due_date, updated_by_name, updated_at";

export const PHYSICIAN_ORDER_WITH_MEMBER_SELECT =
  "*, members!physician_orders_member_id_fkey(display_name)";
