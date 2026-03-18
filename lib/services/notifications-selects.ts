export const ENROLLMENT_PACKET_RECIPIENT_SELECT =
  "id, member_id, lead_id, sender_user_id, member:members!enrollment_packet_requests_member_id_fkey(display_name), lead:leads(id, created_by_user_id, member_name)";

export const POF_REQUEST_CONTEXT_SELECT =
  "id, member_id, physician_order_id, sent_by_user_id, created_by_user_id, updated_by_user_id, member:members!pof_requests_member_id_fkey(display_name), physician_order:physician_orders!pof_requests_physician_order_id_fkey(id, created_by_user_id, updated_by_user_id, member_name_snapshot)";

export const CARE_PLAN_CONTEXT_SELECT =
  "id, member_id, created_by_user_id, updated_by_user_id, caregiver_sent_by_user_id, nurse_designee_user_id, nurse_signed_by_user_id, member:members!care_plans_member_id_fkey(display_name)";

export const INTAKE_CONTEXT_SELECT =
  "id, member_id, lead_id, completed_by_user_id, signed_by_user_id, member:members!intake_assessments_member_id_fkey(display_name), lead:leads(id, created_by_user_id, member_name)";

export const MEMBER_FILE_CONTEXT_SELECT =
  "id, member_id, uploaded_by_user_id, care_plan_id, pof_request_id, enrollment_packet_request_id, document_source, file_name, member:members!member_files_member_id_fkey(display_name)";
