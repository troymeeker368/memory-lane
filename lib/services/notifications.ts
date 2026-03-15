import "server-only";

import { createClient } from "@/lib/supabase/server";
import { toEasternISO } from "@/lib/timezone";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const NOTIFICATION_EVENT_TYPES = [
  "action_required",
  "care_plan_created",
  "care_plan_reviewed",
  "care_plan_sent",
  "care_plan_signed",
  "document_uploaded",
  "enrollment_packet_expired",
  "enrollment_packet_failed",
  "enrollment_packet_sent",
  "enrollment_packet_submitted",
  "intake_completed",
  "legacy_notification",
  "missing_required_document",
  "pof_expiring",
  "pof_failed",
  "pof_sent",
  "pof_signed",
  "workflow_error"
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];
export type NotificationStatus = "unread" | "read" | "dismissed";
export type NotificationPriority = "low" | "medium" | "high" | "critical";

export type UserNotification = {
  id: string;
  recipientUserId: string;
  actorUserId: string | null;
  eventType: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  status: NotificationStatus;
  priority: NotificationPriority;
  readAt: string | null;
  actionUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CreateNotificationInput = {
  recipientUserId: string;
  actorUserId?: string | null;
  eventType: NotificationEventType | string;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  status?: NotificationStatus;
  priority?: NotificationPriority;
  actionUrl?: string | null;
  metadata?: Record<string, JsonValue>;
  eventKey?: string | null;
  reopenOnConflict?: boolean;
  serviceRole?: boolean;
};

export type CreateUserNotificationInput = {
  recipientUserId: string;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  priority?: NotificationPriority;
  actionUrl?: string | null;
  metadata?: Record<string, JsonValue>;
  serviceRole?: boolean;
};

export type DispatchNotificationEventInput = {
  eventType?: string;
  event_type?: string;
  entityType?: string;
  entity_type?: string;
  entityId?: string | null;
  entity_id?: string | null;
  actorType?: string | null;
  actor_type?: string | null;
  actorId?: string | null;
  actor_id?: string | null;
  actorUserId?: string | null;
  actor_user_id?: string | null;
  status?: string | null;
  severity?: string | null;
  metadata?: Record<string, JsonValue> | null;
  recipientUserIds?: string[];
  eventKeySuffix?: string | null;
  reopenOnConflict?: boolean;
};

type WorkflowRecipientContext = {
  entityType: string;
  entityId: string | null;
  memberId: string | null;
  memberName: string | null;
  leadId: string | null;
  leadOwnerUserId: string | null;
  enrollmentSenderUserId: string | null;
  physicianOrderId: string | null;
  pofRequestId: string | null;
  pofSenderUserId: string | null;
  pofOwnerUserId: string | null;
  carePlanId: string | null;
  carePlanCreatedByUserId: string | null;
  carePlanUpdatedByUserId: string | null;
  carePlanNurseDesigneeUserId: string | null;
  carePlanNurseSignedByUserId: string | null;
  caregiverSentByUserId: string | null;
  intakeAssessmentId: string | null;
  intakeCompletedByUserId: string | null;
  intakeSignedByUserId: string | null;
  memberFileId: string | null;
  memberFileUploadedByUserId: string | null;
  documentationAssignedStaffUserId: string | null;
  metadata: Record<string, JsonValue>;
};

type NotificationContent = {
  actionUrl: string | null;
  message: string;
  priority: NotificationPriority;
  title: string;
};

function normalizeText(value: string | null | undefined) {
  const cleaned = (value ?? "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeNotificationStatus(value: string | null | undefined): NotificationStatus {
  return value === "read" || value === "dismissed" ? value : "unread";
}

function normalizeNotificationPriority(value: string | null | undefined): NotificationPriority {
  if (value === "low" || value === "high" || value === "critical") return value;
  return "medium";
}

function normalizeMetadata(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean))) as string[];
}

function notificationLabel(value: string | null | undefined, fallback = "this workflow") {
  return normalizeText(value) ?? fallback;
}

function pickJoinedRow<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null;
  return (value ?? null) as T | null;
}

function isMissingSchemaObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "");
  const message = String((error as { message?: string }).message ?? "").toLowerCase();
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

function isUniqueViolation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  return String((error as { code?: string }).code ?? "") === "23505";
}

function isMissingNotificationColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "");
  const message = String((error as { message?: string }).message ?? "").toLowerCase();
  return code === "42703" && message.includes(columnName.toLowerCase());
}

function mapNotificationError(error: unknown) {
  if (isMissingSchemaObjectError(error)) {
    return "Missing Supabase schema object public.user_notifications. Apply migration 0060_notification_workflow_engine.sql and refresh PostgREST schema cache.";
  }
  if (!error || typeof error !== "object") return "Unknown notification service error.";
  return String((error as { message?: string }).message ?? "Unknown notification service error.");
}

function toRelativeActionUrl(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized.startsWith("/") ? normalized : `/${normalized.replace(/^\/+/, "")}`;
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

function canonicalizeNotificationEventType(eventType: string): NotificationEventType | null {
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

function toRow(row: any): UserNotification {
  const readAt = normalizeText(row.read_at);
  const derivedStatus = normalizeText(row.status) ? normalizeNotificationStatus(row.status) : readAt ? "read" : "unread";
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
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase.from("profiles").select("id").in("id", ids).eq("active", true);
  if (error) throw new Error(error.message);
  return uniqueStrings((data ?? []).map((row: any) => String(row.id)));
}

async function listFallbackAdminRecipientIds() {
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("active", true)
    .in("role", ["admin", "director", "manager"]);
  if (error) throw new Error(error.message);
  return uniqueStrings((data ?? []).map((row: any) => String(row.id)));
}

async function resolveOperationsRecipients(input: { memberId?: string | null }) {
  const memberId = normalizeText(input.memberId);
  if (!memberId) return [] as string[];
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase
    .from("documentation_tracker")
    .select("assigned_staff_user_id")
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return uniqueStrings([data?.assigned_staff_user_id]);
}

function resolveEnrollmentRecipients(context: WorkflowRecipientContext) {
  return uniqueStrings([context.enrollmentSenderUserId, context.leadOwnerUserId]);
}

function resolveClinicalRecipients(context: WorkflowRecipientContext) {
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

async function loadEnrollmentContext(entityId: string, metadata: Record<string, JsonValue>) {
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase
    .from("enrollment_packet_requests")
    .select(
      "id, member_id, lead_id, sender_user_id, member:members!enrollment_packet_requests_member_id_fkey(display_name), lead:leads(id, created_by_user_id, member_name)"
    )
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as any;
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
  const supabase = await createClient({ serviceRole: true });
  if (entityType === "pof_request") {
    const { data, error } = await supabase
      .from("pof_requests")
      .select(
        "id, member_id, physician_order_id, sent_by_user_id, created_by_user_id, updated_by_user_id, member:members!pof_requests_member_id_fkey(display_name), physician_order:physician_orders!pof_requests_physician_order_id_fkey(id, created_by_user_id, updated_by_user_id, member_name_snapshot)"
      )
      .eq("id", entityId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data ?? {}) as any;
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
  const row = (data ?? {}) as any;
  const request = (requestRow ?? {}) as any;

  return {
    entityType,
    entityId,
    memberId: normalizeText(row.member_id),
    memberName: normalizeText(row.member_name_snapshot) ?? normalizeText(String(metadata.member_name ?? metadata.memberName ?? "")),
    leadId: null,
    leadOwnerUserId: null,
    enrollmentSenderUserId: null,
    physicianOrderId: normalizeText(row.id),
    pofRequestId: normalizeText(request.id),
    pofSenderUserId: normalizeText(request.sent_by_user_id),
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
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase
    .from("care_plans")
    .select(
      "id, member_id, created_by_user_id, updated_by_user_id, caregiver_sent_by_user_id, nurse_designee_user_id, nurse_signed_by_user_id, member:members!care_plans_member_id_fkey(display_name)"
    )
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as any;
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
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase
    .from("intake_assessments")
    .select(
      "id, member_id, lead_id, completed_by_user_id, signed_by_user_id, member:members!intake_assessments_member_id_fkey(display_name), lead:leads(id, created_by_user_id, member_name)"
    )
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as any;
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
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase
    .from("member_files")
    .select(
      "id, member_id, uploaded_by_user_id, care_plan_id, pof_request_id, enrollment_packet_request_id, document_source, file_name, member:members!member_files_member_id_fkey(display_name)"
    )
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as any;
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

  baseContext.documentationAssignedStaffUserId = (await resolveOperationsRecipients({ memberId }))[0] ?? null;
  return baseContext;
}

async function loadWorkflowRecipientContext(input: {
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, JsonValue> | null;
}) {
  const entityType = normalizeText(input.entityType) ?? "workflow";
  const entityId = normalizeText(input.entityId);
  const metadata = (input.metadata ?? {}) as Record<string, JsonValue>;

  if (!entityId) {
    const memberId = normalizeText(String(metadata.member_id ?? metadata.memberId ?? ""));
    const documentationRecipients = await resolveOperationsRecipients({ memberId });
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

function buildDefaultActionUrl(context: WorkflowRecipientContext) {
  if (context.entityType === "care_plan" || context.carePlanId) {
    return context.carePlanId
      ? `/health/care-plans/${context.carePlanId}`
      : context.memberId
        ? `/health/care-plans/member/${context.memberId}/latest`
        : "/notifications";
  }
  if (context.entityType === "pof_request" || context.entityType === "physician_order" || context.physicianOrderId) {
    return context.physicianOrderId
      ? `/health/physician-orders/${context.physicianOrderId}`
      : context.memberId
        ? `/operations/member-command-center/${context.memberId}`
        : "/notifications";
  }
  if (context.entityType === "enrollment_packet_request" || context.enrollmentSenderUserId || context.leadId) {
    return context.leadId
      ? `/sales/leads/${context.leadId}`
      : context.memberId
        ? `/operations/member-command-center/${context.memberId}`
        : "/notifications";
  }
  if (context.entityType === "intake_assessment" || context.intakeAssessmentId) {
    return context.memberId ? `/operations/member-command-center/${context.memberId}` : "/documentation/assessment";
  }
  if (context.entityType === "member_file" || context.memberFileId) {
    return context.memberId ? `/operations/member-command-center/${context.memberId}` : "/documentation";
  }
  return context.memberId ? `/operations/member-command-center/${context.memberId}` : "/notifications";
}

function buildNotificationContent(eventType: NotificationEventType, context: WorkflowRecipientContext): NotificationContent {
  const memberLabel = notificationLabel(context.memberName, "this member");
  const actionUrl = buildDefaultActionUrl(context);
  const metadata = context.metadata;
  const documentLabel =
    normalizeText(String(metadata.file_name ?? metadata.document_label ?? metadata.document_source ?? "")) ?? "Document";

  switch (eventType) {
    case "enrollment_packet_sent":
      return {
        title: "Enrollment Packet Sent",
        message: `Enrollment packet sent for ${memberLabel}.`,
        priority: "medium",
        actionUrl
      };
    case "enrollment_packet_submitted":
      return {
        title: "Enrollment Packet Submitted",
        message: `Enrollment packet submitted for ${memberLabel}. Review intake details and begin enrollment.`,
        priority: "high",
        actionUrl
      };
    case "enrollment_packet_expired":
      return {
        title: "Enrollment Packet Expired",
        message: `Enrollment packet link expired for ${memberLabel}. Re-send packet to continue intake.`,
        priority: "high",
        actionUrl
      };
    case "enrollment_packet_failed":
      return {
        title: "Enrollment Packet Needs Attention",
        message: `Enrollment packet workflow failed for ${memberLabel}. Review the request and intervene.`,
        priority: "high",
        actionUrl
      };
    case "pof_sent":
      return {
        title: "POF Sent",
        message: `POF sent for ${memberLabel}. Await provider signature.`,
        priority: "medium",
        actionUrl
      };
    case "pof_signed":
      return {
        title: "POF Signed",
        message: `POF signed for ${memberLabel}. Clinical documents are ready for review.`,
        priority: "high",
        actionUrl
      };
    case "pof_expiring":
      return {
        title: "POF Signature Expiring",
        message: `POF signature link is expiring for ${memberLabel}. Follow up or re-send before the request lapses.`,
        priority: "high",
        actionUrl
      };
    case "pof_failed":
      return {
        title: "POF Needs Attention",
        message: `POF workflow failed for ${memberLabel}. Review the request and intervene.`,
        priority: "high",
        actionUrl
      };
    case "intake_completed":
      return {
        title: "Intake Completed",
        message: `Intake completed for ${memberLabel}. Review assessment details and continue clinical onboarding.`,
        priority: "high",
        actionUrl
      };
    case "care_plan_created":
      return {
        title: "Care Plan Created",
        message: `Care plan created for ${memberLabel}. Review details and confirm next steps.`,
        priority: "medium",
        actionUrl
      };
    case "care_plan_reviewed":
      return {
        title: "Care Plan Reviewed",
        message: `Care plan reviewed for ${memberLabel}. Confirm updates and next review timing.`,
        priority: "medium",
        actionUrl
      };
    case "care_plan_sent":
      return {
        title: "Care Plan Sent",
        message: `Care plan signature request sent for ${memberLabel}. Track caregiver completion.`,
        priority: "medium",
        actionUrl
      };
    case "care_plan_signed":
      return {
        title: "Care Plan Signed",
        message: `Care plan signed for ${memberLabel}. Final clinical document is ready.`,
        priority: "high",
        actionUrl
      };
    case "document_uploaded":
      return {
        title: "Document Uploaded",
        message: `${documentLabel} uploaded for ${memberLabel}. Review the file and continue the workflow.`,
        priority: "medium",
        actionUrl
      };
    case "missing_required_document":
      return {
        title: "Missing Required Document",
        message: `Required documents are still missing for ${memberLabel}. Review the record and follow up.`,
        priority: "high",
        actionUrl
      };
    case "action_required":
      return {
        title: normalizeText(String(metadata.title ?? "")) ?? "Action Required",
        message:
          normalizeText(String(metadata.message ?? "")) ??
          `Action required for ${memberLabel}. Open the workflow and complete the next step.`,
        priority: normalizeNotificationPriority(String(metadata.priority ?? "")),
        actionUrl: toRelativeActionUrl(String(metadata.action_url ?? metadata.actionUrl ?? "")) ?? actionUrl
      };
    case "workflow_error":
      return {
        title: normalizeText(String(metadata.title ?? "")) ?? "Workflow Error",
        message:
          normalizeText(String(metadata.message ?? "")) ??
          `${notificationLabel(String(metadata.workflow_label ?? metadata.workflowLabel ?? ""), "Workflow")} requires intervention for ${memberLabel}.`,
        priority:
          normalizeNotificationPriority(String(metadata.priority ?? "")) === "medium"
            ? "high"
            : normalizeNotificationPriority(String(metadata.priority ?? "")),
        actionUrl: toRelativeActionUrl(String(metadata.action_url ?? metadata.actionUrl ?? "")) ?? actionUrl
      };
    case "legacy_notification":
    default:
      return {
        title: "Notification",
        message: `Operational update recorded for ${memberLabel}.`,
        priority: "medium",
        actionUrl
      };
  }
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
  const operationsRecipients = await resolveOperationsRecipients({ memberId: context.memberId });
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

async function getExistingNotificationByEventKey(eventKey: string, serviceRole = true) {
  const supabase = await createClient({ serviceRole });
  const { data, error } = await supabase.from("user_notifications").select("*").eq("event_key", eventKey).maybeSingle();
  if (error) throw new Error(mapNotificationError(error));
  return data ? toRow(data) : null;
}

export async function createNotification(input: CreateNotificationInput) {
  const recipientUserId = normalizeText(input.recipientUserId);
  const title = normalizeText(input.title);
  const message = normalizeText(input.message);
  const eventType = canonicalizeNotificationEventType(String(input.eventType)) ?? "legacy_notification";
  if (!recipientUserId) throw new Error("Notification recipient is required.");
  if (!title) throw new Error("Notification title is required.");
  if (!message) throw new Error("Notification message is required.");

  const serviceRole = input.serviceRole ?? true;
  const supabase = await createClient({ serviceRole });
  const eventKey =
    normalizeText(input.eventKey) ??
    buildNotificationEventKey({
      recipientUserId,
      eventType,
      entityType: input.entityType,
      entityId: input.entityId
    });

  const row = {
    recipient_user_id: recipientUserId,
    actor_user_id: normalizeText(input.actorUserId),
    event_type: eventType,
    entity_type: normalizeText(input.entityType),
    entity_id: normalizeText(input.entityId),
    title,
    message,
    status: input.status ?? "unread",
    priority: input.priority ?? "medium",
    read_at: input.status === "read" || input.status === "dismissed" ? toEasternISO() : null,
    action_url: toRelativeActionUrl(input.actionUrl),
    metadata: input.metadata ?? {},
    event_key: eventKey
  };

  const { data, error } = await supabase.from("user_notifications").insert(row).select("*").maybeSingle();
  if (!error && data) return toRow(data);

  if (isUniqueViolation(error)) {
    if (!input.reopenOnConflict) {
      const existing = await getExistingNotificationByEventKey(eventKey, serviceRole);
      if (existing) return existing;
    }

    const { data: reopened, error: reopenError } = await supabase
      .from("user_notifications")
      .update({
        actor_user_id: row.actor_user_id,
        event_type: row.event_type,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        title: row.title,
        message: row.message,
        status: "unread",
        priority: row.priority,
        read_at: null,
        action_url: row.action_url,
        metadata: row.metadata,
        created_at: toEasternISO()
      })
      .eq("event_key", eventKey)
      .select("*")
      .maybeSingle();
    if (reopenError) throw new Error(mapNotificationError(reopenError));
    if (reopened) return toRow(reopened);
  }

  throw new Error(mapNotificationError(error));
}

export async function createUserNotification(input: CreateUserNotificationInput) {
  return createNotification({
    recipientUserId: input.recipientUserId,
    eventType: "legacy_notification",
    title: input.title,
    message: input.message,
    entityType: input.entityType,
    entityId: input.entityId,
    priority: input.priority ?? "medium",
    actionUrl: input.actionUrl ?? null,
    metadata: input.metadata,
    serviceRole: input.serviceRole ?? true
  });
}

export async function dispatchNotification(input: DispatchNotificationEventInput) {
  const eventType = canonicalizeNotificationEventType(input.eventType ?? input.event_type ?? "");
  if (!eventType) return [] as UserNotification[];

  const entityType = input.entityType ?? input.entity_type ?? "";
  const entityId = input.entityId ?? input.entity_id ?? null;

  const actorUserId =
    normalizeText(input.actorUserId ?? input.actor_user_id) ??
    ((normalizeText(input.actorType ?? input.actor_type)?.toLowerCase() === "user"
      ? normalizeText(input.actorId ?? input.actor_id)
      : null) ?? null);

  const context = await loadWorkflowRecipientContext({
    entityType,
    entityId,
    metadata: input.metadata
  });
  const recipients = await resolveWorkflowRecipients({
    eventType,
    entityType,
    entityId,
    metadata: input.metadata,
    explicitRecipientUserIds: input.recipientUserIds
  });
  if (recipients.length === 0) return [] as UserNotification[];

  const content = buildNotificationContent(eventType, context);
  return Promise.all(
    recipients.map((recipientUserId) =>
      createNotification({
        recipientUserId,
        actorUserId,
        eventType,
        title: content.title,
        message: content.message,
        entityType,
        entityId,
        priority:
          input.severity === "critical"
            ? "critical"
            : input.severity === "high"
              ? "high"
              : content.priority,
        actionUrl:
          toRelativeActionUrl(String(input.metadata?.action_url ?? input.metadata?.actionUrl ?? "")) ?? content.actionUrl,
        metadata: {
          ...(input.metadata ?? {}),
          recipient_scope: recipientUserId,
          canonical_event_type: eventType
        },
        eventKey: buildNotificationEventKey({
          recipientUserId,
          eventType,
          entityType,
          entityId,
          suffix: input.eventKeySuffix
        }),
        reopenOnConflict: input.reopenOnConflict ?? false,
        serviceRole: true
      })
    )
  );
}

export async function listUserNotificationsForUser(
  userId: string,
  options?: { limit?: number; serviceRole?: boolean; statuses?: NotificationStatus[] }
) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) throw new Error("User ID is required.");
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));
  const supabase = await createClient({ serviceRole: options?.serviceRole });

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
  if (error && statuses.length > 0 && isMissingNotificationColumnError(error, "status")) {
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
        .map((row) => toRow(row))
        .filter((notification) => statuses.includes(notification.status));
    }
  }
  if (error) {
    console.error("[notifications] unable to list user notifications", error);
    return [] as UserNotification[];
  }
  return (data ?? []).map((row) => toRow(row));
}

export async function countUnreadUserNotificationsForUser(userId: string, options?: { serviceRole?: boolean }) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) throw new Error("User ID is required.");
  const supabase = await createClient({ serviceRole: options?.serviceRole });
  let { count, error } = await supabase
    .from("user_notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", normalizedUserId)
    .eq("status", "unread");
  if (error && isMissingNotificationColumnError(error, "status")) {
    const fallback = await supabase
      .from("user_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", normalizedUserId)
      .is("read_at", null);
    count = fallback.count;
    error = fallback.error;
  }
  if (error) {
    console.error("[notifications] unable to count unread notifications", error);
    return 0;
  }
  return Number(count ?? 0);
}

async function updateUserNotificationStatus(input: {
  notificationId: string;
  userId: string;
  status: NotificationStatus;
  actedAt: string;
  serviceRole?: boolean;
}) {
  const notificationId = normalizeText(input.notificationId);
  const userId = normalizeText(input.userId);
  if (!notificationId || !userId) throw new Error("Notification and user are required.");

  const supabase = await createClient({ serviceRole: input.serviceRole });
  let { data, error } = await supabase
    .from("user_notifications")
    .update({
      status: input.status,
      read_at: input.status === "unread" ? null : input.actedAt
    })
    .eq("id", notificationId)
    .eq("recipient_user_id", userId)
    .select("*")
    .maybeSingle();
  if (error && isMissingNotificationColumnError(error, "status")) {
    const fallback = await supabase
      .from("user_notifications")
      .update({
        read_at: input.status === "unread" ? null : input.actedAt
      })
      .eq("id", notificationId)
      .eq("recipient_user_id", userId)
      .select("*")
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
    if (!error && data) {
      const row = toRow(data);
      return {
        ...row,
        status: input.status,
        readAt: input.status === "unread" ? null : input.actedAt
      };
    }
  }
  if (error) throw new Error(mapNotificationError(error));
  return data ? toRow(data) : null;
}

export async function markUserNotificationRead(input: {
  notificationId: string;
  userId: string;
  readAt: string;
  serviceRole?: boolean;
}) {
  return updateUserNotificationStatus({
    notificationId: input.notificationId,
    userId: input.userId,
    status: "read",
    actedAt: input.readAt,
    serviceRole: input.serviceRole
  });
}

export async function dismissUserNotification(input: {
  notificationId: string;
  userId: string;
  dismissedAt: string;
  serviceRole?: boolean;
}) {
  return updateUserNotificationStatus({
    notificationId: input.notificationId,
    userId: input.userId,
    status: "dismissed",
    actedAt: input.dismissedAt,
    serviceRole: input.serviceRole
  });
}

export async function markAllUserNotificationsRead(input: {
  userId: string;
  readAt: string;
  serviceRole?: boolean;
}) {
  const userId = normalizeText(input.userId);
  if (!userId) throw new Error("User ID is required.");
  const supabase = await createClient({ serviceRole: input.serviceRole });
  let { data, error } = await supabase
    .from("user_notifications")
    .update({
      status: "read",
      read_at: input.readAt
    })
    .eq("recipient_user_id", userId)
    .eq("status", "unread")
    .select("id");
  if (error && isMissingNotificationColumnError(error, "status")) {
    const fallback = await supabase
      .from("user_notifications")
      .update({
        read_at: input.readAt
      })
      .eq("recipient_user_id", userId)
      .is("read_at", null)
      .select("id");
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw new Error(mapNotificationError(error));
  return (data ?? []).length;
}

export async function dispatchReminderNotifications(input?: {
  nowIso?: string;
  enrollmentWindowHours?: number;
  pofWindowHours?: number;
  carePlanWindowDays?: number;
}) {
  const supabase = await createClient({ serviceRole: true });
  const now = new Date(input?.nowIso ?? toEasternISO());
  const enrollmentWindowHours = Math.max(12, input?.enrollmentWindowHours ?? 48);
  const pofWindowHours = Math.max(6, input?.pofWindowHours ?? 24);
  const carePlanWindowDays = Math.max(1, input?.carePlanWindowDays ?? 7);

  const enrollmentThreshold = new Date(now.getTime() - enrollmentWindowHours * 60 * 60 * 1000).toISOString();
  const pofExpiryThreshold = new Date(now.getTime() + pofWindowHours * 60 * 60 * 1000).toISOString();
  const carePlanDueThreshold = new Date(now.getTime() + carePlanWindowDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [
    { data: pendingPackets, error: pendingPacketsError },
    { data: expiringPofs, error: expiringPofsError },
    { data: pendingCarePlans, error: pendingCarePlansError }
  ] = await Promise.all([
    supabase
      .from("enrollment_packet_requests")
      .select("id, member_id")
      .in("status", ["sent", "opened", "partially_completed"])
      .lt("created_at", enrollmentThreshold)
      .gt("token_expires_at", now.toISOString()),
    supabase
      .from("pof_requests")
      .select("id, expires_at")
      .in("status", ["sent", "opened"])
      .lte("expires_at", pofExpiryThreshold)
      .gt("expires_at", now.toISOString()),
    supabase
      .from("care_plans")
      .select("id, member_id, next_due_date")
      .lte("next_due_date", carePlanDueThreshold)
      .in("status", ["Due Soon", "Due Now", "Overdue"])
  ]);

  if (pendingPacketsError) throw new Error(pendingPacketsError.message);
  if (expiringPofsError) throw new Error(expiringPofsError.message);
  if (pendingCarePlansError) throw new Error(pendingCarePlansError.message);

  const notifications: UserNotification[] = [];

  for (const row of pendingPackets ?? []) {
    notifications.push(
      ...(await dispatchNotification({
        eventType: "action_required",
        entityType: "enrollment_packet_request",
        entityId: String(row.id),
        metadata: {
          member_id: String(row.member_id),
          title: "Enrollment Packet Follow-up Needed",
          message: "Enrollment packet is still outstanding. Follow up with the caregiver or re-send the packet.",
          action_url: `/operations/member-command-center/${row.member_id}`
        },
        eventKeySuffix: "enrollment-follow-up"
      }))
    );
  }

  for (const row of expiringPofs ?? []) {
    notifications.push(
      ...(await dispatchNotification({
        eventType: "pof_expiring",
        entityType: "pof_request",
        entityId: String(row.id),
        metadata: {
          expires_at: String(row.expires_at ?? "")
        },
        eventKeySuffix: "pof-expiring-24h"
      }))
    );
  }

  for (const row of pendingCarePlans ?? []) {
    notifications.push(
      ...(await dispatchNotification({
        eventType: "action_required",
        entityType: "care_plan",
        entityId: String(row.id),
        metadata: {
          member_id: String(row.member_id),
          title: "Care Plan Review Pending",
          message: "Care plan review is due soon or overdue. Open the care plan and complete the review.",
          action_url: `/health/care-plans/${row.id}`
        },
        eventKeySuffix: "care-plan-review-pending"
      }))
    );
  }

  return notifications;
}

export { resolveClinicalRecipients, resolveEnrollmentRecipients, resolveOperationsRecipients };
