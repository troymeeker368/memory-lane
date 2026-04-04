export default function SalesPipelineLoading() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-white p-4">
        <p className="text-sm font-semibold text-brand">Loading sales pipeline</p>
        <p className="mt-1 text-sm text-muted">
          Fetching lead stages, follow-up queues, enrollment packet status, and pipeline detail.
        </p>
      </div>
    </div>
  );
}
