export default function HealthAssessmentDetailLoading() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-white p-4">
        <p className="text-sm font-semibold text-brand">Loading intake assessment</p>
        <p className="mt-1 text-sm text-muted">
          Fetching assessment detail, signature status, follow-up tasks, and PDF actions.
        </p>
      </div>
    </div>
  );
}
