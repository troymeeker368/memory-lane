import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { getBillingBatches, getBillingExports } from "@/lib/services/billing-read";

import { submitPayorAction } from "@/app/(portal)/operations/payor/actions";

export default async function BillingExportsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const errorMessage = Array.isArray(query.error) ? query.error[0] : query.error;
  const [batches, jobs] = await Promise.all([
    getBillingBatches({ limit: 50 }),
    getBillingExports({ limit: 50 })
  ]);
  const finalizedBatches = batches.filter(
    (row) => row.batch_status === "Finalized" || row.batch_status === "Exported" || row.batch_status === "Closed"
  );
  const pendingFinalizationBatches = batches.filter(
    (row) => row.batch_status === "Draft" || row.batch_status === "Reviewed"
  );

  return (
    <div className="space-y-4">
      {errorMessage ? (
        <Card className="border-rose-200 bg-rose-50">
          <CardTitle>Unable to Generate Export</CardTitle>
          <p className="mt-1 text-sm text-rose-700">{errorMessage}</p>
        </Card>
      ) : null}

      {pendingFinalizationBatches.length > 0 ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardTitle>Batches Must Be Finalized Before Export</CardTitle>
          <p className="mt-1 text-sm text-amber-800">
            Draft and reviewed batches stay out of the export selector until the batch itself is finalized. Export reads finalized invoice headers and lines only.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {pendingFinalizationBatches.map((batch) => (
              <Link
                key={batch.id}
                href={`/operations/payor/billing-batches?batchId=${batch.id}`}
                className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-brand"
              >
                {batch.billing_month} ({batch.batch_status}) - Review / Finalize
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Export Billing Data</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Export uses finalized invoice headers and frozen invoice lines. QuickBooks CSV now follows the QuickBooks invoice import template with invoice-level first rows and continuation line items.
        </p>
        <form action={submitPayorAction} className="mt-3 grid gap-2 md:grid-cols-4">
          <input type="hidden" name="intent" value="createBillingExport" />
          <input type="hidden" name="returnPath" value="/operations/payor/exports" />
          <select name="billingBatchId" className="h-10 rounded-lg border border-border px-3" required>
            <option value="">Select batch</option>
            {finalizedBatches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.billing_month} ({batch.batch_status})
              </option>
            ))}
            {pendingFinalizationBatches.length > 0 ? (
              <option value="" disabled>
                ----------------
              </option>
            ) : null}
            {pendingFinalizationBatches.map((batch) => (
              <option key={`${batch.id}-pending`} value="" disabled>
                {batch.billing_month} ({batch.batch_status} - finalize batch first)
              </option>
            ))}
          </select>
          <select name="exportType" className="h-10 rounded-lg border border-border px-3">
            <option value="QuickBooksCSV">QuickBooks-Friendly CSV</option>
            <option value="InternalReviewCSV">Internal Review CSV</option>
            <option value="InvoiceSummaryCSV">Invoice Summary CSV</option>
          </select>
          <select name="quickbooksDetailLevel" className="h-10 rounded-lg border border-border px-3">
            <option value="Summary">QuickBooks: Grouped Invoice Line Items</option>
            <option value="Detailed">QuickBooks: Raw Finalized Line Items</option>
          </select>
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
            Generate Export
          </button>
        </form>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Export Jobs</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Generated At</th>
              <th>Batch</th>
              <th>Export Type</th>
              <th>File</th>
              <th>Status</th>
              <th>Notes</th>
              <th>Download</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-sm text-muted">No exports generated yet.</td>
              </tr>
            ) : (
              jobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.generated_at}</td>
                  <td>{job.billing_batch_id}</td>
                  <td>{job.export_type}</td>
                  <td>{job.file_name}</td>
                  <td>{job.status}</td>
                  <td>{job.notes ?? "-"}</td>
                  <td>
                    {job.file_data_url ? (
                      <a href={job.file_data_url} download={job.file_name} className="text-xs font-semibold text-brand">
                        Download
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
