export function timingNowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

export function logServerTiming(
  traceLabel: string | undefined,
  step: string,
  startedAtMs: number,
  details?: Record<string, unknown>
) {
  if (!traceLabel) return;

  const elapsedMs = (timingNowMs() - startedAtMs).toFixed(1);
  const detailsText = details
    ? Object.entries(details)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")
    : "";
  const suffix = detailsText ? ` ${detailsText}` : "";

  console.info(`[timing] ${traceLabel} ${step} ${elapsedMs}ms${suffix}`);
}
