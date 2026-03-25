import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { addTransportationManifestRiderAction } from "@/app/(portal)/operations/transportation-station/actions";
import { TransportationRunPostingPanel } from "@/components/transportation-station/run-posting-panel";
import { UnassignedRiderAssignmentForm } from "@/components/transportation-station/unassigned-rider-assignment-form";
import { TransportationStationAddRiderForm } from "@/components/forms/transportation-station-add-rider-form";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions/core";
import { getOperationsTodayDate } from "@/lib/services/operations-calendar";
import { getConfiguredBusNumbers } from "@/lib/services/operations-settings";
import {
  getTransportationAddRiderMembers,
  getTransportationManifest,
  getTransportationRunManifest,
  type TransportationManifestBusFilter,
  type TransportationStationShift
} from "@/lib/services/transportation-read";
import { formatDate, formatDateTime } from "@/lib/utils";

type Shift = "AM" | "PM";
function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeShift(value: string | undefined): TransportationStationShift {
  if (value === "AM" || value === "PM" || value === "Both") return value;
  return "Both";
}

function normalizeBusFilter(value: string | undefined, options: string[]): TransportationManifestBusFilter {
  if (!value) return "all";
  if (value === "all" || value === "unassigned") return value;
  if (options.includes(value)) return value;
  return "all";
}

function buildSearchHref(input: {
  selectedDate: string;
  selectedShift: TransportationStationShift;
  selectedBusFilter: TransportationManifestBusFilter;
  memberSearch?: string | null;
}) {
  const params = new URLSearchParams();
  params.set("date", input.selectedDate);
  params.set("shift", input.selectedShift);
  params.set("bus", input.selectedBusFilter);
  const memberSearch = (input.memberSearch ?? "").trim();
  if (memberSearch) {
    params.set("memberSearch", memberSearch);
  }
  return `/operations/transportation-station?${params.toString()}`;
}

function busFilterLabel(busFilter: TransportationManifestBusFilter) {
  if (busFilter === "all") return "All buses";
  if (busFilter === "unassigned") return "Unassigned riders";
  return `Bus ${busFilter}`;
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
  const busNumberOptionsPromise = getConfiguredBusNumbers();
  const query = await searchParams;
  const selectedDate = firstString(query.date) ?? getOperationsTodayDate();
  const selectedShift = normalizeShift(firstString(query.shift));
  const memberSearch = firstString(query.memberSearch)?.trim() ?? "";
  const successMessage = firstString(query.success)?.trim() ?? "";
  const errorMessage = firstString(query.error)?.trim() ?? "";
  const selectedBusFilterPromise = busNumberOptionsPromise.then((busNumberOptions) =>
    normalizeBusFilter(firstString(query.bus), busNumberOptions)
  );
  const addRiderMemberOptionsPromise =
    canManageManifest && memberSearch.length >= 2
      ? getTransportationAddRiderMembers({ q: memberSearch, limit: 25 })
      : Promise.resolve([]);
  const [busNumberOptions, selectedBusFilter, addRiderMemberOptions] = await Promise.all([
    busNumberOptionsPromise,
    selectedBusFilterPromise,
    addRiderMemberOptionsPromise
  ]);
  const selectedRunShift: Shift | null = selectedShift === "AM" || selectedShift === "PM" ? selectedShift : null;
  const selectedRunBus =
    selectedBusFilter !== "all" && selectedBusFilter !== "unassigned" ? selectedBusFilter : null;
  const singleRunSelection = selectedRunShift !== null && selectedRunBus !== null;
  const [manifestOverview, runManifest] = await Promise.all([
    getTransportationManifest({
      selectedDate,
      shift: selectedShift,
      busFilter: selectedBusFilter
    }),
    singleRunSelection
      ? getTransportationRunManifest({
          selectedDate,
          shift: selectedRunShift,
          busNumber: selectedRunBus
        })
      : Promise.resolve(null)
  ]);

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
              defaultValue={runManifest?.selectedDate ?? manifestOverview.selectedDate}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Shift</span>
            <select
              name="shift"
              defaultValue={runManifest?.selectedShift ?? manifestOverview.selectedShift}
              className="h-10 w-full rounded-lg border border-border px-3"
            >
              <option value="AM">AM</option>
              <option value="PM">PM</option>
              <option value="Both">Both</option>
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Bus / Route</span>
            <select
              name="bus"
              defaultValue={selectedBusFilter}
              className="h-10 w-full rounded-lg border border-border px-3"
            >
              <option value="all">All buses</option>
              <option value="unassigned">Unassigned riders</option>
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

        {selectedBusFilter ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>
              Selected view: {formatDate(selectedDate)} | {selectedShift} | {busFilterLabel(selectedBusFilter)}
            </span>
            <a
              href={`/operations/transportation-station/print?date=${selectedDate}&shift=${selectedShift}&bus=${selectedBusFilter}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand"
            >
              {selectedBusFilter === "all" && selectedShift === "Both" ? "Print Center Driver Packet" : "Print Expected Manifest"}
            </a>
          </div>
        ) : null}

        {successMessage ? (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {successMessage}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}
      </Card>

      {canManageManifest ? (
        <Card>
          <CardTitle>Same-Day Rider Add</CardTitle>
          <p className="mt-1 text-xs text-muted">
            Use this only for real same-day transportation additions. It adds the rider to the selected run without changing the recurring MCC schedule.
          </p>
          <form method="get" className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <input type="hidden" name="date" value={runManifest?.selectedDate ?? manifestOverview.selectedDate} />
            <input type="hidden" name="shift" value={runManifest?.selectedShift ?? manifestOverview.selectedShift} />
            <input type="hidden" name="bus" value={selectedBusFilter} />
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Find Member</span>
              <input
                type="text"
                name="memberSearch"
                defaultValue={memberSearch}
                placeholder="Search active member name"
                className="h-10 w-full rounded-lg border border-border px-3"
              />
            </label>
            <button type="submit" className="h-10 self-end rounded-lg border border-border px-3 text-sm font-semibold">
              Search
            </button>
            <Link
              href={buildSearchHref({
                selectedDate: runManifest?.selectedDate ?? manifestOverview.selectedDate,
                selectedShift: runManifest?.selectedShift ?? manifestOverview.selectedShift,
                selectedBusFilter,
                memberSearch: null
              })}
              className="h-10 self-end rounded-lg border border-border px-3 text-center text-sm font-semibold leading-10"
            >
              Clear
            </Link>
          </form>
          <p className="mt-2 text-xs text-muted">
            {memberSearch.length < 2
              ? "Search at least 2 letters to load a limited active-member list for same-day rider add."
              : addRiderMemberOptions.length === 0
                ? "No active members matched that search."
                : `Showing ${addRiderMemberOptions.length} matching active member${addRiderMemberOptions.length === 1 ? "" : "s"} for add-rider.`}
          </p>
          <TransportationStationAddRiderForm
            action={addTransportationManifestRiderAction}
            selectedDate={runManifest?.selectedDate ?? manifestOverview.selectedDate}
            defaultShift={runManifest?.selectedShift ?? manifestOverview.selectedShift}
            members={addRiderMemberOptions}
            busNumberOptions={busNumberOptions}
          />
        </Card>
      ) : null}

      {busNumberOptions.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Configure at least one bus number in Operations Settings before posting transportation runs.</p>
        </Card>
      ) : runManifest ? (
        runManifest.rows.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No riders were resolved for this date, shift, and bus.</p>
          </Card>
        ) : (
          <Card>
            <CardTitle>
              Run Manifest | {formatDate(runManifest.selectedDate)} | {runManifest.selectedShift} | Bus {runManifest.selectedBusNumber}
            </CardTitle>
            <p className="mt-1 text-sm text-muted">
              The shared resolver combines attendance expectations, MCC transportation assignments, manual same-day additions/exclusions, current member status, and already-posted transport history.
            </p>
            {canManageManifest ? (
              <div className="mt-4">
                <TransportationRunPostingPanel
                  selectedDate={runManifest.selectedDate}
                  shift={runManifest.selectedShift}
                  busNumber={runManifest.selectedBusNumber}
                  rows={runManifest.rows}
                  summary={runManifest.summary}
                  existingRunId={runManifest.existingRun?.runId ?? null}
                />
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {runManifest.rows.map((row) => (
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
        )
      ) : manifestOverview.totalRiders === 0 ? (
        <Card>
          <p className="text-sm text-muted">No riders were resolved for this date, shift, and bus filter.</p>
        </Card>
      ) : (
        <Card>
          <CardTitle>
            Manifest Overview | {formatDate(manifestOverview.selectedDate)} | {manifestOverview.selectedShift} | {busFilterLabel(selectedBusFilter)}
          </CardTitle>
          <p className="mt-1 text-sm text-muted">
            This combined view restores the old multi-shift lookup. Printing follows bus order and then AM/PM order so staff can hand each driver a clean packet. Posting still happens one real date, shift, and bus run at a time so run history, billing, and duplicate protection stay canonical.
          </p>
          <div className="mt-4 grid gap-2 rounded-xl border border-border bg-slate-50 p-3 text-sm md:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Total Riders</p>
              <p className="text-lg font-semibold text-primary-text">{manifestOverview.totalRiders}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Manual Adds</p>
              <p className="text-lg font-semibold text-primary-text">{manifestOverview.manualAdditions.length}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Exclusions</p>
              <p className="text-lg font-semibold text-primary-text">{manifestOverview.exclusions.length}</p>
            </div>
          </div>
          <div className="mt-4 space-y-4">
            {manifestOverview.groups.map((group) => {
              const availableShifts = Array.from(new Set(group.riders.map((row) => row.shift)));
              const showAssignColumn = canManageManifest && group.busNumber == null && busNumberOptions.length > 0;
              return (
                <div key={group.label} className="rounded-xl border border-border bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-primary-text">{group.label}</p>
                      <p className="text-xs text-muted">{group.riders.length} rider(s) in this filtered view</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.busNumber
                        ? availableShifts.map((shift) => (
                            <Link
                              key={`${group.label}-${shift}`}
                              href={`/operations/transportation-station?date=${manifestOverview.selectedDate}&shift=${shift}&bus=${group.busNumber}`}
                              className="rounded-lg border border-border px-3 py-1 text-xs font-semibold text-brand"
                            >
                              Open {shift} Run
                            </Link>
                          ))
                        : null}
                    </div>
                  </div>
                  {showAssignColumn ? (
                    <div className="mt-3 space-y-3">
                      {group.riders.map((row) => (
                        <div key={row.key} className="rounded-xl border border-border bg-slate-50 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-semibold text-primary-text">{row.memberName}</p>
                              <p className="text-xs text-muted">
                                {row.source === "manual-add" ? "Manual add" : "Recurring assignment"}
                              </p>
                            </div>
                            <span className="rounded-full border border-border bg-white px-2 py-1 text-xs font-semibold text-primary-text">
                              {row.shift}
                            </span>
                          </div>
                          <div className="mt-3 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Type</p>
                              <p>{row.transportType}</p>
                            </div>
                            <div className="xl:col-span-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Location</p>
                              <p>{row.locationLabel}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Contact</p>
                              <p>{row.caregiverContactName ?? "-"}</p>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-dashed border-border bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Assign This Rider</p>
                              <p className="text-xs text-muted">Creates a same-day transportation override without changing the recurring MCC route.</p>
                            </div>
                            <UnassignedRiderAssignmentForm
                              selectedDate={manifestOverview.selectedDate}
                              busFilter={selectedBusFilter}
                              memberId={row.memberId}
                              shift={row.shift}
                              transportType={row.transportType}
                              busStopName={row.busStopName}
                              doorToDoorAddress={row.doorToDoorAddress}
                              caregiverContactId={row.caregiverContactId}
                              caregiverContactName={row.caregiverContactName}
                              caregiverContactPhone={row.caregiverContactPhone}
                              caregiverContactAddress={row.caregiverContactAddress}
                              notes={row.notes}
                              busNumberOptions={busNumberOptions}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <table className="mt-3">
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Shift</th>
                          <th>Type</th>
                          <th>Location</th>
                          <th>Contact</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.riders.map((row) => (
                          <tr key={row.key}>
                            <td>{row.memberName}</td>
                            <td>{row.shift}</td>
                            <td>{row.transportType}</td>
                            <td>{row.locationLabel}</td>
                            <td>{row.caregiverContactName ?? "-"}</td>
                            <td>{row.source === "manual-add" ? "Manual Add" : "Schedule"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
            {manifestOverview.holdExcludedScheduledRiders.length > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {manifestOverview.holdExcludedScheduledRiders.length} scheduled rider(s) were excluded because the member is on hold for this date.
              </div>
            ) : null}
          </div>
        </Card>
      )}

      {runManifest?.existingRun ? (
        <Card className="table-wrap">
          <CardTitle>Posted Run Review</CardTitle>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
            <span>Posted: {formatDateTime(runManifest.existingRun.postedAt)}</span>
            <span>Last Submitted: {formatDateTime(runManifest.existingRun.lastSubmittedAt)}</span>
            <span>By: {runManifest.existingRun.submittedByName ?? "-"}</span>
            <span>Attempts: {runManifest.existingRun.submissionCount}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>Expected {runManifest.existingRun.totalExpected}</span>
            <span>Posted {runManifest.existingRun.totalPosted}</span>
            <span>Excluded {runManifest.existingRun.totalExcluded}</span>
            <span>Duplicates {runManifest.existingRun.totalDuplicates}</span>
            <span>Nonbillable {runManifest.existingRun.totalNonbillable}</span>
          </div>

          {runManifest.existingRunResults.length === 0 ? (
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
                {runManifest.existingRunResults.map((row) => (
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

      {runManifest?.recentRunsForDate.length ? (
        <Card className="table-wrap">
          <CardTitle>Run History For {formatDate(runManifest.selectedDate)}</CardTitle>
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
              {runManifest.recentRunsForDate.map((row) => (
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
