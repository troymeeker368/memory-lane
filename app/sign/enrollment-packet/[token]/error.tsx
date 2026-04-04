"use client";

export default function PublicEnrollmentPacketError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-4">
        <p className="text-sm font-semibold text-danger">Enrollment packet could not be loaded</p>
        <p className="mt-1 text-sm text-muted">
          The secure packet page did not load cleanly. Retry before entering caregiver information or uploading documents.
        </p>
        <p className="mt-2 text-xs text-muted">{error.message}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-3 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
        >
          Retry enrollment packet
        </button>
      </div>
    </div>
  );
}
