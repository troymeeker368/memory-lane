import {
  getFounderWorkflowReadinessLabel,
  type FounderWorkflowReadinessStage
} from "@/lib/services/committed-workflow-state";
import type { CarePlanPostSignReadinessStatus } from "@/lib/services/care-plan-types";

export type CarePlanPublicCompletionOutcome = {
  readinessStage: FounderWorkflowReadinessStage;
  readinessLabel: string;
  actionNeeded: boolean;
  actionNeededMessage: string | null;
};

export function resolveCarePlanPostSignWorkflowReadinessStage(
  status: CarePlanPostSignReadinessStatus
): FounderWorkflowReadinessStage {
  if (status === "ready") return "ready";
  if (status === "not_started") return "committed";
  return "follow_up_required";
}

export function getCarePlanPostSignReadinessLabel(status: CarePlanPostSignReadinessStatus) {
  const readinessLabel = getFounderWorkflowReadinessLabel(resolveCarePlanPostSignWorkflowReadinessStage(status));
  if (status === "ready") return `${readinessLabel} - Care Plan Finalized`;
  if (status === "signed_pending_snapshot") return `${readinessLabel} - Internal Snapshot`;
  if (status === "signed_pending_caregiver_dispatch") return `${readinessLabel} - Caregiver Dispatch`;
  return readinessLabel;
}

export function getCarePlanPostSignReadinessDetail(status: CarePlanPostSignReadinessStatus) {
  if (status === "signed_pending_snapshot") {
    return "This care plan still needs internal follow-up before the workflow is fully complete.";
  }
  if (status === "signed_pending_caregiver_dispatch") {
    return "The caregiver signature step still needs follow-up before this care plan is fully complete.";
  }
  return null;
}

export function buildCarePlanPublicCompletionOutcome(
  status: CarePlanPostSignReadinessStatus
): CarePlanPublicCompletionOutcome {
  const actionNeededMessage = getCarePlanPostSignReadinessDetail(status);
  const readinessStage = resolveCarePlanPostSignWorkflowReadinessStage(status);
  return {
    readinessStage,
    readinessLabel: getFounderWorkflowReadinessLabel(readinessStage),
    actionNeeded: status !== "ready",
    actionNeededMessage:
      actionNeededMessage ??
      (status === "ready"
        ? null
        : "This care plan was already signed, but post-sign follow-up still needs attention.")
  };
}
