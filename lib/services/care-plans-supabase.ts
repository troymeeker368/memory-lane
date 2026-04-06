import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { toEasternISO } from "@/lib/timezone";
import {
  buildNormalizedSectionsForTrack,
  computeCarePlanStatus,
  computeNextReviewDueDate,
  serializeSectionsSnapshot
} from "@/lib/services/care-plan-model";
import { getCarePlanById, getCarePlanDispatchState } from "@/lib/services/care-plans-read-model";
import { getDefaultCaregiverSignatureExpiresOnDate } from "@/lib/services/care-plan-esign-rules";
import { recordImmediateSystemAlert, recordWorkflowEvent } from "@/lib/services/workflow-observability";
import type {
  CarePlanSectionInput,
  CarePlanPostSignReadinessStatus,
  CarePlanStatus,
} from "@/lib/services/care-plan-types";
import {
  type CarePlanSectionType,
  type CarePlanTrack,
  isCarePlanTrack
} from "@/lib/services/care-plan-track-definitions";

const CARE_PLAN_CORE_RPC = "rpc_upsert_care_plan_core";
const CARE_PLAN_CORE_RPC_MIGRATION = "0085_care_plan_diagnosis_relation.sql";
const CARE_PLAN_SNAPSHOT_RPC = "rpc_record_care_plan_snapshot";
const CARE_PLAN_SNAPSHOT_RPC_MIGRATION = "0054_care_plan_snapshot_atomicity.sql";

type CarePlanCoreRpcRow = {
  care_plan_id: string;
  was_created: boolean;
};

type CarePlanSnapshotRpcRow = {
  version_id: string;
  version_number: number;
};

type CarePlanWorkflowError = Error & {
  carePlanId?: string;
  partiallyCommitted?: boolean;
};

type CarePlanWriteResult = {
  id: string;
  memberId: string;
  caregiverSignatureStatus: string;
  postSignReadinessStatus: CarePlanPostSignReadinessStatus;
};

function buildCarePlanWorkflowError(message: string, carePlanId: string) {
  const error = new Error(message) as CarePlanWorkflowError;
  error.carePlanId = carePlanId;
  error.partiallyCommitted = true;
  return error;
}

async function recordCarePlanActionRequired(input: {
  carePlanId: string;
  memberId: string;
  actorUserId: string;
  alertKey: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  const actionUrl = `/health/care-plans/${input.carePlanId}`;
  try {
    await recordImmediateSystemAlert({
      entityType: "care_plan",
      entityId: input.carePlanId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: input.alertKey,
      metadata: {
        member_id: input.memberId,
        title: input.title,
        message: input.message,
        action_url: actionUrl,
        ...(input.metadata ?? {})
      }
    });
  } catch (error) {
    console.error("[care-plans] unable to persist action-required alert", error);
  }

  try {
    const recordWorkflowMilestone = await loadWorkflowMilestoneRecorder();
    await recordWorkflowMilestone({
      event: {
        eventType: "action_required",
        entityType: "care_plan",
        entityId: input.carePlanId,
        actorType: "user",
        actorUserId: input.actorUserId,
        status: "open",
        severity: "high",
        metadata: {
          member_id: input.memberId,
          title: input.title,
          message: input.message,
          priority: "high",
          action_url: actionUrl,
          ...(input.metadata ?? {})
        }
      }
    });
  } catch (error) {
    console.error("[care-plans] unable to emit action-required follow-up", error);
  }
}

export async function setCarePlanPostSignReadiness(input: {
  carePlanId: string;
  status: CarePlanPostSignReadinessStatus;
  reason?: string | null;
  actor: { id: string; fullName: string };
}) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("care_plans")
    .update({
      post_sign_readiness_status: input.status,
      post_sign_readiness_reason: clean(input.reason) ?? null,
      updated_by_user_id: input.actor.id,
      updated_by_name: input.actor.fullName,
      updated_at: toEasternISO()
    })
    .eq("id", input.carePlanId);
  if (error) throw new Error(error.message);
}

export async function markCarePlanPostSignReady(input: {
  carePlanId: string;
  actor: { id: string; fullName: string };
}) {
  return setCarePlanPostSignReadiness({
    carePlanId: input.carePlanId,
    status: "ready",
    reason: null,
    actor: input.actor
  });
}

async function loadCarePlanNurseEsignService() {
  return import("@/lib/services/care-plan-nurse-esign");
}

async function loadWorkflowMilestoneRecorder() {
  const { recordWorkflowMilestone } = await import("@/lib/services/lifecycle-milestones");
  return recordWorkflowMilestone;
}

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function assertCarePlanTrack(value: string | null | undefined): CarePlanTrack {
  if (isCarePlanTrack(value)) return value;
  throw new Error(`Invalid care plan track value: ${value ?? "(null)"}`);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeDiagnosisIds(values: string[] | null | undefined) {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => clean(value))
        .filter((value): value is string => value !== null && UUID_PATTERN.test(value))
    )
  ];
}

function isPostgresUniqueViolation(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const text = [error?.message, error?.details].filter(Boolean).join(" ").toLowerCase();
  return error?.code === "23505" || text.includes("duplicate key value") || text.includes("unique constraint");
}

function isCarePlanRootUniqueViolation(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const text = [error?.message, error?.details].filter(Boolean).join(" ").toLowerCase();
  return isPostgresUniqueViolation(error) && text.includes("idx_care_plans_member_track_unique");
}

async function createCarePlanVersionSnapshot(input: {
  carePlanId: string;
  snapshotType: "initial" | "review";
  snapshotDate: string;
  reviewedBy: string | null;
  status: CarePlanStatus;
  nextDueDate: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  careTeamNotes: string;
  sections: Array<{
    sectionType: CarePlanSectionType;
    shortTermGoals: string;
    longTermGoals: string;
    displayOrder: number;
  }>;
  reviewHistory?: {
    reviewDate: string;
    reviewedBy: string | null;
    summary: string;
    changesMade: boolean;
  } | null;
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: Boolean(input.serviceRole) });
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, CARE_PLAN_SNAPSHOT_RPC, {
      p_care_plan_id: input.carePlanId,
      p_snapshot_type: input.snapshotType,
      p_snapshot_date: input.snapshotDate,
      p_reviewed_by: input.reviewedBy,
      p_status: input.status,
      p_next_due_date: input.nextDueDate,
      p_no_changes_needed: input.noChangesNeeded,
      p_modifications_required: input.modificationsRequired,
      p_modifications_description: input.modificationsDescription,
      p_care_team_notes: input.careTeamNotes,
      p_sections_snapshot: serializeSectionsSnapshot(input.sections),
      p_review_date: input.reviewHistory?.reviewDate ?? null,
      p_review_summary: input.reviewHistory?.summary ?? null,
      p_review_changes_made: input.reviewHistory?.changesMade ?? null
    });
    const row = (Array.isArray(data) ? data[0] : null) as CarePlanSnapshotRpcRow | null;
    if (!row?.version_id) {
      throw new Error("Care plan snapshot RPC did not return a version id.");
    }
    return {
      versionId: String(row.version_id),
      versionNumber: Number(row.version_number ?? 0)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save care plan version snapshot.";
    if (message.includes(CARE_PLAN_SNAPSHOT_RPC)) {
      throw new Error(
        `Care plan snapshot RPC is not available. Apply Supabase migration ${CARE_PLAN_SNAPSHOT_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

async function upsertCarePlanCore(input: {
  carePlanId?: string | null;
  memberId: string;
  track: CarePlanTrack;
  enrollmentDate: string;
  reviewDate: string;
  lastCompletedDate: string;
  nextDueDate: string;
  status: CarePlanStatus;
  careTeamNotes: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  caregiverName?: string | null;
  caregiverEmail?: string | null;
  actor: { id: string; fullName: string };
  now: string;
  diagnosisIds?: string[];
  sections: Array<{
    sectionType: CarePlanSectionType;
    shortTermGoals: string;
    longTermGoals: string;
    displayOrder: number;
  }>;
}) {
  const supabase = await createClient();
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, CARE_PLAN_CORE_RPC, {
      p_care_plan_id: input.carePlanId ?? null,
      p_member_id: input.memberId,
      p_track: input.track,
      p_enrollment_date: input.enrollmentDate,
      p_review_date: input.reviewDate,
      p_last_completed_date: input.lastCompletedDate,
      p_next_due_date: input.nextDueDate,
      p_status: input.status,
      p_care_team_notes: input.careTeamNotes,
      p_no_changes_needed: input.noChangesNeeded,
      p_modifications_required: input.modificationsRequired,
      p_modifications_description: input.modificationsDescription,
      p_caregiver_name: input.caregiverName ?? null,
      p_caregiver_email: input.caregiverEmail ?? null,
      p_actor_user_id: input.actor.id,
      p_actor_name: input.actor.fullName,
      p_now: input.now,
      p_diagnosis_ids: normalizeDiagnosisIds(input.diagnosisIds),
      p_sections: serializeSectionsSnapshot(input.sections)
    });
    const row = (Array.isArray(data) ? data[0] : null) as CarePlanCoreRpcRow | null;
    if (!row?.care_plan_id) {
      throw new Error("Care plan core RPC did not return a care plan id.");
    }
    return {
      carePlanId: String(row.care_plan_id),
      wasCreated: Boolean(row.was_created)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save care plan core.";
    if (message.includes(CARE_PLAN_CORE_RPC)) {
      throw new Error(
        `Care plan core RPC is not available. Apply Supabase migration ${CARE_PLAN_CORE_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

async function findCarePlanRootByMemberTrack(memberId: string, track: CarePlanTrack, serviceRole = false) {
  const supabase = await createClient({ serviceRole });
  const { data, error } = await supabase
    .from("care_plans")
    .select("id")
    .eq("member_id", memberId)
    .eq("track", track)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? String(data.id) : null;
}

function sanitizeCaregiverName(value: string | null | undefined) {
  return clean(value);
}

function sanitizeCaregiverEmail(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Caregiver email is invalid.");
  return normalized.toLowerCase();
}

async function finalizeCaregiverDispatchAfterNurseSignature(input: {
  carePlanId: string;
  actor: { id: string; fullName: string; signatureName: string };
}): Promise<CarePlanWriteResult> {
  const signedCarePlan = await getCarePlanDispatchState(input.carePlanId);
  if (!signedCarePlan) throw new Error("Care plan could not be loaded after nurse/admin signature.");

  const hasCaregiverContact = Boolean(signedCarePlan.caregiverName) && Boolean(signedCarePlan.caregiverEmail);
  const shouldAutoSend = hasCaregiverContact && signedCarePlan.caregiverSignatureStatus !== "signed";

  await setCarePlanPostSignReadiness({
    carePlanId: input.carePlanId,
    status: shouldAutoSend ? "signed_pending_caregiver_dispatch" : "ready",
    reason: shouldAutoSend ? "Caregiver dispatch still needs to complete." : null,
    actor: {
      id: input.actor.id,
      fullName: input.actor.fullName
    }
  });

  if (shouldAutoSend && signedCarePlan.caregiverName && signedCarePlan.caregiverEmail) {
    const { sendCarePlanToCaregiverForSignature } = await import("@/lib/services/care-plan-esign");
    const sent = await sendCarePlanToCaregiverForSignature({
      carePlanId: signedCarePlan.id,
      caregiverName: signedCarePlan.caregiverName,
      caregiverEmail: signedCarePlan.caregiverEmail,
      optionalMessage: null,
      expiresOnDate: getDefaultCaregiverSignatureExpiresOnDate(),
      actor: {
        id: input.actor.id,
        fullName: input.actor.fullName,
        signatureName: input.actor.signatureName
      }
    });
    await markCarePlanPostSignReady({
      carePlanId: signedCarePlan.id,
      actor: {
        id: input.actor.id,
        fullName: input.actor.fullName
      }
    });
    return {
      id: sent.id,
      memberId: sent.memberId,
      caregiverSignatureStatus: sent.caregiverSignatureStatus,
      postSignReadinessStatus: "ready"
    };
  }

  const supabase = await createClient();
  const touchedAt = toEasternISO();
  const { error: touchError } = await supabase
    .from("care_plans")
    .update({
      updated_by_user_id: input.actor.id,
      updated_by_name: input.actor.fullName,
      updated_at: touchedAt
    })
    .eq("id", input.carePlanId);
  if (touchError) throw new Error(touchError.message);

  return {
    id: signedCarePlan.id,
    memberId: signedCarePlan.memberId,
    caregiverSignatureStatus: signedCarePlan.caregiverSignatureStatus,
    postSignReadinessStatus: "ready"
  };
}

async function completeCarePlanNurseSignatureWorkflow(input: {
  carePlanId: string;
  memberId: string;
  reviewDate: string;
  nextDueDate: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  careTeamNotes: string;
  sections: Array<{
    sectionType: CarePlanSectionType;
    shortTermGoals: string;
    longTermGoals: string;
    displayOrder: number;
  }>;
  snapshotType: "initial" | "review";
  reviewHistory?: {
    reviewDate: string;
    reviewedBy: string | null;
    summary: string;
    changesMade: boolean;
  } | null;
  actor: { id: string; fullName: string; signatureName: string };
  signedByName: string | null;
}) {
  await setCarePlanPostSignReadiness({
    carePlanId: input.carePlanId,
    status: "signed_pending_snapshot",
    reason:
      input.snapshotType === "initial"
        ? "Version snapshot persistence still needs to complete."
        : "Version and review history persistence still needs to complete.",
    actor: {
      id: input.actor.id,
      fullName: input.actor.fullName
    }
  });

  try {
    await createCarePlanVersionSnapshot({
      carePlanId: input.carePlanId,
      snapshotType: input.snapshotType,
      snapshotDate: input.reviewDate,
      reviewedBy: input.signedByName ?? input.actor.signatureName,
      status: computeCarePlanStatus(input.nextDueDate),
      nextDueDate: input.nextDueDate,
      noChangesNeeded: input.noChangesNeeded,
      modificationsRequired: input.modificationsRequired,
      modificationsDescription: input.modificationsDescription,
      careTeamNotes: input.careTeamNotes,
      sections: input.sections,
      reviewHistory: input.reviewHistory ?? null
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : input.snapshotType === "initial"
          ? "Unable to persist care plan version snapshot."
          : "Unable to persist care plan review history.";
    await recordCarePlanActionRequired({
      carePlanId: input.carePlanId,
      memberId: input.memberId,
      actorUserId: input.actor.id,
      alertKey:
        input.snapshotType === "initial"
          ? "care_plan_snapshot_follow_up_required"
          : "care_plan_review_history_follow_up_required",
      title:
        input.snapshotType === "initial"
          ? "Care Plan Version History Repair Needed"
          : "Care Plan Review History Repair Needed",
      message:
        input.snapshotType === "initial"
          ? "The care plan was created and signed, but version history persistence still needs repair."
          : "The care plan review was signed, but version and review history still need repair.",
      metadata: {
        phase: input.snapshotType === "initial" ? "create_snapshot" : "review_snapshot",
        review_date: input.reviewDate,
        next_due_date: input.nextDueDate,
        error: message
      }
    });
    throw buildCarePlanWorkflowError(
      input.snapshotType === "initial"
        ? `Care Plan was created and signed, but version history persistence failed (${message}). Open the saved care plan before retrying downstream actions.`
        : `Care Plan review was saved and signed, but version/review history persistence failed (${message}). Open the saved care plan before retrying downstream actions.`,
      input.carePlanId
    );
  }

  let finalizedCarePlan: CarePlanWriteResult;
  try {
    finalizedCarePlan = await finalizeCaregiverDispatchAfterNurseSignature({
      carePlanId: input.carePlanId,
      actor: input.actor
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete caregiver dispatch.";
    await recordCarePlanActionRequired({
      carePlanId: input.carePlanId,
      memberId: input.memberId,
      actorUserId: input.actor.id,
      alertKey: "care_plan_caregiver_dispatch_follow_up_required",
      title: "Care Plan Caregiver Send Retry Needed",
      message:
        input.snapshotType === "initial"
          ? "The care plan was created and signed, but caregiver dispatch still needs follow-up."
          : "The care plan review was signed, but caregiver dispatch still needs follow-up.",
      metadata: {
        phase: input.snapshotType === "initial" ? "create_caregiver_dispatch" : "review_caregiver_dispatch",
        review_date: input.reviewDate,
        next_due_date: input.nextDueDate,
        error: message
      }
    });
    throw buildCarePlanWorkflowError(
      input.snapshotType === "initial"
        ? `Care Plan was created and signed, but caregiver dispatch failed (${message}). Open the saved care plan to retry sending the caregiver link.`
        : `Care Plan review was signed, but caregiver dispatch failed (${message}). Open the saved care plan to retry sending the caregiver link.`,
      input.carePlanId
    );
  }

  const alignedState = await getCarePlanDispatchState(input.carePlanId);
  if (!alignedState) {
    throw buildCarePlanWorkflowError(
      "Care Plan signed follow-up could not verify the final saved state. Open the saved care plan before continuing.",
      input.carePlanId
    );
  }

  const requiresCaregiverDispatch = Boolean(alignedState.caregiverName) && Boolean(alignedState.caregiverEmail);
  const caregiverDispatchAligned = requiresCaregiverDispatch
    ? ["sent", "viewed", "signed"].includes(alignedState.caregiverSignatureStatus)
    : true;
  if (!caregiverDispatchAligned) {
    await recordCarePlanActionRequired({
      carePlanId: input.carePlanId,
      memberId: input.memberId,
      actorUserId: input.actor.id,
      alertKey: "care_plan_caregiver_dispatch_alignment_required",
      title: "Care Plan Caregiver Dispatch Repair Needed",
      message: "The care plan signed successfully, but caregiver dispatch did not land in the expected canonical state.",
      metadata: {
        phase: "dispatch_alignment",
        caregiver_signature_status: alignedState.caregiverSignatureStatus,
        review_date: input.reviewDate,
        next_due_date: input.nextDueDate
      }
    });
    throw buildCarePlanWorkflowError(
      "Care Plan signed successfully, but caregiver dispatch did not reach the expected canonical state. Open the saved care plan before continuing.",
      input.carePlanId
    );
  }

  return finalizedCarePlan;
}

async function assertCarePlanWriteBoundaryAligned(input: {
  carePlanId: string;
  memberId: string;
  expectedCaregiverStatus?: string | null;
}) {
  const detail = await getCarePlanById(input.carePlanId, { serviceRole: true });
  if (!detail) {
    throw new Error("Care plan could not be reloaded after post-sign workflow completion.");
  }
  if (detail.carePlan.memberId !== input.memberId) {
    throw new Error("Care plan post-sign workflow reloaded against the wrong member.");
  }
  if (detail.versions.length === 0) {
    throw new Error("Care plan version history did not persist.");
  }
  if (detail.carePlan.postSignReadinessStatus !== "ready") {
    throw new Error("Care plan post-sign readiness did not finalize to ready.");
  }
  if (
    clean(input.expectedCaregiverStatus) &&
    detail.carePlan.caregiverSignatureStatus !== clean(input.expectedCaregiverStatus)
  ) {
    throw new Error(
      `Care plan caregiver dispatch drifted. Expected ${input.expectedCaregiverStatus}, found ${detail.carePlan.caregiverSignatureStatus}.`
    );
  }
  return detail;
}

export async function createCarePlan(input: {
  memberId: string;
  track: CarePlanTrack;
  diagnosisIds?: string[];
  sections: CarePlanSectionInput[];
  enrollmentDate: string;
  reviewDate: string;
  careTeamNotes: string;
  noChangesNeeded?: boolean;
  modificationsRequired?: boolean;
  modificationsDescription?: string;
  caregiverName?: string | null;
  caregiverEmail?: string | null;
  signatureAttested: boolean;
  signatureImageDataUrl: string;
  actor: { id: string; fullName: string; signatureName: string; role: string };
}) {
  const canonicalMemberId = await resolveCanonicalMemberId(input.memberId, {
    actionLabel: "createCarePlan"
  });
  const existingCarePlanId = await findCarePlanRootByMemberTrack(canonicalMemberId, input.track);
  if (existingCarePlanId) {
    throw new Error("A care plan already exists for this member and track. Review the existing plan instead of creating a new root record.");
  }
  const now = toEasternISO();
  const completionDate = input.reviewDate;
  const nextDueDate = computeNextReviewDueDate(completionDate);
  const normalizedSections = buildNormalizedSectionsForTrack(input.track, input.sections);
  const caregiverName = sanitizeCaregiverName(input.caregiverName);
  const caregiverEmail = sanitizeCaregiverEmail(input.caregiverEmail);
  let createdCarePlanId: string;
  const { signCarePlanNurseEsign } = await loadCarePlanNurseEsignService();
  try {
    const saved = await upsertCarePlanCore({
      memberId: canonicalMemberId,
      track: input.track,
      enrollmentDate: input.enrollmentDate,
      reviewDate: input.reviewDate,
      lastCompletedDate: completionDate,
      nextDueDate,
      status: computeCarePlanStatus(nextDueDate),
      careTeamNotes: input.careTeamNotes,
      noChangesNeeded: Boolean(input.noChangesNeeded),
      modificationsRequired: Boolean(input.modificationsRequired),
      modificationsDescription: input.modificationsDescription ?? "",
      caregiverName,
      caregiverEmail,
      actor: {
        id: input.actor.id,
        fullName: input.actor.fullName
      },
      now,
      diagnosisIds: input.diagnosisIds,
      sections: normalizedSections
    });
    createdCarePlanId = saved.carePlanId;
  } catch (error) {
    if (
      isCarePlanRootUniqueViolation(
        error as { code?: string | null; message?: string | null; details?: string | null } | null | undefined
      )
    ) {
      throw new Error("A care plan already exists for this member and track. Review the existing plan instead of creating a new root record.");
    }
    throw error;
  }

  let signedState: Awaited<ReturnType<typeof signCarePlanNurseEsign>>;
  try {
    signedState = await signCarePlanNurseEsign({
      carePlanId: createdCarePlanId,
      actor: {
        id: input.actor.id,
        fullName: input.actor.fullName,
        role: input.actor.role,
        signoffName: input.actor.signatureName
      },
      attested: input.signatureAttested,
      signatureImageDataUrl: input.signatureImageDataUrl,
      metadata: {
        module: "care-plan",
        signedFrom: "createCarePlan"
      }
    });
  } catch (error) {
    const signError = error instanceof Error ? error.message : "Unknown signature persistence error.";
    throw buildCarePlanWorkflowError(
      `Care Plan was created, but nurse/admin e-signature finalization failed (${signError}). Open the saved care plan and retry signing.`,
      createdCarePlanId
    );
  }

  const finalizedCarePlan = await completeCarePlanNurseSignatureWorkflow({
    carePlanId: createdCarePlanId,
    memberId: canonicalMemberId,
    reviewDate: input.reviewDate,
    nextDueDate,
    noChangesNeeded: Boolean(input.noChangesNeeded),
    modificationsRequired: Boolean(input.modificationsRequired),
    modificationsDescription: input.modificationsDescription ?? "",
    careTeamNotes: input.careTeamNotes,
    sections: normalizedSections,
    snapshotType: "initial",
    actor: {
      id: input.actor.id,
      fullName: input.actor.fullName,
      signatureName: input.actor.signatureName
    },
    signedByName: signedState.signedByName ?? input.actor.signatureName
  });

  await assertCarePlanWriteBoundaryAligned({
    carePlanId: createdCarePlanId,
    memberId: canonicalMemberId,
    expectedCaregiverStatus: finalizedCarePlan.caregiverSignatureStatus
  });

  await recordWorkflowEvent({
    eventType: "care_plan_created",
    entityType: "care_plan",
    entityId: createdCarePlanId,
    actorType: "user",
    actorUserId: input.actor.id,
    status: "created",
    severity: "low",
    metadata: {
      member_id: canonicalMemberId,
      track: input.track,
      review_date: input.reviewDate,
      next_due_date: nextDueDate
    }
  });
  const recordWorkflowMilestone = await loadWorkflowMilestoneRecorder();
  await recordWorkflowMilestone({
    event: {
      eventType: "care_plan_created",
      entityType: "care_plan",
      entityId: createdCarePlanId,
      actorType: "user",
      actorUserId: input.actor.id,
      status: "created",
      severity: "low",
      metadata: {
        member_id: canonicalMemberId,
        track: input.track,
        review_date: input.reviewDate,
        next_due_date: nextDueDate
      }
    }
  });

  return finalizedCarePlan;
}

export async function reviewCarePlan(input: {
  carePlanId: string;
  reviewDate: string;
  diagnosisIds?: string[];
  sections: CarePlanSectionInput[];
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  careTeamNotes: string;
  caregiverName?: string | null;
  caregiverEmail?: string | null;
  signatureAttested: boolean;
  signatureImageDataUrl: string;
  actor: { id: string; fullName: string; signatureName: string; role: string };
}) {
  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("care_plans")
    .select("id, member_id, track, enrollment_date")
    .eq("id", input.carePlanId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new Error("Care plan not found.");

  const track = assertCarePlanTrack(existing.track);
  const normalizedSections = buildNormalizedSectionsForTrack(track, input.sections);
  const now = toEasternISO();
  const nextDueDate = computeNextReviewDueDate(input.reviewDate);
  const caregiverName = sanitizeCaregiverName(input.caregiverName);
  const caregiverEmail = sanitizeCaregiverEmail(input.caregiverEmail);
  const { signCarePlanNurseEsign } = await loadCarePlanNurseEsignService();
  await upsertCarePlanCore({
    carePlanId: input.carePlanId,
    memberId: String(existing.member_id),
    track,
    enrollmentDate: String(existing.enrollment_date),
    reviewDate: input.reviewDate,
    lastCompletedDate: input.reviewDate,
    nextDueDate,
    status: computeCarePlanStatus(nextDueDate),
    careTeamNotes: input.careTeamNotes,
    noChangesNeeded: input.noChangesNeeded,
    modificationsRequired: input.modificationsRequired,
    modificationsDescription: input.modificationsDescription,
    caregiverName,
    caregiverEmail,
    actor: {
      id: input.actor.id,
      fullName: input.actor.fullName
    },
    now,
    diagnosisIds: input.diagnosisIds,
    sections: normalizedSections
  });

  const signedState = await signCarePlanNurseEsign({
    carePlanId: input.carePlanId,
    actor: {
      id: input.actor.id,
      fullName: input.actor.fullName,
      role: input.actor.role,
      signoffName: input.actor.signatureName
    },
    attested: input.signatureAttested,
    signatureImageDataUrl: input.signatureImageDataUrl,
    metadata: {
      module: "care-plan",
      signedFrom: "reviewCarePlan"
    }
  });

  const finalizedCarePlan = await completeCarePlanNurseSignatureWorkflow({
    carePlanId: input.carePlanId,
    memberId: String(existing.member_id),
    reviewDate: input.reviewDate,
    nextDueDate,
    noChangesNeeded: input.noChangesNeeded,
    modificationsRequired: input.modificationsRequired,
    modificationsDescription: input.modificationsDescription,
    careTeamNotes: input.careTeamNotes,
    sections: normalizedSections,
    snapshotType: "review",
    reviewHistory: {
      reviewDate: input.reviewDate,
      reviewedBy: signedState.signedByName ?? input.actor.signatureName,
      summary: input.modificationsRequired
        ? input.modificationsDescription || "Reviewed with modifications."
        : "Reviewed without required modifications.",
      changesMade: input.modificationsRequired
    },
    actor: {
      id: input.actor.id,
      fullName: input.actor.fullName,
      signatureName: input.actor.signatureName
    },
    signedByName: signedState.signedByName ?? input.actor.signatureName
  });

  await assertCarePlanWriteBoundaryAligned({
    carePlanId: input.carePlanId,
    memberId: String(existing.member_id),
    expectedCaregiverStatus: finalizedCarePlan.caregiverSignatureStatus
  });

  await recordWorkflowEvent({
    eventType: "care_plan_reviewed",
    entityType: "care_plan",
    entityId: input.carePlanId,
    actorType: "user",
    actorUserId: input.actor.id,
    status: "completed",
    severity: "low",
    metadata: {
      member_id: String(existing.member_id),
      track,
      review_date: input.reviewDate,
      next_due_date: nextDueDate
    }
  });
  const recordWorkflowMilestone = await loadWorkflowMilestoneRecorder();
  await recordWorkflowMilestone({
    event: {
      eventType: "care_plan_reviewed",
      entityType: "care_plan",
      entityId: input.carePlanId,
      actorType: "user",
      actorUserId: input.actor.id,
      status: "completed",
      severity: "low",
      metadata: {
        member_id: String(existing.member_id),
        track,
        review_date: input.reviewDate,
        next_due_date: nextDueDate
      }
    }
  });

  return finalizedCarePlan;
}

export async function signCarePlanAsNurseAdmin(input: {
  carePlanId: string;
  actor: { id: string; fullName: string; signatureName: string; role: string };
  attested: boolean;
  signatureImageDataUrl: string;
}) {
  const { signCarePlanNurseEsign } = await loadCarePlanNurseEsignService();
  await signCarePlanNurseEsign({
    carePlanId: input.carePlanId,
    actor: {
      id: input.actor.id,
      fullName: input.actor.fullName,
      role: input.actor.role,
      signoffName: input.actor.signatureName
    },
    attested: input.attested,
    signatureImageDataUrl: input.signatureImageDataUrl,
    metadata: {
      module: "care-plan",
      signedFrom: "signCarePlanAsNurseAdmin"
    }
  });
  try {
    return await finalizeCaregiverDispatchAfterNurseSignature({
      carePlanId: input.carePlanId,
      actor: {
        id: input.actor.id,
        fullName: input.actor.fullName,
        signatureName: input.actor.signatureName
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete caregiver dispatch.";
    throw buildCarePlanWorkflowError(
      `Care Plan nurse/admin signature was saved, but caregiver dispatch failed (${message}). Open the saved care plan to retry sending the caregiver link.`,
      input.carePlanId
    );
  }
}

export async function updateCarePlanCaregiverContact(input: {
  carePlanId: string;
  caregiverName: string;
  caregiverEmail: string;
  actor: { id: string; fullName: string };
}) {
  const caregiverName = sanitizeCaregiverName(input.caregiverName);
  const caregiverEmail = sanitizeCaregiverEmail(input.caregiverEmail);
  if (!caregiverName) throw new Error("Caregiver name is required.");
  if (!caregiverEmail) throw new Error("Caregiver email is required.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("care_plans")
    .update({
      caregiver_name: caregiverName,
      caregiver_email: caregiverEmail,
      updated_by_user_id: input.actor.id,
      updated_by_name: input.actor.fullName,
      updated_at: toEasternISO()
    })
    .eq("id", input.carePlanId)
    .select("id, member_id, caregiver_signature_status")
    .single();
  if (error) throw new Error(error.message);
  return {
    id: String(data.id),
    memberId: String(data.member_id),
    caregiverSignatureStatus: clean(String(data.caregiver_signature_status ?? "")) ?? "pending"
  };
}
