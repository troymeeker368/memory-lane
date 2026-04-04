"use client";

export default function HealthAssessmentDetailError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-4">
        <p className="text-sm font-semibold text-danger">Intake assessment load failed</p>
        <p className="mt-1 text-sm text-muted">
          Intake detail or downstream readiness data did not load cleanly. Retry before using this record for clinical follow-up.
        </p>
        <p className="mt-2 text-xs text-muted">{error.message}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-3 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
        >
          Retry intake assessment
        </button>
      </div>
    </div>
  );
}
