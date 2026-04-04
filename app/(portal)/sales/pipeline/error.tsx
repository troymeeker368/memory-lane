"use client";

export default function SalesPipelineError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-4">
        <p className="text-sm font-semibold text-danger">Sales pipeline load failed</p>
        <p className="mt-1 text-sm text-muted">
          Pipeline queues or lead detail did not load cleanly. Retry before relying on stage counts or taking follow-up action.
        </p>
        <p className="mt-2 text-xs text-muted">{error.message}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-3 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
        >
          Retry sales pipeline
        </button>
      </div>
    </div>
  );
}
