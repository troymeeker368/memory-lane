export type FounderWorkflowReadinessStage =
  | "committed"
  | "ready"
  | "follow_up_required"
  | "queued_degraded";

export type CommittedWorkflowActionState<TStatus extends string> = {
  committed: true;
  operationalStatus: TStatus;
  readinessStage: FounderWorkflowReadinessStage;
  readinessLabel: string;
  operationallyReady: boolean;
  actionNeeded: boolean;
  actionNeededMessage: string | null;
};

export function getFounderWorkflowReadinessLabel(stage: FounderWorkflowReadinessStage) {
  if (stage === "ready") return "Ready";
  if (stage === "follow_up_required") return "Follow-up Required";
  if (stage === "queued_degraded") return "Queued / Degraded";
  return "Committed";
}

export function buildCommittedWorkflowActionState<TStatus extends string>(input: {
  operationalStatus: TStatus;
  operationallyReady?: boolean;
  readinessStage?: FounderWorkflowReadinessStage;
  actionNeededMessage?: string | null;
}): CommittedWorkflowActionState<TStatus> {
  const readinessStage = input.readinessStage ?? (input.operationallyReady ? "ready" : "follow_up_required");
  const operationallyReady = readinessStage === "ready";
  const actionNeededMessage = operationallyReady ? null : (input.actionNeededMessage ?? null);
  return {
    committed: true,
    operationalStatus: input.operationalStatus,
    readinessStage,
    readinessLabel: getFounderWorkflowReadinessLabel(readinessStage),
    operationallyReady,
    actionNeeded: !operationallyReady,
    actionNeededMessage
  };
}
