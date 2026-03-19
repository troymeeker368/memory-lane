import type {
  JsonValue,
  NotificationContent,
  NotificationEventType,
  NotificationPriority,
  WorkflowRecipientContext
} from "@/lib/services/notification-types";

export function normalizeText(value: string | null | undefined) {
  const cleaned = (value ?? "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function normalizeNotificationPriority(value: string | null | undefined): NotificationPriority {
  if (value === "low" || value === "high" || value === "critical") return value;
  return "medium";
}

function notificationLabel(value: string | null | undefined, fallback = "this workflow") {
  return normalizeText(value) ?? fallback;
}

function toRelativeActionUrl(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized.startsWith("/") ? normalized : `/${normalized.replace(/^\/+/, "")}`;
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

export function buildNotificationContent(eventType: NotificationEventType, context: WorkflowRecipientContext): NotificationContent {
  const memberLabel = notificationLabel(context.memberName, "this member");
  const actionUrl = buildDefaultActionUrl(context);
  const metadata = context.metadata as Record<string, JsonValue>;
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
