import type { CarePlanPostSignReadinessStatus } from "@/lib/services/care-plan-types";

export type CarePlanPublicCompletionOutcome = {
  actionNeeded: boolean;
  actionNeededMessage: string | null;
};

export function getCarePlanPostSignReadinessLabel(status: CarePlanPostSignReadinessStatus) {
  if (status === "ready") return "Operationally Ready";
  if (status === "signed_pending_snapshot") return "Internal Follow-up Needed";
  if (status === "signed_pending_caregiver_dispatch") return "Caregiver Follow-up Needed";
  return "Post-Sign Work Not Started";
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
  return {
    actionNeeded: status !== "ready",
    actionNeededMessage:
      actionNeededMessage ??
      (status === "ready"
        ? null
        : "This care plan was already signed, but post-sign follow-up still needs attention.")
  };
}
