"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  recordPrnOutcomeAction,
  recordPrnMarAdministrationAction,
  recordScheduledMarAdministrationAction
} from "@/app/(portal)/health/mar/administration-actions";
import type {
  MarAdministrationHistoryRow,
  MarNotGivenReason,
  MarPrnOutcome,
  MarPrnOption,
  MarTodayRow
} from "@/lib/services/mar-shared";
import { MAR_NOT_GIVEN_REASON_OPTIONS } from "@/lib/services/mar-shared";
import { EASTERN_TIME_ZONE, toEasternDateTimeLocal } from "@/lib/timezone";
import { formatDateTime } from "@/lib/utils";

type MarBoardView = "today" | "overdue" | "not-given" | "history" | "prn-log";
type PrnFilterView = "all" | "awaiting" | "effective" | "ineffective";
type TimingState = "early" | "due" | "late" | "overdue";

type MemberMedPassSummary = {
  memberId: string;
  memberName: string;
  memberPhotoUrl: string | null;
  dueCount: number;
  overdueCount: number;
  completedCount: number;
  notGivenCount: number;
  scheduledCount: number;
  nextDueTime: string | null;
};

const EARLY_WARNING_MINUTES = 30;
const LATE_WARNING_MINUTES = 60;
const OVERDUE_WARNING_MINUTES = 120;

function initialsFromName(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function toMinutesFromScheduled(scheduledTimeIso: string, nowMs: number) {
  const scheduledAtMs = new Date(scheduledTimeIso).getTime();
  if (Number.isNaN(scheduledAtMs)) return 0;
  return Math.round((nowMs - scheduledAtMs) / 60000);
}

function getTimingState(scheduledTimeIso: string, nowMs: number): TimingState {
  const deltaMinutes = toMinutesFromScheduled(scheduledTimeIso, nowMs);
  if (deltaMinutes < -EARLY_WARNING_MINUTES) return "early";
  if (deltaMinutes > OVERDUE_WARNING_MINUTES) return "overdue";
  if (deltaMinutes > LATE_WARNING_MINUTES) return "late";
  return "due";
}

function formatEasternTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function timingBadgeLabel(scheduledTimeIso: string, nowMs: number) {
  const deltaMinutes = toMinutesFromScheduled(scheduledTimeIso, nowMs);
  const state = getTimingState(scheduledTimeIso, nowMs);
  if (state === "early") return `Early (${Math.abs(deltaMinutes)}m before)`;
  if (state === "overdue") return `Overdue (${deltaMinutes}m late)`;
  if (state === "late") return `Late (${deltaMinutes}m)`;
  if (deltaMinutes >= 0) return `Due now (${deltaMinutes}m)`;
  return `Due in ${Math.abs(deltaMinutes)}m`;
}

function buildTimingWarning(scheduledTimeIso: string, nowMs: number) {
  const deltaMinutes = toMinutesFromScheduled(scheduledTimeIso, nowMs);
  if (deltaMinutes < -EARLY_WARNING_MINUTES) {
    return `This documentation is ${Math.abs(deltaMinutes)} minutes before scheduled time. Continue?`;
  }
  if (deltaMinutes > LATE_WARNING_MINUTES) {
    return `This documentation is ${deltaMinutes} minutes after scheduled time. Continue?`;
  }
  return null;
}

function timingBadgeClass(state: TimingState) {
  if (state === "early") return "border-sky-200 bg-sky-50 text-sky-700";
  if (state === "late") return "border-amber-200 bg-amber-50 text-amber-800";
  if (state === "overdue") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function MedicationLabel({ dose, route }: { dose: string | null; route: string | null }) {
  const detail = [dose, route].filter(Boolean).join(" | ");
  if (!detail) return null;
  return <p className="text-xs text-muted">{detail}</p>;
}

function MemberAvatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  if (photoUrl) {
    return <img src={photoUrl} alt={`${name} profile`} className="h-9 w-9 rounded-full border border-border object-cover" />;
  }
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-slate-100 text-xs font-semibold text-slate-700">
      {initialsFromName(name)}
    </div>
  );
}

function HistoryCardRow({ row }: { row: MarAdministrationHistoryRow }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-sm font-semibold">{row.memberName}</p>
      <p className="text-sm">{row.medicationName}</p>
      <MedicationLabel dose={row.dose} route={row.route} />
      <p className="mt-1 text-xs text-muted">
        {row.source === "prn" ? "PRN" : "Scheduled"} | {row.status} | {formatDateTime(row.administeredAt)}
      </p>
      {row.notGivenReason ? <p className="text-xs text-rose-700">Reason: {row.notGivenReason}</p> : null}
      {row.prnReason ? <p className="text-xs text-muted">PRN reason: {row.prnReason}</p> : null}
      {row.prnOutcome ? (
        <p className={`text-xs ${row.prnOutcome === "Ineffective" ? "text-rose-700" : "text-emerald-700"}`}>
          PRN outcome: {row.prnOutcome}
        </p>
      ) : row.source === "prn" ? (
        <p className="text-xs text-amber-700">PRN outcome: Outcome Due</p>
      ) : null}
      {row.prnOutcomeAssessedAt ? <p className="text-xs text-muted">Outcome assessed: {formatDateTime(row.prnOutcomeAssessedAt)}</p> : null}
      {row.prnFollowupNote ? <p className="text-xs text-muted">Follow-up: {row.prnFollowupNote}</p> : null}
      {row.notes ? <p className="text-xs text-muted">Notes: {row.notes}</p> : null}
      <p className="text-xs text-muted">Nurse: {row.administeredBy}</p>
      <p className="text-xs text-muted">Updated: {formatDateTime(row.updatedAt)}</p>
    </div>
  );
}

function NotGivenCardRow({ row }: { row: MarAdministrationHistoryRow }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
      <p className="text-sm font-semibold">{row.memberName}</p>
      <p className="text-sm">{row.medicationName}</p>
      <MedicationLabel dose={row.dose} route={row.route} />
      <p className="mt-1 text-xs text-muted">Documented: {formatDateTime(row.administeredAt)}</p>
      <p className="text-xs text-rose-700">Reason: {row.notGivenReason ?? "Not Given"}</p>
      {row.notes ? <p className="text-xs text-muted">Note: {row.notes}</p> : null}
    </div>
  );
}

export function MarWorkflowBoard({
  canDocument,
  todayRows,
  overdueRows,
  notGivenRows,
  historyRows,
  prnRows,
  prnAwaitingOutcomeRows,
  prnEffectiveRows,
  prnIneffectiveRows,
  prnMedicationOptions
}: {
  canDocument: boolean;
  todayRows: MarTodayRow[];
  overdueRows: MarTodayRow[];
  notGivenRows: MarAdministrationHistoryRow[];
  historyRows: MarAdministrationHistoryRow[];
  prnRows: MarAdministrationHistoryRow[];
  prnAwaitingOutcomeRows: MarAdministrationHistoryRow[];
  prnEffectiveRows: MarAdministrationHistoryRow[];
  prnIneffectiveRows: MarAdministrationHistoryRow[];
  prnMedicationOptions: MarPrnOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [view, setView] = useState<MarBoardView>("today");
  const [prnFilter, setPrnFilter] = useState<PrnFilterView>("awaiting");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [notGivenOpenForScheduleId, setNotGivenOpenForScheduleId] = useState<string | null>(null);
  const [notGivenReason, setNotGivenReason] = useState<MarNotGivenReason>("Refused");
  const [notGivenNote, setNotGivenNote] = useState("");

  const [selectedPrnMedicationId, setSelectedPrnMedicationId] = useState(prnMedicationOptions[0]?.pofMedicationId ?? "");
  const [prnReason, setPrnReason] = useState("");
  const [prnNotes, setPrnNotes] = useState("");
  const [prnDateTime, setPrnDateTime] = useState(() => toEasternDateTimeLocal());
  const [prnFormOpen, setPrnFormOpen] = useState(false);

  const [outcomeOpenForAdministrationId, setOutcomeOpenForAdministrationId] = useState<string | null>(null);
  const [prnOutcome, setPrnOutcome] = useState<MarPrnOutcome>("Effective");
  const [prnOutcomeNote, setPrnOutcomeNote] = useState("");
  const [prnOutcomeAssessedDateTime, setPrnOutcomeAssessedDateTime] = useState(() => toEasternDateTimeLocal());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedPrnMedicationId && prnMedicationOptions.length > 0) {
      setSelectedPrnMedicationId(prnMedicationOptions[0].pofMedicationId);
    }
  }, [prnMedicationOptions, selectedPrnMedicationId]);

  const memberSummaries = useMemo(() => {
    const summaryByMember = new Map<string, MemberMedPassSummary>();
    for (const row of todayRows) {
      const timingState = getTimingState(row.scheduledTime, nowMs);
      const current = summaryByMember.get(row.memberId) ?? {
        memberId: row.memberId,
        memberName: row.memberName,
        memberPhotoUrl: row.memberPhotoUrl,
        dueCount: 0,
        overdueCount: 0,
        completedCount: 0,
        notGivenCount: 0,
        scheduledCount: 0,
        nextDueTime: null
      };

      current.scheduledCount += 1;
      if (row.completed) {
        current.completedCount += 1;
        if (row.status === "Not Given") current.notGivenCount += 1;
      } else {
        current.dueCount += 1;
        if (timingState === "overdue") current.overdueCount += 1;
        if (!current.nextDueTime || new Date(row.scheduledTime).getTime() < new Date(current.nextDueTime).getTime()) {
          current.nextDueTime = row.scheduledTime;
        }
      }

      summaryByMember.set(row.memberId, current);
    }

    return Array.from(summaryByMember.values()).sort((left, right) => {
      if (right.overdueCount !== left.overdueCount) return right.overdueCount - left.overdueCount;
      if (right.dueCount !== left.dueCount) return right.dueCount - left.dueCount;
      return left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" });
    });
  }, [nowMs, todayRows]);

  const [selectedMemberId, setSelectedMemberId] = useState<string>(memberSummaries[0]?.memberId ?? "");

  useEffect(() => {
    if (memberSummaries.length === 0) {
      setSelectedMemberId("");
      return;
    }
    if (!selectedMemberId || !memberSummaries.some((summary) => summary.memberId === selectedMemberId)) {
      setSelectedMemberId(memberSummaries[0].memberId);
    }
  }, [memberSummaries, selectedMemberId]);

  const selectedMemberRows = useMemo(
    () =>
      todayRows
        .filter((row) => row.memberId === selectedMemberId)
        .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()),
    [selectedMemberId, todayRows]
  );

  const selectedMember = useMemo(
    () => memberSummaries.find((summary) => summary.memberId === selectedMemberId) ?? null,
    [memberSummaries, selectedMemberId]
  );

  const selectedMemberRowsByScheduledTime = useMemo(() => {
    const grouped = new Map<string, MarTodayRow[]>();
    for (const row of selectedMemberRows) {
      const bucket = grouped.get(row.scheduledTime) ?? [];
      bucket.push(row);
      grouped.set(row.scheduledTime, bucket);
    }
    return Array.from(grouped.entries())
      .map(([scheduledTime, rows]) => ({
        scheduledTime,
        rows: rows.sort((left, right) => left.medicationName.localeCompare(right.medicationName, undefined, { sensitivity: "base" }))
      }))
      .sort((left, right) => new Date(left.scheduledTime).getTime() - new Date(right.scheduledTime).getTime());
  }, [selectedMemberRows]);

  const groupedCounts = useMemo(
    () => ({
      today: todayRows.length,
      overdue: overdueRows.length,
      notGiven: notGivenRows.length,
      history: historyRows.length,
      prn: prnRows.length,
      prnAwaiting: prnAwaitingOutcomeRows.length,
      prnEffective: prnEffectiveRows.length,
      prnIneffective: prnIneffectiveRows.length
    }),
    [
      historyRows.length,
      notGivenRows.length,
      overdueRows.length,
      prnAwaitingOutcomeRows.length,
      prnEffectiveRows.length,
      prnIneffectiveRows.length,
      prnRows.length,
      todayRows.length
    ]
  );

  const documentedToday = todayRows.filter((row) => row.completed).length;
  const prnRowsForFilter =
    prnFilter === "awaiting"
      ? prnAwaitingOutcomeRows
      : prnFilter === "effective"
        ? prnEffectiveRows
        : prnFilter === "ineffective"
          ? prnIneffectiveRows
          : prnRows;

  function withTimingWarning(row: MarTodayRow, onProceed: () => void) {
    const warning = buildTimingWarning(row.scheduledTime, nowMs);
    if (warning && !window.confirm(warning)) return;
    onProceed();
  }

  function cardStateClass(row: MarTodayRow) {
    if (row.status === "Given") return "border-emerald-200 bg-emerald-50";
    if (row.status === "Not Given") return "border-rose-200 bg-rose-50";
    const timingState = getTimingState(row.scheduledTime, nowMs);
    if (timingState === "overdue") return "border-rose-300 bg-rose-50";
    if (timingState === "late") return "border-amber-300 bg-amber-50";
    return "border-border bg-white";
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">MAR Views</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${view === "today" ? "bg-brand text-white" : "border-border"}`} onClick={() => setView("today")}>
            Today&apos;s MAR ({groupedCounts.today})
          </button>
          <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${view === "overdue" ? "bg-brand text-white" : "border-border"}`} onClick={() => setView("overdue")}>
            Overdue ({groupedCounts.overdue})
          </button>
          <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${view === "not-given" ? "bg-brand text-white" : "border-border"}`} onClick={() => setView("not-given")}>
            Not Given ({groupedCounts.notGiven})
          </button>
          <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${view === "prn-log" ? "bg-brand text-white" : "border-border"}`} onClick={() => setView("prn-log")}>
            PRN Outcome Pending ({groupedCounts.prnAwaiting})
          </button>
          <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${view === "history" ? "bg-brand text-white" : "border-border"}`} onClick={() => setView("history")}>
            Administration History ({groupedCounts.history})
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Record PRN Administration</p>
            <p className="text-xs text-muted">PRN medications are documented separately from scheduled med-pass doses.</p>
          </div>
          <button
            type="button"
            disabled={!canDocument}
            className="rounded-lg border border-border px-3 py-1 text-sm font-semibold disabled:opacity-60"
            onClick={() => setPrnFormOpen((current) => !current)}
          >
            {prnFormOpen ? "Hide PRN Form" : "Record PRN"}
          </button>
        </div>

        {prnFormOpen ? (
          <div className="mt-3 grid gap-2">
            <div className="grid gap-2 md:grid-cols-2">
              <select
                className="h-10 rounded border border-border px-2 text-sm"
                value={selectedPrnMedicationId}
                onChange={(event) => setSelectedPrnMedicationId(event.target.value)}
              >
                {prnMedicationOptions.length === 0 ? <option value="">No PRN medications available</option> : null}
                {prnMedicationOptions.map((option) => (
                  <option key={option.pofMedicationId} value={option.pofMedicationId}>
                    {option.memberName} | {option.medicationName}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                className="h-10 rounded border border-border px-2 text-sm"
                value={prnDateTime}
                onChange={(event) => setPrnDateTime(event.target.value)}
              />
              <input
                className="h-10 rounded border border-border px-2 text-sm"
                placeholder="Reason / indication (required)"
                value={prnReason}
                onChange={(event) => setPrnReason(event.target.value)}
              />
              <input
                className="h-10 rounded border border-border px-2 text-sm"
                placeholder="Notes (optional)"
                value={prnNotes}
                onChange={(event) => setPrnNotes(event.target.value)}
              />
            </div>
            <div>
              <button
                type="button"
                disabled={isPending || !canDocument || !selectedPrnMedicationId || !prnReason.trim()}
                className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={() =>
                  startTransition(async () => {
                    const parsed = new Date(prnDateTime);
                    const administeredAtIso = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
                    const result = await recordPrnMarAdministrationAction({
                      pofMedicationId: selectedPrnMedicationId,
                      prnReason,
                      notes: prnNotes,
                      administeredAtIso
                    });
                    if (result?.error) {
                      setStatusMessage(`Error: ${result.error}`);
                      return;
                    }
                    setPrnReason("");
                    setPrnNotes("");
                    setStatusMessage("PRN administration saved. Outcome is now due.");
                    router.refresh();
                  })
                }
              >
                Save PRN Administration
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {view === "today" ? (
        <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">Members Due Today</p>
            <p className="text-xs text-muted">
              Documented: <span className="font-semibold">{documentedToday}</span> / {todayRows.length}
            </p>
            <div className="mt-3 space-y-2">
              {memberSummaries.length === 0 ? (
                <div className="rounded-lg border border-border p-3 text-sm text-muted">No scheduled doses due today.</div>
              ) : (
                memberSummaries.map((summary) => {
                  const active = summary.memberId === selectedMemberId;
                  return (
                    <button
                      key={summary.memberId}
                      type="button"
                      className={`w-full rounded-lg border p-2 text-left ${active ? "border-brand bg-brand/5" : "border-border bg-white"}`}
                      onClick={() => setSelectedMemberId(summary.memberId)}
                    >
                      <div className="flex items-center gap-2">
                        <MemberAvatar name={summary.memberName} photoUrl={summary.memberPhotoUrl} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{summary.memberName}</p>
                          <p className="text-xs text-muted">{summary.completedCount}/{summary.scheduledCount} complete</p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                        {summary.overdueCount > 0 ? <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">Overdue {summary.overdueCount}</span> : null}
                        {summary.notGivenCount > 0 ? <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">Not Given {summary.notGivenCount}</span> : null}
                        {summary.dueCount > 0 ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">Due {summary.dueCount}</span> : null}
                        {summary.nextDueTime ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                            Next {formatEasternTime(summary.nextDueTime)}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            {selectedMember ? (
              <div className="mb-3 flex items-center gap-2">
                <MemberAvatar name={selectedMember.memberName} photoUrl={selectedMember.memberPhotoUrl} />
                <div>
                  <p className="text-sm font-semibold">Med Pass: {selectedMember.memberName}</p>
                  <p className="text-xs text-muted">Grouped by scheduled time</p>
                </div>
              </div>
            ) : null}

            {selectedMemberRowsByScheduledTime.length === 0 ? (
              <div className="rounded-lg border border-border p-3 text-sm text-muted">Select a member with scheduled medications due.</div>
            ) : (
              <div className="space-y-3">
                {selectedMemberRowsByScheduledTime.map((group) => (
                  <div key={group.scheduledTime} className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-semibold">{formatEasternTime(group.scheduledTime)}</p>
                      <p className="text-xs text-muted">{group.rows.length} medication{group.rows.length === 1 ? "" : "s"}</p>
                    </div>

                    <div className="space-y-2">
                      {group.rows.map((row) => {
                        const timingState = getTimingState(row.scheduledTime, nowMs);
                        const timingLabel = timingBadgeLabel(row.scheduledTime, nowMs);
                        return (
                          <div key={row.marScheduleId} className={`rounded-lg border p-3 ${cardStateClass(row)}`}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold">{row.medicationName}</p>
                                <MedicationLabel dose={row.dose} route={row.route} />
                                <p className="text-xs text-muted">Scheduled: {formatDateTime(row.scheduledTime)}</p>
                                {row.instructions ? <p className="text-xs text-muted">Instructions: {row.instructions}</p> : null}
                                {!row.completed ? (
                                  <p className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${timingBadgeClass(timingState)}`}>
                                    {timingLabel}
                                  </p>
                                ) : null}
                              </div>

                              {row.completed ? (
                                <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${row.status === "Given" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                                  {row.status} | {row.administeredAt ? formatDateTime(row.administeredAt) : "Time"} | {initialsFromName(row.administeredBy ?? "N")}
                                </div>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={!canDocument || isPending}
                                    className="rounded-lg bg-emerald-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-60"
                                    onClick={() =>
                                      withTimingWarning(row, () => {
                                        startTransition(async () => {
                                          const result = await recordScheduledMarAdministrationAction({
                                            marScheduleId: row.marScheduleId,
                                            status: "Given"
                                          });
                                          if (result?.error) {
                                            setStatusMessage(`Error: ${result.error}`);
                                            return;
                                          }
                                          setStatusMessage("Medication documented as Given.");
                                          router.refresh();
                                        });
                                      })
                                    }
                                  >
                                    Given
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!canDocument || isPending}
                                    className="rounded-lg border border-rose-300 px-3 py-1 text-sm font-semibold text-rose-700 disabled:opacity-60"
                                    onClick={() => {
                                      setNotGivenOpenForScheduleId(row.marScheduleId);
                                      setNotGivenReason("Refused");
                                      setNotGivenNote("");
                                    }}
                                  >
                                    Not Given
                                  </button>
                                </div>
                              )}
                            </div>

                            {notGivenOpenForScheduleId === row.marScheduleId ? (
                              <div className="mt-3 rounded-lg border border-border bg-white p-3">
                                <p className="text-xs font-semibold text-muted">Not Given reason</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {MAR_NOT_GIVEN_REASON_OPTIONS.map((reasonOption) => (
                                    <button
                                      key={reasonOption}
                                      type="button"
                                      className={`rounded-full border px-2 py-1 text-xs font-semibold ${notGivenReason === reasonOption ? "border-brand bg-brand text-white" : "border-border"}`}
                                      onClick={() => setNotGivenReason(reasonOption)}
                                    >
                                      {reasonOption}
                                    </button>
                                  ))}
                                </div>
                                <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto_auto]">
                                  <input
                                    className="h-10 rounded border border-border px-2 text-sm"
                                    placeholder={notGivenReason === "Other" ? "Note required for Other" : "Note (optional)"}
                                    value={notGivenNote}
                                    onChange={(event) => setNotGivenNote(event.target.value)}
                                  />
                                  <button
                                    type="button"
                                    disabled={isPending || (notGivenReason === "Other" && !notGivenNote.trim())}
                                    className="rounded-lg bg-rose-700 px-3 py-1 text-sm font-semibold text-white disabled:opacity-60"
                                    onClick={() =>
                                      withTimingWarning(row, () => {
                                        startTransition(async () => {
                                          const result = await recordScheduledMarAdministrationAction({
                                            marScheduleId: row.marScheduleId,
                                            status: "Not Given",
                                            notGivenReason,
                                            notes: notGivenNote
                                          });
                                          if (result?.error) {
                                            setStatusMessage(`Error: ${result.error}`);
                                            return;
                                          }
                                          setNotGivenOpenForScheduleId(null);
                                          setStatusMessage("Medication documented as Not Given.");
                                          router.refresh();
                                        });
                                      })
                                    }
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-lg border border-border px-3 py-1 text-sm"
                                    onClick={() => setNotGivenOpenForScheduleId(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {view === "overdue" ? (
        <div className="space-y-2">
          {overdueRows.length === 0 ? (
            <div className="rounded-lg border border-border p-3 text-sm text-muted">No overdue medications right now.</div>
          ) : (
            overdueRows.map((row) => (
              <div key={row.marScheduleId} className="rounded-lg border border-rose-300 bg-rose-50 p-3">
                <p className="text-sm font-semibold">{row.memberName}</p>
                <p className="text-sm">{row.medicationName}</p>
                <MedicationLabel dose={row.dose} route={row.route} />
                <p className="text-xs text-rose-700">Scheduled: {formatDateTime(row.scheduledTime)}</p>
                <p className="text-xs text-rose-700">{timingBadgeLabel(row.scheduledTime, nowMs)}</p>
                {row.instructions ? <p className="text-xs text-muted">Instructions: {row.instructions}</p> : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      {view === "not-given" ? (
        <div className="space-y-2">
          {notGivenRows.length === 0 ? (
            <div className="rounded-lg border border-border p-3 text-sm text-muted">No Not Given entries documented today.</div>
          ) : (
            notGivenRows.map((row) => <NotGivenCardRow key={row.id} row={row} />)
          )}
        </div>
      ) : null}

      {view === "history" ? (
        <div className="space-y-2">
          {historyRows.length === 0 ? (
            <div className="rounded-lg border border-border p-3 text-sm text-muted">No administration history available.</div>
          ) : (
            historyRows.map((row) => <HistoryCardRow key={row.id} row={row} />)
          )}
        </div>
      ) : null}

      {view === "prn-log" ? (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">PRN Filters</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${prnFilter === "awaiting" ? "bg-brand text-white" : "border-border"}`} onClick={() => setPrnFilter("awaiting")}>
                Outcome Due ({groupedCounts.prnAwaiting})
              </button>
              <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${prnFilter === "effective" ? "bg-brand text-white" : "border-border"}`} onClick={() => setPrnFilter("effective")}>
                Effective ({groupedCounts.prnEffective})
              </button>
              <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${prnFilter === "ineffective" ? "bg-brand text-white" : "border-border"}`} onClick={() => setPrnFilter("ineffective")}>
                Ineffective ({groupedCounts.prnIneffective})
              </button>
              <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${prnFilter === "all" ? "bg-brand text-white" : "border-border"}`} onClick={() => setPrnFilter("all")}>
                All PRN ({groupedCounts.prn})
              </button>
            </div>
          </div>

          {prnRowsForFilter.length === 0 ? (
            <div className="rounded-lg border border-border p-3 text-sm text-muted">No PRN administrations for this filter.</div>
          ) : (
            prnRowsForFilter.map((row) => (
              <div key={row.id} className="space-y-2">
                <HistoryCardRow row={row} />
                {row.source === "prn" && row.status === "Given" && !row.prnOutcome ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-800">Outcome Due</p>
                    {outcomeOpenForAdministrationId === row.id ? (
                      <div className="mt-2 space-y-2">
                        <div className="grid gap-2 md:grid-cols-3">
                          <select
                            className="h-10 rounded border border-border px-2 text-sm"
                            value={prnOutcome}
                            onChange={(event) => setPrnOutcome(event.target.value as MarPrnOutcome)}
                          >
                            <option value="Effective">Effective</option>
                            <option value="Ineffective">Ineffective</option>
                          </select>
                          <input
                            type="datetime-local"
                            className="h-10 rounded border border-border px-2 text-sm"
                            value={prnOutcomeAssessedDateTime}
                            onChange={(event) => setPrnOutcomeAssessedDateTime(event.target.value)}
                          />
                          <input
                            className="h-10 rounded border border-border px-2 text-sm"
                            placeholder={prnOutcome === "Ineffective" ? "Follow-up note required" : "Follow-up note (optional)"}
                            value={prnOutcomeNote}
                            onChange={(event) => setPrnOutcomeNote(event.target.value)}
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isPending || (prnOutcome === "Ineffective" && !prnOutcomeNote.trim())}
                            className="rounded-lg bg-brand px-3 py-1 text-sm font-semibold text-white disabled:opacity-60"
                            onClick={() =>
                              startTransition(async () => {
                                const parsed = new Date(prnOutcomeAssessedDateTime);
                                const outcomeAssessedAtIso = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
                                const result = await recordPrnOutcomeAction({
                                  administrationId: row.id,
                                  prnOutcome,
                                  prnFollowupNote: prnOutcomeNote,
                                  outcomeAssessedAtIso
                                });
                                if (result?.error) {
                                  setStatusMessage(`Error: ${result.error}`);
                                  return;
                                }
                                setOutcomeOpenForAdministrationId(null);
                                setPrnOutcome("Effective");
                                setPrnOutcomeNote("");
                                setStatusMessage("PRN outcome saved.");
                                router.refresh();
                              })
                            }
                          >
                            Save Outcome
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-border px-3 py-1 text-sm"
                            onClick={() => setOutcomeOpenForAdministrationId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={!canDocument || isPending}
                        className="mt-2 rounded-lg border border-amber-300 px-3 py-1 text-sm font-semibold text-amber-800 disabled:opacity-60"
                        onClick={() => {
                          setOutcomeOpenForAdministrationId(row.id);
                          setPrnOutcome("Effective");
                          setPrnOutcomeNote("");
                          setPrnOutcomeAssessedDateTime(toEasternDateTimeLocal());
                        }}
                      >
                        Document Outcome
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      {statusMessage ? <p className="text-sm text-muted">{statusMessage}</p> : null}
      {!canDocument ? <p className="text-sm text-rose-700">You can view MAR records but cannot document administrations.</p> : null}
      <p className="text-xs text-muted">POF orders remain canonical. MAR administrations are immutable historical events.</p>
    </div>
  );
}
