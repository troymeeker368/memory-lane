import "server-only";

import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { toEasternISO } from "@/lib/timezone";

export const INTAKE_POST_SIGN_FOLLOW_UP_TASK_TYPES = [
  "draft_pof_creation",
  "member_file_pdf_persistence"
] as const;

export type IntakePostSignFollowUpTaskType = (typeof INTAKE_POST_SIGN_FOLLOW_UP_TASK_TYPES)[number];
export type IntakePostSignFollowUpStatus = "action_required" | "completed";

const RPC_CLAIM_INTAKE_POST_SIGN_FOLLOW_UP_TASK = "rpc_claim_intake_post_sign_follow_up_task";
const INTAKE_POST_SIGN_FOLLOW_UP_CLAIM_MIGRATION = "0128_intake_follow_up_retry_claims.sql";

type IntakePostSignFollowUpQueueRow = {
  id: string;
  assessment_id: string;
  member_id: string;
  task_type: IntakePostSignFollowUpTaskType;
  status: IntakePostSignFollowUpStatus;
  title: string;
  message: string;
  action_url: string;
  attempt_count: number;
  last_error: string | null;
  last_attempted_at: string | null;
  claimed_at: string | null;
  claimed_by_user_id: string | null;
  claimed_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type IntakePostSignFollowUpTask = {
  id: string;
  assessmentId: string;
  memberId: string;
  taskType: IntakePostSignFollowUpTaskType;
  status: IntakePostSignFollowUpStatus;
  title: string;
  message: string;
  actionUrl: string;
  attemptCount: number;
  lastError: string | null;
  lastAttemptedAt: string | null;
  claimedAt: string | null;
  claimedByUserId: string | null;
  claimedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const INTAKE_POST_SIGN_FOLLOW_UP_QUEUE_SELECT =
  "id, assessment_id, member_id, task_type, status, title, message, action_url, attempt_count, last_error, last_attempted_at, claimed_at, claimed_by_user_id, claimed_by_name, resolved_at, created_at, updated_at";
const INTAKE_POST_SIGN_FOLLOW_UP_QUEUE_UNIQUE_CONSTRAINT = "intake_post_sign_follow_up_queue_assessment_task_unique";

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function isUniqueConstraintError(error: { code?: string | null; message?: string | null; details?: string | null } | null) {
  if (!error) return false;
  if (error.code === "23505") return true;
  const message = `${error.message ?? ""} ${error.details ?? ""}`;
  return message.includes(INTAKE_POST_SIGN_FOLLOW_UP_QUEUE_UNIQUE_CONSTRAINT);
}

function mapQueueRow(row: IntakePostSignFollowUpQueueRow): IntakePostSignFollowUpTask {
  return {
    id: String(row.id),
    assessmentId: String(row.assessment_id),
    memberId: String(row.member_id),
    taskType: row.task_type,
    status: row.status,
    title: String(row.title),
    message: String(row.message),
    actionUrl: String(row.action_url),
    attemptCount: Math.max(0, Number(row.attempt_count ?? 0)),
    lastError: clean(row.last_error),
    lastAttemptedAt: clean(row.last_attempted_at),
    claimedAt: clean(row.claimed_at),
    claimedByUserId: clean(row.claimed_by_user_id),
    claimedByName: clean(row.claimed_by_name),
    resolvedAt: clean(row.resolved_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

async function loadAssessmentMemberId(assessmentId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("intake_assessments")
    .select("id, member_id")
    .eq("id", assessmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.member_id) {
    throw new Error("Intake assessment not found for post-sign follow-up.");
  }
  return String(data.member_id);
}

function buildMissingIntakePostSignClaimRpcMessage() {
  return `Intake post-sign follow-up claim RPC is not available. Apply Supabase migration ${INTAKE_POST_SIGN_FOLLOW_UP_CLAIM_MIGRATION} and refresh PostgREST schema cache.`;
}

async function loadIntakePostSignFollowUpQueueRow(input: {
  assessmentId: string;
  taskType: IntakePostSignFollowUpTaskType;
}) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("intake_post_sign_follow_up_queue")
    .select(INTAKE_POST_SIGN_FOLLOW_UP_QUEUE_SELECT)
    .eq("assessment_id", input.assessmentId)
    .eq("task_type", input.taskType)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as IntakePostSignFollowUpQueueRow | null) ?? null;
}

export async function claimIntakePostSignFollowUpTask(input: {
  assessmentId: string;
  taskType: IntakePostSignFollowUpTaskType;
  actorUserId?: string | null;
  actorName?: string | null;
  claimedAt?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(admin, RPC_CLAIM_INTAKE_POST_SIGN_FOLLOW_UP_TASK, {
      p_assessment_id: input.assessmentId,
      p_task_type: input.taskType,
      p_now: clean(input.claimedAt) ?? toEasternISO(),
      p_actor_user_id: clean(input.actorUserId),
      p_actor_name: clean(input.actorName)
    });
    const row = (Array.isArray(data) ? data[0] : null) as IntakePostSignFollowUpQueueRow | null;
    return row ? mapQueueRow(row) : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to claim intake post-sign follow-up task.";
    if (message.includes(RPC_CLAIM_INTAKE_POST_SIGN_FOLLOW_UP_TASK)) {
      throw new Error(buildMissingIntakePostSignClaimRpcMessage());
    }
    throw error;
  }
}

export async function releaseIntakePostSignFollowUpTaskClaim(input: {
  assessmentId: string;
  taskType: IntakePostSignFollowUpTaskType;
  updatedAt?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const existing = await loadIntakePostSignFollowUpQueueRow({
    assessmentId: input.assessmentId,
    taskType: input.taskType
  });
  if (!existing || existing.status !== "action_required") {
    return existing ? mapQueueRow(existing) : null;
  }

  const { data, error } = await admin
    .from("intake_post_sign_follow_up_queue")
    .update({
      claimed_at: null,
      claimed_by_user_id: null,
      claimed_by_name: null,
      updated_at: clean(input.updatedAt) ?? toEasternISO()
    })
    .eq("id", existing.id)
    .select(INTAKE_POST_SIGN_FOLLOW_UP_QUEUE_SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapQueueRow(data as IntakePostSignFollowUpQueueRow) : null;
}

function buildTaskPresentation(taskType: IntakePostSignFollowUpTaskType, assessmentId: string) {
  if (taskType === "draft_pof_creation") {
    return {
      title: "Draft POF Follow-up Needed",
      message:
        "The intake assessment was signed, but draft POF creation did not complete. Retry draft POF creation before treating clinical onboarding as complete.",
      actionUrl: `/health/assessment/${assessmentId}`,
      alertKey: "intake_draft_pof_follow_up_required"
    } as const;
  }

  return {
    title: "Intake PDF Save Follow-up Needed",
    message:
      "The intake assessment was signed, but its PDF did not save to Member Files. Re-generate the intake PDF and save it before treating documentation as complete.",
    actionUrl: `/health/assessment/${assessmentId}`,
    alertKey: "intake_pdf_member_file_follow_up_required"
  } as const;
}

export async function listIntakePostSignFollowUpTasks(input: {
  assessmentId: string;
  includeCompleted?: boolean;
}) {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("intake_post_sign_follow_up_queue")
    .select(INTAKE_POST_SIGN_FOLLOW_UP_QUEUE_SELECT)
    .eq("assessment_id", input.assessmentId)
    .order("created_at", { ascending: true });

  if (!input.includeCompleted) {
    query = query.eq("status", "action_required");
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as IntakePostSignFollowUpQueueRow[]).map(mapQueueRow);
}

export async function listIntakePostSignFollowUpTasksByAssessmentIds(input: {
  assessmentIds: string[];
  includeCompleted?: boolean;
}) {
  const assessmentIds = Array.from(new Set(input.assessmentIds.map((value) => String(value ?? "").trim()).filter(Boolean)));
  if (assessmentIds.length === 0) {
    return new Map<string, IntakePostSignFollowUpTask[]>();
  }

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("intake_post_sign_follow_up_queue")
    .select(INTAKE_POST_SIGN_FOLLOW_UP_QUEUE_SELECT)
    .in("assessment_id", assessmentIds)
    .order("created_at", { ascending: true });

  if (!input.includeCompleted) {
    query = query.eq("status", "action_required");
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as IntakePostSignFollowUpQueueRow[]).map(mapQueueRow);
  const tasksByAssessmentId = new Map<string, IntakePostSignFollowUpTask[]>();
  assessmentIds.forEach((assessmentId) => {
    tasksByAssessmentId.set(assessmentId, []);
  });
  rows.forEach((row) => {
    const existing = tasksByAssessmentId.get(row.assessmentId) ?? [];
    existing.push(row);
    tasksByAssessmentId.set(row.assessmentId, existing);
  });
  return tasksByAssessmentId;
}

export async function queueIntakePostSignFollowUpTask(input: {
  assessmentId: string;
  memberId: string;
  taskType: IntakePostSignFollowUpTaskType;
  actorUserId?: string | null;
  actorName?: string | null;
  errorMessage: string;
  titleOverride?: string | null;
  messageOverride?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const now = toEasternISO();
  const canonicalMemberId = await loadAssessmentMemberId(input.assessmentId);
  const requestedMemberId = clean(input.memberId);
  if (requestedMemberId && requestedMemberId !== canonicalMemberId) {
    throw new Error("Intake post-sign follow-up member_id does not match the canonical intake assessment member.");
  }
  const actorUserId = clean(input.actorUserId);
  const actorName = clean(input.actorName);
  const errorMessage = clean(input.errorMessage) ?? "Unknown follow-up failure.";
  const defaultPresentation = buildTaskPresentation(input.taskType, input.assessmentId);
  const presentation = {
    ...defaultPresentation,
    title: clean(input.titleOverride) ?? defaultPresentation.title,
    message: clean(input.messageOverride) ?? defaultPresentation.message
  };
  let attemptCount = 1;

  const rowPatch = {
    member_id: canonicalMemberId,
    task_type: input.taskType,
    status: "action_required" as const,
    title: presentation.title,
    message: presentation.message,
    action_url: presentation.actionUrl,
    attempt_count: attemptCount,
    last_error: errorMessage,
    last_attempted_at: now,
    claimed_at: null,
    claimed_by_user_id: null,
    claimed_by_name: null,
    resolved_at: null,
    updated_by_user_id: actorUserId,
    updated_by_name: actorName,
    updated_at: now
  };

  let savedRow: IntakePostSignFollowUpQueueRow | null = null;
  const { data: insertedRow, error: insertError } = await admin
    .from("intake_post_sign_follow_up_queue")
    .insert({
      assessment_id: input.assessmentId,
      created_by_user_id: actorUserId,
      created_by_name: actorName,
      created_at: now,
      ...rowPatch
    })
    .select(INTAKE_POST_SIGN_FOLLOW_UP_QUEUE_SELECT)
    .maybeSingle();

  if (!insertError) {
    savedRow = (insertedRow as IntakePostSignFollowUpQueueRow | null) ?? null;
  } else if (isUniqueConstraintError(insertError)) {
    const existing = await loadIntakePostSignFollowUpQueueRow({
      assessmentId: input.assessmentId,
      taskType: input.taskType
    });
    if (!existing) {
      throw new Error(
        "Intake post-sign follow-up queue conflict was detected, but the canonical queue row could not be reloaded."
      );
    }

    attemptCount = Math.max(0, Number(existing.attempt_count ?? 0)) + 1;
    const { data, error } = await admin
      .from("intake_post_sign_follow_up_queue")
      .update({
        ...rowPatch,
        attempt_count: attemptCount
      })
      .eq("id", existing.id)
      .select(INTAKE_POST_SIGN_FOLLOW_UP_QUEUE_SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    savedRow = (data as IntakePostSignFollowUpQueueRow | null) ?? null;
  } else {
    throw new Error(insertError.message);
  }

  attemptCount = Math.max(0, Number(savedRow?.attempt_count ?? attemptCount));

  await recordWorkflowEvent({
    eventType: "intake_post_sign_follow_up_queued",
    entityType: "intake_assessment",
    entityId: input.assessmentId,
    actorType: actorUserId ? "user" : "system",
    actorUserId,
    status: "action_required",
    severity: "high",
    metadata: {
      member_id: canonicalMemberId,
      follow_up_task_type: input.taskType,
      attempt_count: attemptCount,
      action_url: presentation.actionUrl,
      error: errorMessage
    }
  });

  try {
    await recordWorkflowMilestone({
      event: {
        eventType: "action_required",
        entityType: "intake_assessment",
        entityId: input.assessmentId,
        actorType: actorUserId ? "user" : "system",
        actorUserId,
        status: "open",
        severity: "high",
        eventKeySuffix: `intake-post-sign-${input.taskType}`,
        reopenOnConflict: true,
        metadata: {
          member_id: canonicalMemberId,
          follow_up_task_type: input.taskType,
          attempt_count: attemptCount,
          title: presentation.title,
          message: presentation.message,
          priority: "high",
          action_url: presentation.actionUrl
        }
      }
    });
  } catch (milestoneError) {
    console.error("[intake-post-sign-follow-up] unable to emit action-required milestone", milestoneError);
  }

  await recordImmediateSystemAlert({
    entityType: "intake_assessment",
    entityId: input.assessmentId,
    actorUserId,
    severity: "high",
    alertKey: presentation.alertKey,
    metadata: {
      member_id: canonicalMemberId,
      follow_up_task_type: input.taskType,
      attempt_count: attemptCount,
      action_url: presentation.actionUrl,
      error: errorMessage
    }
  });

  return savedRow ? mapQueueRow(savedRow) : null;
}

export async function resolveIntakePostSignFollowUpTask(input: {
  assessmentId: string;
  taskType: IntakePostSignFollowUpTaskType;
  actorUserId?: string | null;
  actorName?: string | null;
  resolutionNote?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const now = toEasternISO();
  const actorUserId = clean(input.actorUserId);
  const actorName = clean(input.actorName);
  const resolutionNote = clean(input.resolutionNote);
  const existing = await loadIntakePostSignFollowUpQueueRow({
    assessmentId: input.assessmentId,
    taskType: input.taskType
  });
  if (!existing) return null;
  if (existing.status === "completed") {
    return mapQueueRow(existing);
  }

  const { data: saved, error: savedError } = await admin
    .from("intake_post_sign_follow_up_queue")
    .update({
      status: "completed",
      last_error: null,
      claimed_at: null,
      claimed_by_user_id: null,
      claimed_by_name: null,
      resolved_at: now,
      updated_by_user_id: actorUserId,
      updated_by_name: actorName,
      updated_at: now
    })
    .eq("id", existing.id)
    .select(INTAKE_POST_SIGN_FOLLOW_UP_QUEUE_SELECT)
    .maybeSingle();
  if (savedError) throw new Error(savedError.message);

  const memberId = clean(existing.member_id);
  await recordWorkflowEvent({
    eventType: "intake_post_sign_follow_up_completed",
    entityType: "intake_assessment",
    entityId: input.assessmentId,
    actorType: actorUserId ? "user" : "system",
    actorUserId,
    status: "completed",
    severity: "low",
    metadata: {
      member_id: memberId,
      follow_up_task_type: input.taskType,
      resolution_note: resolutionNote
    }
  });

  const dismissResult = await admin
    .from("user_notifications")
    .update({
      status: "dismissed",
      read_at: now
    })
    .eq("event_type", "action_required")
    .eq("entity_type", "intake_assessment")
    .eq("entity_id", input.assessmentId)
    .contains("metadata", { follow_up_task_type: input.taskType });
  if (dismissResult.error) {
    console.error("[intake-post-sign-follow-up] unable to dismiss resolved notifications", dismissResult.error);
  }

  return saved ? mapQueueRow(saved as IntakePostSignFollowUpQueueRow) : null;
}
