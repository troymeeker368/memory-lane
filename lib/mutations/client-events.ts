"use client";

export function emitClientMutationEvent<TDetail extends object>(name: string, detail: TDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function subscribeClientMutationEvent<TDetail extends object>(
  name: string,
  handler: (detail: TDetail) => void
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<TDetail>;
    handler(customEvent.detail);
  };

  window.addEventListener(name, listener as EventListener);
  return () => window.removeEventListener(name, listener as EventListener);
}
