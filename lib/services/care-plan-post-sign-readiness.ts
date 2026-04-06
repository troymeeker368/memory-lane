import {
  buildCommittedWorkflowActionState,
  getFounderWorkflowReadinessLabel,
  getFounderWorkflowReadinessMeaning,
  type FounderWorkflowReadinessStage
} from "@/lib/services/committed-workflow-state";
import type { CarePlanPostSignReadinessStatus } from "@/lib/services/care-plan-types";

export type CarePlanPublicCompletionOutcome = {
  readinessStage: FounderWorkflowReadinessStage;
  readinessLabel: string;
  readinessMeaning: string;
  actionNeeded: boolean;
  actionNeededMessage: string | null;
};

export function resolveCarePlanPostSignWorkflowReadinessStage(
  status: CarePlanPostSignReadinessStatus,
  options?: {
    failureRequiresStaffFollowUp?: boolean;
  }
): FounderWorkflowReadinessStage {
  if (status === "ready") return "ready";
  if (status === "not_started") return "committed";
  if (options?.failureRequiresStaffFollowUp) return "follow_up_required";
  return "queued_degraded";
}

export function getCarePlanPostSignReadinessLabel(status: CarePlanPostSignReadinessStatus) {
  const readinessLabel = getFounderWorkflowReadinessLabel(resolveCarePlanPostSignWorkflowReadinessStage(status));
  if (status === "ready") return `${readinessLabel} - Care Plan Finalized`;
  if (status === "signed_pending_snapshot") return `${readinessLabel} - Internal Snapshot`;
  if (status === "signed_pending_caregiver_dispatch") return `${readinessLabel} - Caregiver Dispatch`;
  return readinessLabel;
}

export function getCarePlanPostSignReadinessDetail(status: CarePlanPostSignReadinessStatus) {
  if (status === "not_started") {
    return getFounderWorkflowReadinessMeaning("committed");
  }
  if (status === "signed_pending_snapshot") {
    return "This care plan is committed, but internal snapshot persistence is still in post-sign processing. Do not treat it as ready yet.";
  }
  if (status === "signed_pending_caregiver_dispatch") {
    return "This care plan is committed, but caregiver dispatch is still in post-sign processing. Do not treat it as ready yet.";
  }
  return null;
}

export function buildCarePlanPostSignOutcome(
  status: CarePlanPostSignReadinessStatus,
  options?: {
    failureRequiresStaffFollowUp?: boolean;
    actionNeededMessage?: string | null;
  }
): CarePlanPublicCompletionOutcome {
  const readinessStage = resolveCarePlanPostSignWorkflowReadinessStage(status, {
    failureRequiresStaffFollowUp: options?.failureRequiresStaffFollowUp
  });
  const readiness = buildCommittedWorkflowActionState({
    operationalStatus: status,
    readinessStage,
    actionNeededMessage:
      options?.actionNeededMessage ??
      getCarePlanPostSignReadinessDetail(status) ??
      (status === "ready"
        ? null
        : "This care plan is committed, but post-sign follow-up still needs attention before it is ready.")
  });
  return {
    readinessStage: readiness.readinessStage,
    readinessLabel: readiness.readinessLabel,
    readinessMeaning: readiness.readinessMeaning,
    actionNeeded: readiness.actionNeeded,
    actionNeededMessage: readiness.actionNeededMessage
  };
}

export function buildCarePlanPublicCompletionOutcome(
  status: CarePlanPostSignReadinessStatus
): CarePlanPublicCompletionOutcome {
  return buildCarePlanPostSignOutcome(status);
}

export function buildCommittedCarePlanActionState(input: {
  status: CarePlanPostSignReadinessStatus;
  failureRequiresStaffFollowUp?: boolean;
  actionNeededMessage?: string | null;
}) {
  return buildCommittedWorkflowActionState({
    operationalStatus: input.status,
    readinessStage: resolveCarePlanPostSignWorkflowReadinessStage(input.status, {
      failureRequiresStaffFollowUp: input.failureRequiresStaffFollowUp
    }),
    actionNeededMessage:
      input.actionNeededMessage ??
      getCarePlanPostSignReadinessDetail(input.status) ??
      (input.status === "ready"
        ? null
        : "This care plan is committed, but post-sign follow-up still needs attention before it is ready.")
  });
}
