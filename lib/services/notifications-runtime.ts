import "server-only";

import { createClient } from "@/lib/supabase/server";
import { normalizeNotificationPriority, normalizeText } from "@/lib/services/notification-content";
import {
  type JsonValue,
  type NotificationEventType,
  type NotificationStatus,
  type UserNotification,
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

function normalizeMetadata(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

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

function normalizeEventKeyPart(value: string | null | undefined) {
  return (normalizeText(value) ?? "none").replace(/[^a-zA-Z0-9:_-]/g, "_");
}

export function buildNotificationEventKey(input: {
  recipientUserId: string;
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  suffix?: string | null;
}) {
  return [
    normalizeEventKeyPart(input.eventType),
    normalizeEventKeyPart(input.entityType),
    normalizeEventKeyPart(input.entityId),
    normalizeEventKeyPart(input.recipientUserId),
    normalizeEventKeyPart(input.suffix)
  ].join(":");
}

export function canonicalizeNotificationEventType(eventType: string): NotificationEventType | null {
  const normalized = normalizeText(eventType)?.toLowerCase();
  if (!normalized) return null;

  const aliases: Record<string, NotificationEventType> = {
    action_required: "action_required",
    care_plan_caregiver_signed: "care_plan_signed",
    care_plan_created: "care_plan_created",
    care_plan_reviewed: "care_plan_reviewed",
    care_plan_sent: "care_plan_sent",
    document_uploaded: "document_uploaded",
    enrollment_packet_completed: "enrollment_packet_submitted",
    enrollment_packet_expired: "enrollment_packet_expired",
    enrollment_packet_failed: "enrollment_packet_failed",
    enrollment_packet_mapping_failed: "enrollment_packet_failed",
    enrollment_packet_sent: "enrollment_packet_sent",
    enrollment_packet_submitted: "enrollment_packet_submitted",
    intake_assessment_signed: "intake_completed",
    intake_completed: "intake_completed",
    legacy_notification: "legacy_notification",
    missing_required_document: "missing_required_document",
    physician_order_signed: "pof_signed",
    pof_expiring: "pof_expiring",
    pof_failed: "pof_failed",
    pof_request_failed: "pof_failed",
    pof_request_sent: "pof_sent",
    pof_request_signed: "pof_signed",
    pof_sent: "pof_sent",
    pof_signed: "pof_signed",
    workflow_error: "workflow_error"
  };

  return aliases[normalized] ?? null;
}

export function toRelativeActionUrl(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized.startsWith("/") ? normalized : `/${normalized.replace(/^\/+/, "")}`;
}

export function toUserNotificationRow(row: NotificationDbRow): UserNotification {
  const readAt = normalizeText(row.read_at);
  const derivedStatus = normalizeText(row.status) ? (row.status === "read" || row.status === "dismissed" ? row.status : "unread") : readAt ? "read" : "unread";
  return {
    id: String(row.id),
    recipientUserId: String(row.recipient_user_id),
    actorUserId: normalizeText(row.actor_user_id),
    eventType: String(row.event_type ?? "legacy_notification"),
    title: String(row.title ?? ""),
    message: String(row.message ?? ""),
    entityType: normalizeText(row.entity_type),
    entityId: normalizeText(row.entity_id),
    status: derivedStatus,
    priority: normalizeNotificationPriority(row.priority),
    readAt,
    actionUrl: toRelativeActionUrl(row.action_url),
    metadata: normalizeMetadata(row.metadata),
    createdAt: String(row.created_at)
  };
}

async function getActiveProfileIds(profileIds: string[]) {
  const ids = uniqueStrings(profileIds);
  if (ids.length === 0) return [] as string[];
  const supabase = createNotificationPrivilegedClient();
  const { data, error } = await supabase.from("profiles").select("id").in("id", ids).eq("active", true);
  if (error) throw new Error(error.message);
  return uniqueStrings((data ?? []).map((row) => String(row.id)));
}

async function listFallbackAdminRecipientIds() {
  const supabase = createNotificationPrivilegedClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("active", true)
    .in("role", ["admin", "director", "manager"]);
  if (error) throw new Error(error.message);
  return uniqueStrings((data ?? []).map((row) => String(row.id)));
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

export function resolveEnrollmentRecipients(context: WorkflowRecipientContext) {
  return uniqueStrings([context.enrollmentSenderUserId, context.leadOwnerUserId]);
}

export function resolveClinicalRecipients(context: WorkflowRecipientContext) {
  return uniqueStrings([
    context.pofSenderUserId,
    context.pofOwnerUserId,
    context.carePlanCreatedByUserId,
    context.carePlanUpdatedByUserId,
    context.carePlanNurseDesigneeUserId,
    context.carePlanNurseSignedByUserId,
    context.caregiverSentByUserId,
    context.intakeCompletedByUserId,
    context.intakeSignedByUserId
  ]);
}

export async function resolveOperationsRecipients(input: { memberId?: string | null }) {
  return queryOperationsRecipients(input);
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

export async function resolveWorkflowRecipients(input: {
  eventType: NotificationEventType;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, JsonValue> | null;
  explicitRecipientUserIds?: string[];
}) {
  const explicitRecipientUserIds = uniqueStrings(input.explicitRecipientUserIds ?? []);
  if (explicitRecipientUserIds.length > 0) {
    return getActiveProfileIds(explicitRecipientUserIds);
  }

  const context = await loadWorkflowRecipientContext({
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata
  });
  const operationsRecipients = await queryOperationsRecipients({ memberId: context.memberId });
  const enrollmentRecipients = resolveEnrollmentRecipients(context);
  const clinicalRecipients = resolveClinicalRecipients(context);

  let recipients: string[] = [];
  switch (input.eventType) {
    case "enrollment_packet_sent":
    case "enrollment_packet_submitted":
    case "enrollment_packet_expired":
    case "enrollment_packet_failed":
    case "missing_required_document":
      recipients = uniqueStrings([...enrollmentRecipients, ...operationsRecipients]);
      break;
    case "pof_sent":
    case "pof_signed":
    case "pof_expiring":
    case "pof_failed":
      recipients = uniqueStrings([...clinicalRecipients, ...operationsRecipients]);
      break;
    case "intake_completed":
      recipients = uniqueStrings([...clinicalRecipients, ...enrollmentRecipients, ...operationsRecipients]);
      break;
    case "care_plan_created":
    case "care_plan_reviewed":
    case "care_plan_sent":
    case "care_plan_signed":
      recipients = uniqueStrings([...clinicalRecipients, ...operationsRecipients]);
      break;
    case "document_uploaded":
      recipients = uniqueStrings([
        context.memberFileUploadedByUserId,
        ...enrollmentRecipients,
        ...clinicalRecipients,
        ...operationsRecipients
      ]);
      break;
    case "action_required":
    case "workflow_error":
      recipients = uniqueStrings([...enrollmentRecipients, ...clinicalRecipients, ...operationsRecipients]);
      if (recipients.length === 0) {
        recipients = await listFallbackAdminRecipientIds();
      }
      break;
    case "legacy_notification":
    default:
      recipients = uniqueStrings([...enrollmentRecipients, ...clinicalRecipients, ...operationsRecipients]);
      break;
  }

  return getActiveProfileIds(recipients);
}

export async function listUserNotificationsForUser(
  userId: string,
  options?: { limit?: number; serviceRole?: boolean; statuses?: NotificationStatus[] }
) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) throw new Error("User ID is required.");
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));
  const supabase =
    options?.serviceRole === true
      ? createServiceRoleClient("notification_user_inbox_read")
      : await createClient();

  let query = supabase
    .from("user_notifications")
    .select("*")
    .eq("recipient_user_id", normalizedUserId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const statuses = Array.from(new Set(options?.statuses ?? []));
  if (statuses.length > 0) {
    query = query.in("status", statuses);
  }

  let { data, error } = await query;
  if (error && statuses.length > 0 && String((error as { code?: string }).code ?? "") === "42703") {
    const fallback = await supabase
      .from("user_notifications")
      .select("*")
      .eq("recipient_user_id", normalizedUserId)
      .order("created_at", { ascending: false })
      .limit(limit);
    data = fallback.data;
    error = fallback.error;
    if (!error) {
      return (data ?? [])
        .map((row) => toUserNotificationRow(row))
        .filter((notification) => statuses.includes(notification.status));
    }
  }
  if (error) {
    console.error("[notifications] unable to list user notifications", error);
    return [] as UserNotification[];
  }
  return (data ?? []).map((row) => toUserNotificationRow(row));
}
