"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { postTransportationRunAction } from "@/app/(portal)/operations/transportation-station/actions";
import {
  getTransportationExclusionReasonLabel,
  TRANSPORTATION_DRIVER_EXCLUSION_REASONS,
  type TransportationDriverExclusionReason
} from "@/lib/services/transportation-run-shared";
import { formatPhoneDisplay } from "@/lib/phone";

type Shift = "AM" | "PM";
type TransportationOperationalStatus =
  | "eligible"
  | "absent"
  | "excluded"
  | "inactive"
  | "outside-route-dates"
  | "already-posted";

type ManifestRow = {
  memberId: string;
  memberName: string;
  shift: Shift;
  transportType: "Bus Stop" | "Door to Door";
  locationLabel: string;
  caregiverContactName: string | null;
  caregiverContactPhone: string | null;
  caregiverContactAddress: string | null;
  riderSource: "schedule" | "manual-add";
  attendanceStatus: "present" | "absent" | "not-recorded";
  operationalStatus: TransportationOperationalStatus;
  operationalReasonLabel: string | null;
  billingStatus: "BillNormally" | "Waived" | "IncludedInProgramRate";
  billable: boolean;
};

type PostSummary = {
  expectedRiders: number;
  postedRiders: number;
  excludedRiders: number;
  skippedDuplicates: number;
  waivedNonbillableRiders: number;
};

type Props = {
  selectedDate: string;
  shift: Shift;
  busNumber: string;
  rows: ManifestRow[];
  summary: {
    expectedRiders: number;
    readyToPost: number;
    excludedOrBlocked: number;
    alreadyPosted: number;
    waivedOrIncluded: number;
  };
  existingRunId?: string | null;
};

type ExclusionState = {
  excluded: boolean;
  reason: TransportationDriverExclusionReason;
  notes: string;
};

const DEFAULT_REASON: TransportationDriverExclusionReason = "no-show";

function statusBadgeClass(status: TransportationOperationalStatus) {
  if (status === "eligible") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "already-posted") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "absent") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "excluded") return "border-slate-200 bg-slate-100 text-slate-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function statusLabel(status: TransportationOperationalStatus) {
  switch (status) {
    case "eligible":
      return "Eligible";
    case "already-posted":
      return "Already Posted";
    case "absent":
      return "Absent";
    case "excluded":
      return "Excluded";
    case "inactive":
      return "Inactive";
    case "outside-route-dates":
      return "Outside Route Dates";
    default:
      return status;
  }
}

export function TransportationRunPostingPanel(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [postSummary, setPostSummary] = useState<PostSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualExclusions, setManualExclusions] = useState<Record<string, ExclusionState>>({});

  useEffect(() => {
    const nextState: Record<string, ExclusionState> = {};
    props.rows
      .filter((row) => row.operationalStatus === "eligible")
      .forEach((row) => {
        nextState[row.memberId] = {
          excluded: false,
          reason: DEFAULT_REASON,
          notes: ""
        };
      });
    setManualExclusions(nextState);
    setPostSummary(null);
    setError(null);
  }, [props.rows, props.selectedDate, props.shift, props.busNumber]);

  const includedCount = useMemo(
    () =>
      props.rows.filter((row) => row.operationalStatus === "eligible").filter((row) => !manualExclusions[row.memberId]?.excluded)
        .length,
    [manualExclusions, props.rows]
  );

  const excludedCount = useMemo(
    () =>
      props.rows.filter((row) => row.operationalStatus === "eligible").filter((row) => manualExclusions[row.memberId]?.excluded)
        .length,
    [manualExclusions, props.rows]
  );

  const toggleExclusion = (memberId: string, excluded: boolean) => {
    setManualExclusions((current) => ({
      ...current,
      [memberId]: {
        ...(current[memberId] ?? { excluded: false, reason: DEFAULT_REASON, notes: "" }),
        excluded
      }
    }));
  };

  const updateExclusion = (
    memberId: string,
    patch: Partial<ExclusionState>
  ) => {
    setManualExclusions((current) => ({
      ...current,
      [memberId]: {
        ...(current[memberId] ?? { excluded: false, reason: DEFAULT_REASON, notes: "" }),
        ...patch
      }
    }));
  };

  const submit = () => {
    startTransition(async () => {
      setError(null);
      setPostSummary(null);
      const exclusions = Object.entries(manualExclusions)
        .filter(([, value]) => value.excluded)
        .map(([memberId, value]) => ({
          memberId,
          reason: value.reason,
          notes: value.notes.trim() || null
        }));

      const response = await postTransportationRunAction({
        selectedDate: props.selectedDate,
        shift: props.shift,
        busNumber: props.busNumber,
        manualExclusions: exclusions
      });

      if (!response.ok) {
        setError(response.error ?? "Unable to post transportation run.");
        return;
      }

      setPostSummary(response.result);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2 rounded-xl border border-border bg-slate-50 p-3 text-sm md:grid-cols-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Expected</p>
          <p className="text-lg font-semibold text-primary-text">{props.summary.expectedRiders}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Ready To Post</p>
          <p className="text-lg font-semibold text-primary-text">{includedCount}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Driver Exclusions</p>
          <p className="text-lg font-semibold text-primary-text">{excludedCount}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Blocked</p>
          <p className="text-lg font-semibold text-primary-text">{props.summary.excludedOrBlocked + props.summary.alreadyPosted}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Nonbillable</p>
          <p className="text-lg font-semibold text-primary-text">{props.summary.waivedOrIncluded}</p>
        </div>
      </div>

      {props.existingRunId ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          This run has already been posted. Re-submitting is safe and will skip duplicates while refreshing the run summary.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}
      {postSummary ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Posted {postSummary.postedRiders} rider(s). Excluded {postSummary.excludedRiders}. Skipped duplicates {postSummary.skippedDuplicates}. Nonbillable riders {postSummary.waivedNonbillableRiders}.
        </div>
      ) : null}

      <div className="space-y-3">
        {props.rows.map((row) => {
          const exclusionState = manualExclusions[row.memberId];
          const isEligible = row.operationalStatus === "eligible";
          const isManuallyExcluded = Boolean(exclusionState?.excluded);
          return (
            <div key={row.memberId} className="rounded-xl border border-border bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-base font-semibold text-primary-text">{row.memberName}</p>
                  <p className="text-xs text-muted">
                    {row.transportType} | {row.locationLabel} | {row.riderSource === "manual-add" ? "Manual add" : "Recurring assignment"}
                  </p>
                </div>
                <div className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusBadgeClass(row.operationalStatus)}`}>
                  {statusLabel(row.operationalStatus)}
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Contact</p>
                  <p>{row.caregiverContactName ?? "-"}</p>
                  <p>{formatPhoneDisplay(row.caregiverContactPhone)}</p>
                  <p className="text-xs text-muted">{row.caregiverContactAddress ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Billing</p>
                  <p>{row.billingStatus === "BillNormally" ? "Bill normally" : row.billingStatus === "Waived" ? "Waived" : "Included in program rate"}</p>
                  <p className="text-xs text-muted">
                    Attendance: {row.attendanceStatus === "not-recorded" ? "Not marked yet" : row.attendanceStatus}
                  </p>
                  {row.operationalReasonLabel ? <p className="text-xs text-muted">{row.operationalReasonLabel}</p> : null}
                </div>
              </div>

              {isEligible ? (
                <div className="mt-3 rounded-lg border border-border bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-primary-text">
                      <input
                        type="checkbox"
                        checked={!isManuallyExcluded}
                        onChange={(event) => toggleExclusion(row.memberId, !event.target.checked)}
                      />
                      Include rider in this run
                    </label>
                    {!row.billable ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                        Operational only
                      </span>
                    ) : null}
                  </div>

                  {isManuallyExcluded ? (
                    <div className="mt-3 grid gap-2 md:grid-cols-[220px,1fr]">
                      <label className="space-y-1 text-sm">
                        <span className="text-xs font-semibold text-muted">Exclude Reason</span>
                        <select
                          value={exclusionState.reason}
                          onChange={(event) =>
                            updateExclusion(row.memberId, {
                              reason: event.target.value as TransportationDriverExclusionReason
                            })
                          }
                          className="h-10 w-full rounded-lg border border-border px-3"
                        >
                          {TRANSPORTATION_DRIVER_EXCLUSION_REASONS.map((reason) => (
                            <option key={reason} value={reason}>
                              {getTransportationExclusionReasonLabel(reason)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-sm">
                        <span className="text-xs font-semibold text-muted">Notes</span>
                        <input
                          value={exclusionState.notes}
                          onChange={(event) => updateExclusion(row.memberId, { notes: event.target.value })}
                          className="h-10 w-full rounded-lg border border-border px-3"
                          placeholder="Optional note"
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white p-3">
        <p className="text-sm text-muted">
          Only exceptions need action. Eligible riders stay included by default.
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={isPending || props.rows.length === 0}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Posting Run..." : "Post Transportation Run"}
        </button>
      </div>
    </div>
  );
}
