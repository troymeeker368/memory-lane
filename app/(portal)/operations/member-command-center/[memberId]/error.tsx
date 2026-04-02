"use client";

export default function MemberCommandCenterDetailError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-4">
        <p className="text-sm font-semibold text-danger">Member command center load failed</p>
        <p className="mt-1 text-sm text-muted">
          The canonical member shell did not load cleanly. Retry before editing or relying on this record.
        </p>
        <p className="mt-2 text-xs text-muted">{error.message}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-3 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
        >
          Retry member command center
        </button>
      </div>
    </div>
  );
}
