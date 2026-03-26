"use client";

import { useCallback, type DependencyList, type Dispatch, type SetStateAction, useState } from "react";

function resolveInitial<T>(initialState: T | (() => T)) {
  if (typeof initialState === "function") {
    return (initialState as () => T)();
  }
  return initialState;
}

export function usePropSyncedState<T>(initialState: T | (() => T), deps: DependencyList) {
  const [snapshot, setSnapshot] = useState<{ key: string; value: T }>(() => ({
    key: JSON.stringify(deps),
    value: resolveInitial(initialState)
  }));
  const syncKey = JSON.stringify(deps);
  const state = snapshot.key === syncKey ? snapshot.value : resolveInitial(initialState);
  const setState = useCallback<Dispatch<SetStateAction<T>>>(
    (nextState) => {
      setSnapshot((current) => {
        const baseState = current.key === syncKey ? current.value : resolveInitial(initialState);
        const resolvedState =
          typeof nextState === "function" ? (nextState as (previousState: T) => T)(baseState) : nextState;
        return {
          key: syncKey,
          value: resolvedState
        };
      });
    },
    [initialState, syncKey]
  );

  return [state, setState] as const;
}

export function usePropSyncedStatus(deps: DependencyList, initialStatus = "") {
  return usePropSyncedState<string>(initialStatus, deps);
}
