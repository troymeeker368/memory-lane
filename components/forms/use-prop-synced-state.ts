"use client";

import { type DependencyList, useEffect, useRef, useState } from "react";

function resolveInitial<T>(initialState: T | (() => T)) {
  if (typeof initialState === "function") {
    return (initialState as () => T)();
  }
  return initialState;
}

export function usePropSyncedState<T>(initialState: T | (() => T), deps: DependencyList) {
  const [state, setState] = useState<T>(() => resolveInitial(initialState));
  const latestInitialStateRef = useRef(initialState);
  latestInitialStateRef.current = initialState;
  const syncKey = JSON.stringify(deps);

  useEffect(() => {
    setState(resolveInitial(latestInitialStateRef.current));
  }, [syncKey]);

  return [state, setState] as const;
}

export function usePropSyncedStatus(deps: DependencyList, initialStatus = "") {
  return usePropSyncedState<string>(initialStatus, deps);
}
