import type { CarePlanPostSignReadinessStatus } from "@/lib/services/care-plan-types";

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
