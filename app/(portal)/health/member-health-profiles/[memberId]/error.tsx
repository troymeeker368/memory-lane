"use client";

export default function MemberHealthProfileDetailError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-4">
        <p className="text-sm font-semibold text-danger">Member health profile load failed</p>
        <p className="mt-1 text-sm text-muted">
          Clinical profile data could not be loaded cleanly. Retry before making clinical changes.
        </p>
        <p className="mt-2 text-xs text-muted">{error.message}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-3 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
        >
          Retry member health profile
        </button>
      </div>
    </div>
  );
}
