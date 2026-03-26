export type CommittedWorkflowActionState<TStatus extends string> = {
  committed: true;
  operationalStatus: TStatus;
  operationallyReady: boolean;
  actionNeeded: boolean;
  actionNeededMessage: string | null;
};

export function buildCommittedWorkflowActionState<TStatus extends string>(input: {
  operationalStatus: TStatus;
  operationallyReady: boolean;
  actionNeededMessage?: string | null;
}): CommittedWorkflowActionState<TStatus> {
  const actionNeededMessage = input.operationallyReady ? null : (input.actionNeededMessage ?? null);
  return {
    committed: true,
    operationalStatus: input.operationalStatus,
    operationallyReady: input.operationallyReady,
    actionNeeded: !input.operationallyReady,
    actionNeededMessage
  };
}
