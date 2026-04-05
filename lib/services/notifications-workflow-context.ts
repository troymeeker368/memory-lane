import { normalizeText } from "@/lib/services/notification-content";
import {
  type JsonValue,
  type WorkflowRecipientContext
} from "@/lib/services/notification-types";
import {
  CARE_PLAN_CONTEXT_SELECT,
  ENROLLMENT_PACKET_RECIPIENT_SELECT,
  INTAKE_CONTEXT_SELECT,
  MEMBER_FILE_CONTEXT_SELECT,
  POF_REQUEST_CONTEXT_SELECT
} from "@/lib/services/notifications-selects";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type JoinedNotificationRow = {
  display_name?: string | null;
  full_name?: string | null;
  created_by_user_id?: string | null;
  member_name?: string | null;
  member_name_snapshot?: string | null;
  updated_by_user_id?: string | null;
};

type NotificationDbRow = {
  [key: string]: unknown;
  id?: string | null;
  recipient_user_id?: string | null;
  actor_user_id?: string | null;
  event_type?: string | null;
  title?: string | null;
  message?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  status?: string | null;
  priority?: string | null;
  read_at?: string | null;
  action_url?: string | null;
  metadata?: JsonValue | Record<string, unknown> | null;
  created_at?: string | null;
  member?: JoinedNotificationRow | JoinedNotificationRow[] | null;
  lead?: JoinedNotificationRow | JoinedNotificationRow[] | null;
  physician_order?: JoinedNotificationRow | JoinedNotificationRow[] | null;
  member_id?: string | null;
  lead_id?: string | null;
  sender_user_id?: string | null;
  physician_order_id?: string | null;
  sent_by_user_id?: string | null;
  created_by_user_id?: string | null;
  updated_by_user_id?: string | null;
  nurse_designee_user_id?: string | null;
  nurse_signed_by_user_id?: string | null;
  caregiver_sent_by_user_id?: string | null;
  completed_by_user_id?: string | null;
  signed_by_user_id?: string | null;
  document_source?: string | null;
  file_name?: string | null;
  care_plan_id?: string | null;
  pof_request_id?: string | null;
  enrollment_packet_request_id?: string | null;
  uploaded_by_user_id?: string | null;
  member_name_snapshot?: string | null;
};

function createNotificationPrivilegedClient() {
  // Recipient resolution crosses staff-owned workflow rows and user inbox rows that
  // are intentionally hidden from arbitrary staff sessions by RLS.
  return createServiceRoleClient("notification_workflow_context_read");
}

function requireNotificationContextRow(
  row: NotificationDbRow | null | undefined,
  entityType: string,
  entityId: string
) {
  if (row) return row;
  throw new Error(
    `Missing canonical ${entityType} context row for id ${entityId}. Notification recipients require Supabase-backed context.`
  );
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean))) as string[];
}

function pickJoinedRow<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null;
  return (value ?? null) as T | null;
}

async function queryOperationsRecipients(input: { memberId?: string | null }) {
  const memberId = normalizeText(input.memberId);
  if (!memberId) return [] as string[];
  const supabase = createNotificationPrivilegedClient();
  const { data, error } = await supabase
    .from("documentation_tracker")
    .select("assigned_staff_user_id")
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return uniqueStrings([data?.assigned_staff_user_id]);
}

async function loadEnrollmentContext(entityId: string, metadata: Record<string, JsonValue>) {
  const supabase = createNotificationPrivilegedClient();
  const { data, error } = await supabase
    .from("enrollment_packet_requests")
    .select(ENROLLMENT_PACKET_RECIPIENT_SELECT)
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = requireNotificationContextRow(data as NotificationDbRow | null, "enrollment_packet_request", entityId);
  const member = pickJoinedRow<{ display_name?: string | null }>(row.member);
  const lead = pickJoinedRow<{ created_by_user_id?: string | null; member_name?: string | null }>(row.lead);
  const memberId = normalizeText(row.member_id) ?? normalizeText(String(metadata.member_id ?? metadata.memberId ?? ""));
  return {
    entityType: "enrollment_packet_request",
    entityId,
    memberId,
    memberName:
      normalizeText(member?.display_name) ??
      normalizeText(lead?.member_name) ??
      normalizeText(String(metadata.member_name ?? metadata.memberName ?? "")),
    leadId: normalizeText(row.lead_id) ?? normalizeText(String(metadata.lead_id ?? metadata.leadId ?? "")),
    leadOwnerUserId: normalizeText(lead?.created_by_user_id),
    enrollmentSenderUserId: normalizeText(row.sender_user_id),
    physicianOrderId: null,
    pofRequestId: null,
    pofSenderUserId: null,
    pofOwnerUserId: null,
    carePlanId: null,
    carePlanCreatedByUserId: null,
    carePlanUpdatedByUserId: null,
    carePlanNurseDesigneeUserId: null,
    carePlanNurseSignedByUserId: null,
    caregiverSentByUserId: null,
    intakeAssessmentId: null,
    intakeCompletedByUserId: null,
    intakeSignedByUserId: null,
    memberFileId: null,
    memberFileUploadedByUserId: null,
    documentationAssignedStaffUserId: null,
    metadata
  } satisfies WorkflowRecipientContext;
}

async function loadPofContext(entityType: string, entityId: string, metadata: Record<string, JsonValue>) {
  const supabase = createNotificationPrivilegedClient();
  if (entityType === "pof_request") {
    const { data, error } = await supabase
      .from("pof_requests")
      .select(POF_REQUEST_CONTEXT_SELECT)
      .eq("id", entityId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = requireNotificationContextRow(data as NotificationDbRow | null, "pof_request", entityId);
    const member = pickJoinedRow<{ display_name?: string | null }>(row.member);
    const physicianOrder = pickJoinedRow<{
      created_by_user_id?: string | null;
      member_name_snapshot?: string | null;
      updated_by_user_id?: string | null;
    }>(row.physician_order);
    return {
      entityType,
      entityId,
      memberId: normalizeText(row.member_id),
      memberName:
        normalizeText(member?.display_name) ??
        normalizeText(physicianOrder?.member_name_snapshot) ??
        normalizeText(String(metadata.member_name ?? metadata.memberName ?? "")),
      leadId: null,
      leadOwnerUserId: null,
      enrollmentSenderUserId: null,
      physicianOrderId: normalizeText(row.physician_order_id),
      pofRequestId: normalizeText(row.id),
      pofSenderUserId: normalizeText(row.sent_by_user_id),
      pofOwnerUserId: normalizeText(physicianOrder?.updated_by_user_id) ?? normalizeText(physicianOrder?.created_by_user_id),
      carePlanId: null,
      carePlanCreatedByUserId: null,
      carePlanUpdatedByUserId: null,
      carePlanNurseDesigneeUserId: null,
      carePlanNurseSignedByUserId: null,
      caregiverSentByUserId: null,
      intakeAssessmentId: null,
      intakeCompletedByUserId: null,
      intakeSignedByUserId: null,
      memberFileId: null,
      memberFileUploadedByUserId: null,
      documentationAssignedStaffUserId: null,
      metadata
    } satisfies WorkflowRecipientContext;
  }

  const { data, error } = await supabase
    .from("physician_orders")
    .select("id, member_id, created_by_user_id, updated_by_user_id, member_name_snapshot")
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const { data: requestRow, error: requestError } = await supabase
    .from("pof_requests")
    .select("id, sent_by_user_id")
    .eq("physician_order_id", entityId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (requestError) throw new Error(requestError.message);
  const row = requireNotificationContextRow(data as NotificationDbRow | null, "physician_order", entityId);
  const request = (requestRow ?? null) as NotificationDbRow | null;

  return {
    entityType,
    entityId,
    memberId: normalizeText(row.member_id),
    memberName: normalizeText(row.member_name_snapshot) ?? normalizeText(String(metadata.member_name ?? metadata.memberName ?? "")),
    leadId: null,
    leadOwnerUserId: null,
    enrollmentSenderUserId: null,
    physicianOrderId: normalizeText(row.id),
    pofRequestId: normalizeText(request?.id),
    pofSenderUserId: normalizeText(request?.sent_by_user_id),
    pofOwnerUserId: normalizeText(row.updated_by_user_id) ?? normalizeText(row.created_by_user_id),
    carePlanId: null,
    carePlanCreatedByUserId: null,
    carePlanUpdatedByUserId: null,
    carePlanNurseDesigneeUserId: null,
    carePlanNurseSignedByUserId: null,
    caregiverSentByUserId: null,
    intakeAssessmentId: null,
    intakeCompletedByUserId: null,
    intakeSignedByUserId: null,
    memberFileId: null,
    memberFileUploadedByUserId: null,
    documentationAssignedStaffUserId: null,
    metadata
  } satisfies WorkflowRecipientContext;
}

async function loadCarePlanContext(entityId: string, metadata: Record<string, JsonValue>) {
  const supabase = createNotificationPrivilegedClient();
  const { data, error } = await supabase
    .from("care_plans")
    .select(CARE_PLAN_CONTEXT_SELECT)
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = requireNotificationContextRow(data as NotificationDbRow | null, "care_plan", entityId);
  const member = pickJoinedRow<{ display_name?: string | null }>(row.member);
  return {
    entityType: "care_plan",
    entityId,
    memberId: normalizeText(row.member_id),
    memberName:
      normalizeText(member?.display_name) ??
      normalizeText(String(metadata.member_name ?? metadata.memberName ?? "")),
    leadId: null,
    leadOwnerUserId: null,
    enrollmentSenderUserId: null,
    physicianOrderId: null,
    pofRequestId: null,
    pofSenderUserId: null,
    pofOwnerUserId: null,
    carePlanId: normalizeText(row.id),
    carePlanCreatedByUserId: normalizeText(row.created_by_user_id),
    carePlanUpdatedByUserId: normalizeText(row.updated_by_user_id),
    carePlanNurseDesigneeUserId: normalizeText(row.nurse_designee_user_id),
    carePlanNurseSignedByUserId: normalizeText(row.nurse_signed_by_user_id),
    caregiverSentByUserId: normalizeText(row.caregiver_sent_by_user_id),
    intakeAssessmentId: null,
    intakeCompletedByUserId: null,
    intakeSignedByUserId: null,
    memberFileId: null,
    memberFileUploadedByUserId: null,
    documentationAssignedStaffUserId: null,
    metadata
  } satisfies WorkflowRecipientContext;
}

async function loadIntakeContext(entityId: string, metadata: Record<string, JsonValue>) {
  const supabase = createNotificationPrivilegedClient();
  const { data, error } = await supabase
    .from("intake_assessments")
    .select(INTAKE_CONTEXT_SELECT)
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = requireNotificationContextRow(data as NotificationDbRow | null, "intake_assessment", entityId);
  const member = pickJoinedRow<{ display_name?: string | null }>(row.member);
  const lead = pickJoinedRow<{ created_by_user_id?: string | null; member_name?: string | null }>(row.lead);
  return {
    entityType: "intake_assessment",
    entityId,
    memberId: normalizeText(row.member_id),
    memberName:
      normalizeText(member?.display_name) ??
      normalizeText(lead?.member_name) ??
      normalizeText(String(metadata.member_name ?? metadata.memberName ?? "")),
    leadId: normalizeText(row.lead_id),
    leadOwnerUserId: normalizeText(lead?.created_by_user_id),
    enrollmentSenderUserId: null,
    physicianOrderId: null,
    pofRequestId: null,
    pofSenderUserId: null,
    pofOwnerUserId: null,
    carePlanId: null,
    carePlanCreatedByUserId: null,
    carePlanUpdatedByUserId: null,
    carePlanNurseDesigneeUserId: null,
    carePlanNurseSignedByUserId: null,
    caregiverSentByUserId: null,
    intakeAssessmentId: normalizeText(row.id),
    intakeCompletedByUserId: normalizeText(row.completed_by_user_id),
    intakeSignedByUserId: normalizeText(row.signed_by_user_id),
    memberFileId: null,
    memberFileUploadedByUserId: null,
    documentationAssignedStaffUserId: null,
    metadata
  } satisfies WorkflowRecipientContext;
}

async function loadMemberFileContext(entityId: string, metadata: Record<string, JsonValue>) {
  const supabase = createNotificationPrivilegedClient();
  const { data, error } = await supabase
    .from("member_files")
    .select(MEMBER_FILE_CONTEXT_SELECT)
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = requireNotificationContextRow(data as NotificationDbRow | null, "member_file", entityId);
  const member = pickJoinedRow<{ display_name?: string | null }>(row.member);
  const memberId = normalizeText(row.member_id);
  let baseContext: WorkflowRecipientContext = {
    entityType: "member_file",
    entityId,
    memberId,
    memberName:
      normalizeText(member?.display_name) ??
      normalizeText(String(metadata.member_name ?? metadata.memberName ?? "")),
    leadId: null,
    leadOwnerUserId: null,
    enrollmentSenderUserId: null,
    physicianOrderId: null,
    pofRequestId: null,
    pofSenderUserId: null,
    pofOwnerUserId: null,
    carePlanId: normalizeText(row.care_plan_id),
    carePlanCreatedByUserId: null,
    carePlanUpdatedByUserId: null,
    carePlanNurseDesigneeUserId: null,
    carePlanNurseSignedByUserId: null,
    caregiverSentByUserId: null,
    intakeAssessmentId: null,
    intakeCompletedByUserId: null,
    intakeSignedByUserId: null,
    memberFileId: normalizeText(row.id),
    memberFileUploadedByUserId: normalizeText(row.uploaded_by_user_id),
    documentationAssignedStaffUserId: null,
    metadata: {
      document_source: normalizeText(row.document_source),
      file_name: normalizeText(row.file_name),
      ...(metadata ?? {})
    }
  };

  if (normalizeText(row.enrollment_packet_request_id)) {
    baseContext = {
      ...(await loadEnrollmentContext(String(row.enrollment_packet_request_id), baseContext.metadata)),
      entityType: "member_file",
      entityId,
      memberFileId: normalizeText(row.id),
      memberFileUploadedByUserId: normalizeText(row.uploaded_by_user_id),
      metadata: baseContext.metadata
    };
  } else if (normalizeText(row.pof_request_id)) {
    baseContext = {
      ...(await loadPofContext("pof_request", String(row.pof_request_id), baseContext.metadata)),
      entityType: "member_file",
      entityId,
      memberFileId: normalizeText(row.id),
      memberFileUploadedByUserId: normalizeText(row.uploaded_by_user_id),
      metadata: baseContext.metadata
    };
  } else if (normalizeText(row.care_plan_id)) {
    baseContext = {
      ...(await loadCarePlanContext(String(row.care_plan_id), baseContext.metadata)),
      entityType: "member_file",
      entityId,
      memberFileId: normalizeText(row.id),
      memberFileUploadedByUserId: normalizeText(row.uploaded_by_user_id),
      metadata: baseContext.metadata
    };
  }

  baseContext.documentationAssignedStaffUserId = (await queryOperationsRecipients({ memberId }))[0] ?? null;
  return baseContext;
}

export async function resolveOperationsRecipients(input: { memberId?: string | null }) {
  return queryOperationsRecipients(input);
}

export async function loadWorkflowRecipientContext(input: {
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, JsonValue> | null;
}) {
  const entityType = normalizeText(input.entityType) ?? "workflow";
  const entityId = normalizeText(input.entityId);
  const metadata = (input.metadata ?? {}) as Record<string, JsonValue>;

  if (!entityId) {
    const memberId = normalizeText(String(metadata.member_id ?? metadata.memberId ?? ""));
    const documentationRecipients = await queryOperationsRecipients({ memberId });
    return {
      entityType,
      entityId: null,
      memberId,
      memberName: normalizeText(String(metadata.member_name ?? metadata.memberName ?? "")),
      leadId: normalizeText(String(metadata.lead_id ?? metadata.leadId ?? "")),
      leadOwnerUserId: null,
      enrollmentSenderUserId: null,
      physicianOrderId: normalizeText(String(metadata.physician_order_id ?? metadata.physicianOrderId ?? "")),
      pofRequestId: normalizeText(String(metadata.pof_request_id ?? metadata.requestId ?? "")),
      pofSenderUserId: null,
      pofOwnerUserId: null,
      carePlanId: normalizeText(String(metadata.care_plan_id ?? metadata.carePlanId ?? "")),
      carePlanCreatedByUserId: null,
      carePlanUpdatedByUserId: null,
      carePlanNurseDesigneeUserId: null,
      carePlanNurseSignedByUserId: null,
      caregiverSentByUserId: null,
      intakeAssessmentId: normalizeText(String(metadata.intake_assessment_id ?? metadata.assessmentId ?? "")),
      intakeCompletedByUserId: null,
      intakeSignedByUserId: null,
      memberFileId: normalizeText(String(metadata.member_file_id ?? metadata.memberFileId ?? "")),
      memberFileUploadedByUserId: null,
      documentationAssignedStaffUserId: documentationRecipients[0] ?? null,
      metadata
    } satisfies WorkflowRecipientContext;
  }

  if (entityType === "enrollment_packet_request") return loadEnrollmentContext(entityId, metadata);
  if (entityType === "pof_request" || entityType === "physician_order") return loadPofContext(entityType, entityId, metadata);
  if (entityType === "care_plan") return loadCarePlanContext(entityId, metadata);
  if (entityType === "intake_assessment") return loadIntakeContext(entityId, metadata);
  if (entityType === "member_file") return loadMemberFileContext(entityId, metadata);

  return loadWorkflowRecipientContext({
    entityType,
    entityId: null,
    metadata
  });
}
