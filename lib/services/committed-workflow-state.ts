export type FounderWorkflowReadinessStage =
  | "committed"
  | "ready"
  | "follow_up_required"
  | "queued_degraded";

export type FounderWorkflowReadinessContract = {
  stage: FounderWorkflowReadinessStage;
  label: string;
  meaning: string;
  operationallyReady: boolean;
};

const FOUNDER_WORKFLOW_READINESS_CONTRACT: Record<
  FounderWorkflowReadinessStage,
  FounderWorkflowReadinessContract
> = {
  committed: {
    stage: "committed",
    label: "Committed",
    meaning: "Committed means the workflow step was durably saved in Supabase, but downstream readiness is not claimed yet.",
    operationallyReady: false
  },
  ready: {
    stage: "ready",
    label: "Ready",
    meaning: "Ready means the workflow was durably saved and the required downstream follow-up finished cleanly.",
    operationallyReady: true
  },
  follow_up_required: {
    stage: "follow_up_required",
    label: "Follow-up Required",
    meaning: "Follow-up Required means the workflow was durably saved, but staff intervention is still required before it is ready.",
    operationallyReady: false
  },
  queued_degraded: {
    stage: "queued_degraded",
    label: "Queued / Degraded",
    meaning: "Queued / Degraded means the workflow was durably saved, but downstream work is still queued, retrying, or degraded, so it is not ready yet.",
    operationallyReady: false
  }
};

export type CommittedWorkflowActionState<TStatus extends string> = {
  committed: true;
  operationalStatus: TStatus;
  readinessStage: FounderWorkflowReadinessStage;
  readinessLabel: string;
  readinessMeaning: string;
  operationallyReady: boolean;
  actionNeeded: boolean;
  actionNeededMessage: string | null;
};

export function getFounderWorkflowReadinessContract(stage: FounderWorkflowReadinessStage) {
  return FOUNDER_WORKFLOW_READINESS_CONTRACT[stage];
}

export function getFounderWorkflowReadinessLabel(stage: FounderWorkflowReadinessStage) {
  return getFounderWorkflowReadinessContract(stage).label;
}

export function getFounderWorkflowReadinessMeaning(stage: FounderWorkflowReadinessStage) {
  return getFounderWorkflowReadinessContract(stage).meaning;
}

export function buildCommittedWorkflowActionState<TStatus extends string>(input: {
  operationalStatus: TStatus;
  operationallyReady?: boolean;
  readinessStage?: FounderWorkflowReadinessStage;
  actionNeededMessage?: string | null;
}): CommittedWorkflowActionState<TStatus> {
  const readinessStage = input.readinessStage ?? (input.operationallyReady ? "ready" : "follow_up_required");
  const readiness = getFounderWorkflowReadinessContract(readinessStage);
  const hasExplicitActionMessage =
    typeof input.actionNeededMessage === "string"
      ? input.actionNeededMessage.trim().length > 0
      : input.actionNeededMessage !== undefined && input.actionNeededMessage !== null;
  const actionNeeded =
    readinessStage === "follow_up_required" ||
    readinessStage === "queued_degraded" ||
    hasExplicitActionMessage;
  const actionNeededMessage = actionNeeded ? (input.actionNeededMessage ?? readiness.meaning) : null;
  return {
    committed: true,
    operationalStatus: input.operationalStatus,
    readinessStage,
    readinessLabel: readiness.label,
    readinessMeaning: readiness.meaning,
    operationallyReady: readiness.operationallyReady,
    actionNeeded,
    actionNeededMessage
  };
}
