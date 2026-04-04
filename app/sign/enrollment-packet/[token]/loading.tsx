export default function PublicEnrollmentPacketLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="rounded-xl border border-border bg-white p-4">
        <p className="text-sm font-semibold text-brand">Loading enrollment packet</p>
        <p className="mt-1 text-sm text-muted">
          Verifying the secure link, loading packet details, and preparing the caregiver form.
        </p>
      </div>
    </div>
  );
}
