import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { addTransportationManifestRiderAction } from "@/app/(portal)/operations/transportation-station/actions";
import { TransportationRunPostingPanel } from "@/components/transportation-station/run-posting-panel";
import { TransportationStationAddRiderForm } from "@/components/forms/transportation-station-add-rider-form";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import { getTransportationAddRiderMemberOptionsSupabase } from "@/lib/services/member-command-center-supabase";
import { getOperationsTodayDate } from "@/lib/services/operations-calendar";
import { getConfiguredBusNumbers } from "@/lib/services/operations-settings";
import { getTransportationRunManifestSupabase } from "@/lib/services/transportation-run-manifest-supabase";
import { formatDate, formatDateTime } from "@/lib/utils";

type Shift = "AM" | "PM";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeShift(value: string | undefined): Shift {
  return value === "PM" ? "PM" : "AM";
}

function normalizeBusNumber(value: string | undefined, options: string[]) {
  if (value && options.includes(value)) return value;
  return options[0] ?? "";
}

function reasonLabel(value: string | null) {
  if (!value) return "-";
  if (value === "already-posted") return "Already posted";
  if (value === "billing-waived") return "Billing waived";
  if (value === "included-in-program-rate") return "Included in program rate";
  return value
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function TransportationStationPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  noStore();
  const profile = await requireModuleAccess("operations");
  const role = normalizeRoleKey(profile.role);
  const canManageManifest =
    role === "admin" ||
    role === "manager" ||
    role === "director" ||
    role === "coordinator";
  const busNumberOptions = await getConfiguredBusNumbers();
  const query = await searchParams;
  const selectedDate = firstString(query.date) ?? getOperationsTodayDate();
  const selectedShift = normalizeShift(firstString(query.shift));
  const selectedBusNumber = normalizeBusNumber(firstString(query.bus), busNumberOptions);

  const manifest = selectedBusNumber
    ? await getTransportationRunManifestSupabase({
        selectedDate,
        shift: selectedShift,
        busNumber: selectedBusNumber
      })
    : null;

  const addRiderMemberOptions = canManageManifest ? await getTransportationAddRiderMemberOptionsSupabase() : [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <BackArrowButton fallbackHref="/operations" forceFallback ariaLabel="Back to operations" />
          <div>
            <CardTitle>Transportation Station</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Post one AM or PM transportation run at a time from a single bus manifest. Riders stay included by default, and drivers only document exceptions.
            </p>
          </div>
        </div>
      </Card>

      <Card className="table-wrap">
        <form method="get" className="grid gap-2 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Date</span>
            <input
              type="date"
              name="date"
              defaultValue={manifest?.selectedDate ?? selectedDate}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Shift</span>
            <select
              name="shift"
              defaultValue={manifest?.selectedShift ?? selectedShift}
              className="h-10 w-full rounded-lg border border-border px-3"
            >
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Bus / Route</span>
            <select
              name="bus"
              defaultValue={selectedBusNumber}
              className="h-10 w-full rounded-lg border border-border px-3"
            >
              {busNumberOptions.length === 0 ? <option value="">No buses configured</option> : null}
              {busNumberOptions.map((option) => (
                <option key={option} value={option}>
                  Bus {option}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end gap-2">
            <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
              Load Run
            </button>
            <Link
              href="/operations/transportation-station"
              className="h-10 rounded-lg border border-border px-3 text-center text-sm font-semibold leading-10"
            >
              Today
            </Link>
          </div>
        </form>

        {selectedBusNumber ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>Selected run: {formatDate(selectedDate)} | {selectedShift} | Bus {selectedBusNumber}</span>
            <a
              href={`/operations/transportation-station/print?date=${selectedDate}&shift=${selectedShift}&bus=${selectedBusNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand"
            >
              Print Expected Manifest
            </a>
          </div>
        ) : null}
      </Card>

      {canManageManifest ? (
        <Card>
          <CardTitle>Same-Day Rider Add</CardTitle>
          <p className="mt-1 text-xs text-muted">
            Use this only for real same-day transportation additions. It adds the rider to the selected run without changing the recurring MCC schedule.
          </p>
          <TransportationStationAddRiderForm
            action={addTransportationManifestRiderAction}
            selectedDate={manifest?.selectedDate ?? selectedDate}
            defaultShift={manifest?.selectedShift ?? selectedShift}
            members={addRiderMemberOptions}
            busNumberOptions={busNumberOptions}
          />
        </Card>
      ) : null}

      {!manifest ? (
        <Card>
          <p className="text-sm text-muted">Configure at least one bus number in Operations Settings before posting transportation runs.</p>
        </Card>
      ) : manifest.rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No riders were resolved for this date, shift, and bus.</p>
        </Card>
      ) : (
        <Card>
          <CardTitle>
            Run Manifest | {formatDate(manifest.selectedDate)} | {manifest.selectedShift} | Bus {manifest.selectedBusNumber}
          </CardTitle>
          <p className="mt-1 text-sm text-muted">
            The shared resolver combines attendance expectations, MCC transportation assignments, manual same-day additions/exclusions, current member status, and already-posted transport history.
          </p>
          {canManageManifest ? (
            <div className="mt-4">
              <TransportationRunPostingPanel
                selectedDate={manifest.selectedDate}
                shift={manifest.selectedShift}
                busNumber={manifest.selectedBusNumber}
                rows={manifest.rows}
                summary={manifest.summary}
                existingRunId={manifest.existingRun?.runId ?? null}
              />
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {manifest.rows.map((row) => (
                <div key={row.memberId} className="rounded-xl border border-border bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-primary-text">{row.memberName}</p>
                    <span className="rounded-full border border-border px-2 py-1 text-xs font-semibold">
                      {row.operationalStatus}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {row.transportType} | {row.locationLabel} | Billing {row.billingStatus}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {manifest?.existingRun ? (
        <Card className="table-wrap">
          <CardTitle>Posted Run Review</CardTitle>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
            <span>Posted: {formatDateTime(manifest.existingRun.postedAt)}</span>
            <span>Last Submitted: {formatDateTime(manifest.existingRun.lastSubmittedAt)}</span>
            <span>By: {manifest.existingRun.submittedByName ?? "-"}</span>
            <span>Attempts: {manifest.existingRun.submissionCount}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>Expected {manifest.existingRun.totalExpected}</span>
            <span>Posted {manifest.existingRun.totalPosted}</span>
            <span>Excluded {manifest.existingRun.totalExcluded}</span>
            <span>Duplicates {manifest.existingRun.totalDuplicates}</span>
            <span>Nonbillable {manifest.existingRun.totalNonbillable}</span>
          </div>

          {manifest.existingRunResults.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No per-member run results were found for this run yet.</p>
          ) : (
            <table className="mt-3">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Result</th>
                  <th>Reason</th>
                  <th>Billing</th>
                  <th>Transport Log</th>
                </tr>
              </thead>
              <tbody>
                {manifest.existingRunResults.map((row) => (
                  <tr key={`${row.memberId}-${row.createdAt}`}>
                    <td>{row.memberName}</td>
                    <td>{row.resultStatus}</td>
                    <td>{reasonLabel(row.reasonCode)}</td>
                    <td>{row.billable ? "Billable" : row.billingStatus === "Waived" ? "Waived" : "Included in rate"}</td>
                    <td>{row.transportLogId ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {manifest?.recentRunsForDate.length ? (
        <Card className="table-wrap">
          <CardTitle>Run History For {formatDate(manifest.selectedDate)}</CardTitle>
          <table className="mt-3">
            <thead>
              <tr>
                <th>Bus</th>
                <th>Shift</th>
                <th>Posted</th>
                <th>By</th>
                <th>Expected</th>
                <th>Posted</th>
                <th>Excluded</th>
                <th>Duplicates</th>
              </tr>
            </thead>
            <tbody>
              {manifest.recentRunsForDate.map((row) => (
                <tr key={row.runId}>
                  <td>
                    <Link
                      href={`/operations/transportation-station?date=${row.serviceDate}&shift=${row.shift}&bus=${row.busNumber}`}
                      className="font-semibold text-brand"
                    >
                      Bus {row.busNumber}
                    </Link>
                  </td>
                  <td>{row.shift}</td>
                  <td>{formatDateTime(row.postedAt)}</td>
                  <td>{row.submittedByName ?? "-"}</td>
                  <td>{row.totalExpected}</td>
                  <td>{row.totalPosted}</td>
                  <td>{row.totalExcluded}</td>
                  <td>{row.totalDuplicates}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
