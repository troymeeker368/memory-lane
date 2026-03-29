"use client";

import { useEffect, useMemo, useState } from "react";

import {
  recordPrnOutcomeAction,
  recordScheduledMarAdministrationAction
} from "@/app/(portal)/health/mar/administration-actions";
import { MarPrnRecordModal } from "@/components/forms/mar-prn-record-modal";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { MutationNotice } from "@/components/ui/mutation-notice";
import type {
  MarAdministrationHistoryRow,
  MarNotGivenReason,
  MarPrnFollowupStatus,
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

function cardStateClass(row: MarTodayRow) {
  if (!row.completed) return "border-border bg-white";
  if (row.status === "Not Given") return "border-rose-200 bg-rose-50";
  return "border-emerald-200 bg-emerald-50";
}

function formatEasternTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatPrnFollowupStatusLabel(value: MarPrnFollowupStatus | null) {
  if (value === "due") return "Follow-up due";
  if (value === "completed") return "Follow-up completed";
  if (value === "overdue") return "Follow-up overdue";
  if (value === "not_required") return "Follow-up not required";
  return null;
}

function statusToneClass(status: MarAdministrationHistoryRow["status"]) {
  if (status === "Given") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Not Given" || status === "Refused" || status === "Held" || status === "Omitted") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-border bg-slate-50 text-slate-700";
}

function MedicationLabel({ dose, route }: { dose: string | null; route: string | null }) {
  const detail = [dose, route].filter(Boolean).join(" | ");
  if (!detail) return null;
  return <p className="text-xs text-muted">{detail}</p>;
}

function MemberAvatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  if (photoUrl) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt={`${name} profile`} className="h-9 w-9 rounded-full border border-border object-cover" />
      </>
    );
  }

  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-slate-100 text-xs font-semibold text-slate-700">
      {initialsFromName(name)}
    </div>
  );
}

function HistoryCardRow({ row }: { row: MarAdministrationHistoryRow }) {
  const followupLabel = formatPrnFollowupStatusLabel(row.followupStatus);
  const outcomeDue =
    row.source === "prn" && row.status === "Given" && row.requiresFollowup && !row.prnOutcome && row.followupStatus !== "completed";

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{row.memberName}</p>
          <p className="text-sm">{row.medicationName}</p>
          <MedicationLabel dose={row.dose} route={row.route} />
        </div>
        <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusToneClass(row.status)}`}>
          {row.source === "prn" ? "PRN" : "Scheduled"} | {row.status}
        </div>
      </div>

      <p className="mt-1 text-xs text-muted">{formatDateTime(row.administeredAt)}</p>
      {row.notGivenReason ? <p className="text-xs text-rose-700">Reason: {row.notGivenReason}</p> : null}
      {row.prnReason ? <p className="text-xs text-muted">Indication: {row.prnReason}</p> : null}
      {row.followupDueAt ? <p className="text-xs text-muted">Follow-up due: {formatDateTime(row.followupDueAt)}</p> : null}
      {followupLabel ? (
        <p className={`text-xs ${row.followupStatus === "overdue" ? "text-rose-700" : row.followupStatus === "completed" ? "text-emerald-700" : "text-amber-700"}`}>
          {followupLabel}
        </p>
      ) : null}
      {row.prnOutcome ? (
        <p className={`text-xs ${row.prnOutcome === "Ineffective" ? "text-rose-700" : "text-emerald-700"}`}>
          Effectiveness: {row.prnOutcome}
        </p>
      ) : outcomeDue ? (
        <p className="text-xs text-amber-700">Effectiveness follow-up still needs to be documented.</p>
      ) : null}
      {row.prnOutcomeAssessedAt ? <p className="text-xs text-muted">Follow-up documented: {formatDateTime(row.prnOutcomeAssessedAt)}</p> : null}
      {row.prnFollowupNote ? <p className="text-xs text-muted">Follow-up note: {row.prnFollowupNote}</p> : null}
      {row.notes ? <p className="text-xs text-muted">Notes: {row.notes}</p> : null}
      <p className="text-xs text-muted">Staff: {row.administeredBy}</p>
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
      <p className="text-xs text-rose-700">Reason: {row.notGivenReason ?? row.status}</p>
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
  prnMedicationOptions,
  memberOptions
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
  memberOptions: Array<{ memberId: string; memberName: string }>;
}) {
  const { isSaving, run } = useScopedMutation();
  const [view, setView] = useState<MarBoardView>("today");
  const [prnFilter, setPrnFilter] = useState<PrnFilterView>("awaiting");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [todayRowsState, setTodayRowsState] = useState(todayRows);
  const [overdueRowsState, setOverdueRowsState] = useState(overdueRows);
  const [notGivenRowsState, setNotGivenRowsState] = useState(notGivenRows);
  const [historyRowsState, setHistoryRowsState] = useState(historyRows);
  const [prnRowsState, setPrnRowsState] = useState(prnRows);
  const [prnAwaitingOutcomeRowsState, setPrnAwaitingOutcomeRowsState] = useState(prnAwaitingOutcomeRows);
  const [prnEffectiveRowsState, setPrnEffectiveRowsState] = useState(prnEffectiveRows);
  const [prnIneffectiveRowsState, setPrnIneffectiveRowsState] = useState(prnIneffectiveRows);

  const [notGivenOpenForScheduleId, setNotGivenOpenForScheduleId] = useState<string | null>(null);
  const [notGivenReason, setNotGivenReason] = useState<MarNotGivenReason>("Refused");
  const [notGivenNote, setNotGivenNote] = useState("");

  const [prnModalOpen, setPrnModalOpen] = useState(false);
  const [outcomeOpenForAdministrationId, setOutcomeOpenForAdministrationId] = useState<string | null>(null);
  const [prnOutcome, setPrnOutcome] = useState<MarPrnOutcome>("Effective");
  const [prnOutcomeNote, setPrnOutcomeNote] = useState("");
  const [prnOutcomeAssessedDateTime, setPrnOutcomeAssessedDateTime] = useState(() => toEasternDateTimeLocal());

  useEffect(() => {
    setTodayRowsState(todayRows);
  }, [todayRows]);

  useEffect(() => {
    setOverdueRowsState(overdueRows);
  }, [overdueRows]);

  useEffect(() => {
    setNotGivenRowsState(notGivenRows);
  }, [notGivenRows]);

  useEffect(() => {
    setHistoryRowsState(historyRows);
  }, [historyRows]);

  useEffect(() => {
    setPrnRowsState(prnRows);
  }, [prnRows]);

  useEffect(() => {
    setPrnAwaitingOutcomeRowsState(prnAwaitingOutcomeRows);
  }, [prnAwaitingOutcomeRows]);

  useEffect(() => {
    setPrnEffectiveRowsState(prnEffectiveRows);
  }, [prnEffectiveRows]);

  useEffect(() => {
    setPrnIneffectiveRowsState(prnIneffectiveRows);
  }, [prnIneffectiveRows]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const memberSummaries = useMemo(() => {
    const summaryByMember = new Map<string, MemberMedPassSummary>();

    for (const row of todayRowsState) {
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
  }, [nowMs, todayRowsState]);

  const [selectedMemberId, setSelectedMemberId] = useState<string>(
    memberSummaries[0]?.memberId ?? memberOptions[0]?.memberId ?? ""
  );

  useEffect(() => {
    const validMemberIds = new Set([
      ...memberSummaries.map((summary) => summary.memberId),
      ...memberOptions.map((option) => option.memberId)
    ]);
    if (validMemberIds.size === 0) {
      setSelectedMemberId("");
      return;
    }
    if (!selectedMemberId || !validMemberIds.has(selectedMemberId)) {
      setSelectedMemberId(memberSummaries[0]?.memberId ?? memberOptions[0]?.memberId ?? "");
    }
  }, [memberOptions, memberSummaries, selectedMemberId]);

  const selectedMemberRows = useMemo(
    () =>
      todayRowsState
        .filter((row) => row.memberId === selectedMemberId)
        .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()),
    [selectedMemberId, todayRowsState]
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
      today: todayRowsState.length,
      overdue: overdueRowsState.length,
      notGiven: notGivenRowsState.length,
      history: historyRowsState.length,
      prn: prnRowsState.length,
      prnAwaiting: prnAwaitingOutcomeRowsState.length,
      prnEffective: prnEffectiveRowsState.length,
      prnIneffective: prnIneffectiveRowsState.length
    }),
    [
      historyRowsState.length,
      notGivenRowsState.length,
      overdueRowsState.length,
      prnAwaitingOutcomeRowsState.length,
      prnEffectiveRowsState.length,
      prnIneffectiveRowsState.length,
      prnRowsState.length,
      todayRowsState.length
    ]
  );

  const documentedToday = todayRowsState.filter((row) => row.completed).length;
  const prnRowsForFilter =
    prnFilter === "awaiting"
      ? prnAwaitingOutcomeRowsState
      : prnFilter === "effective"
        ? prnEffectiveRowsState
        : prnFilter === "ineffective"
          ? prnIneffectiveRowsState
          : prnRowsState;

  function withTimingWarning(row: MarTodayRow, onProceed: () => void) {
    const warning = buildTimingWarning(row.scheduledTime, nowMs);
    if (warning && !window.confirm(warning)) return;
    onProceed();
  }

  function prependUniqueHistory(current: MarAdministrationHistoryRow[], nextRow: MarAdministrationHistoryRow) {
    return [nextRow, ...current.filter((row) => row.id !== nextRow.id)];
  }

  function buildScheduledHistoryRow(
    row: MarTodayRow,
    data: {
      administrationId: string;
      administeredAt: string;
      administeredBy: string;
      status: "Given" | "Not Given";
      notGivenReason: MarNotGivenReason | null;
      notes: string | null;
    }
  ): MarAdministrationHistoryRow {
    return {
      id: data.administrationId,
      memberId: row.memberId,
      memberName: row.memberName,
      medicationOrderId: null,
      pofMedicationId: row.pofMedicationId,
      marScheduleId: row.marScheduleId,
      administrationDate: data.administeredAt.slice(0, 10),
      scheduledTime: row.scheduledTime,
      medicationName: row.medicationName,
      dose: row.dose,
      route: row.route,
      status: data.status,
      notGivenReason: data.notGivenReason,
      prnReason: null,
      prnOutcome: null,
      prnOutcomeAssessedAt: null,
      prnFollowupNote: null,
      followupDueAt: null,
      followupStatus: null,
      requiresFollowup: false,
      notes: data.notes,
      administeredBy: data.administeredBy,
      administeredByUserId: null,
      administeredAt: data.administeredAt,
      source: "scheduled",
      createdAt: data.administeredAt,
      updatedAt: data.administeredAt
    };
  }

  function buildPrnHistoryRow(
    option: MarPrnOption,
    data: {
      administrationId: string;
      administeredAt: string;
      administeredBy: string;
      indication: string;
      status: MarAdministrationHistoryRow["status"];
      doseGiven: string | null;
      routeGiven: string | null;
      followupDueAt: string | null;
      followupStatus: MarPrnFollowupStatus | null;
      notes: string | null;
    }
  ): MarAdministrationHistoryRow {
    return {
      id: data.administrationId,
      memberId: option.memberId,
      memberName: option.memberName,
      medicationOrderId: option.medicationOrderId,
      pofMedicationId: option.pofMedicationId,
      marScheduleId: null,
      administrationDate: data.administeredAt.slice(0, 10),
      scheduledTime: null,
      medicationName: option.medicationName,
      dose: data.doseGiven ?? option.strength,
      route: data.routeGiven ?? option.route,
      status: data.status,
      notGivenReason: null,
      prnReason: data.indication,
      prnOutcome: null,
      prnOutcomeAssessedAt: null,
      prnFollowupNote: null,
      followupDueAt: data.followupDueAt,
      followupStatus: data.followupStatus,
      requiresFollowup: option.requiresEffectivenessFollowup,
      notes: data.notes,
      administeredBy: data.administeredBy,
      administeredByUserId: null,
      administeredAt: data.administeredAt,
      source: "prn",
      createdAt: data.administeredAt,
      updatedAt: data.administeredAt
    };
  }

  function applyScheduledAdministration(
    row: MarTodayRow,
    data: {
      administrationId: string;
      administeredAt: string;
      administeredBy: string;
      status: "Given" | "Not Given";
      notGivenReason: MarNotGivenReason | null;
      notes: string | null;
    }
  ) {
    const historyRow = buildScheduledHistoryRow(row, data);

    setTodayRowsState((current) =>
      current.map((item) =>
        item.marScheduleId === row.marScheduleId
          ? {
              ...item,
              administrationId: data.administrationId,
              status: data.status,
              notGivenReason: data.notGivenReason,
              notes: data.notes,
              administeredBy: data.administeredBy,
              administeredAt: data.administeredAt,
              source: "scheduled",
              completed: true
            }
          : item
      )
    );
    setOverdueRowsState((current) => current.filter((item) => item.marScheduleId !== row.marScheduleId));
    setHistoryRowsState((current) => prependUniqueHistory(current, historyRow));
    if (data.status === "Not Given") {
      setNotGivenRowsState((current) => prependUniqueHistory(current, historyRow));
    }
    setNotGivenOpenForScheduleId(null);
  }

  function applyPrnAdministration(
    option: MarPrnOption,
    data: {
      administrationId: string;
      administeredAt: string;
      administeredBy: string;
      indication: string;
      status: MarAdministrationHistoryRow["status"];
      doseGiven: string | null;
      routeGiven: string | null;
      followupDueAt: string | null;
      followupStatus: MarPrnFollowupStatus | null;
      notes: string | null;
    }
  ) {
    const historyRow = buildPrnHistoryRow(option, data);

    setHistoryRowsState((current) => prependUniqueHistory(current, historyRow));
    setPrnRowsState((current) => prependUniqueHistory(current, historyRow));
    if (historyRow.status === "Given" && (historyRow.followupStatus === "due" || historyRow.followupStatus === "overdue")) {
      setPrnAwaitingOutcomeRowsState((current) => prependUniqueHistory(current, historyRow));
    }
    setSelectedMemberId(option.memberId);
  }

  function applyPrnOutcome(
    administrationId: string,
    data: {
      prnOutcome: MarPrnOutcome;
      prnFollowupNote: string | null;
      outcomeAssessedAt: string;
    }
  ) {
    const updateRow = (row: MarAdministrationHistoryRow) =>
      row.id === administrationId
        ? {
            ...row,
            prnOutcome: data.prnOutcome,
            prnOutcomeAssessedAt: data.outcomeAssessedAt,
            prnFollowupNote: data.prnFollowupNote,
            followupStatus: "completed" as MarPrnFollowupStatus,
            updatedAt: data.outcomeAssessedAt
          }
        : row;

    setHistoryRowsState((current) => current.map(updateRow));
    setPrnRowsState((current) => current.map(updateRow));
    setPrnAwaitingOutcomeRowsState((current) => current.filter((row) => row.id !== administrationId));

    const sourceRow = prnRowsState.find((row) => row.id === administrationId);
    if (!sourceRow) return;
    const updatedRow = updateRow(sourceRow);

    if (data.prnOutcome === "Effective") {
      setPrnEffectiveRowsState((current) => prependUniqueHistory(current, updatedRow));
      setPrnIneffectiveRowsState((current) => current.filter((row) => row.id !== administrationId));
    } else {
      setPrnIneffectiveRowsState((current) => prependUniqueHistory(current, updatedRow));
      setPrnEffectiveRowsState((current) => current.filter((row) => row.id !== administrationId));
    }

    setOutcomeOpenForAdministrationId(null);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Medication Administration</p>
            <p className="text-sm text-muted">Operational MAR board for scheduled doses, PRN documentation, and follow-up tracking.</p>
          </div>
          <button
            type="button"
            disabled={!canDocument}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            onClick={() => setPrnModalOpen(true)}
          >
            Record PRN
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-border bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Scheduled Today</p>
            <p className="mt-1 text-2xl font-semibold">{groupedCounts.today}</p>
            <p className="text-xs text-muted">{documentedToday} documented so far</p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-rose-700">Overdue</p>
            <p className="mt-1 text-2xl font-semibold text-rose-700">{groupedCounts.overdue}</p>
            <p className="text-xs text-rose-700">Past due doses needing attention</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-800">PRN Follow-up Due</p>
            <p className="mt-1 text-2xl font-semibold text-amber-800">{groupedCounts.prnAwaiting}</p>
            <p className="text-xs text-amber-800">Given PRNs still awaiting effectiveness review</p>
          </div>
          <div className="rounded-xl border border-border bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Not Given Today</p>
            <p className="mt-1 text-2xl font-semibold">{groupedCounts.notGiven}</p>
            <p className="text-xs text-muted">Scheduled doses documented as not given</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { key: "today", label: `Today (${groupedCounts.today})` },
            { key: "overdue", label: `Overdue (${groupedCounts.overdue})` },
            { key: "not-given", label: `Not Given (${groupedCounts.notGiven})` },
            { key: "history", label: `History (${groupedCounts.history})` },
            { key: "prn-log", label: `PRN Log (${groupedCounts.prn})` }
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${view === option.key ? "border-brand bg-brand text-white" : "border-border bg-white"}`}
              onClick={() => setView(option.key as MarBoardView)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {view === "today" ? (
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">Member Queue</p>
                  <p className="text-xs text-muted">Prioritized by overdue and due medication passes.</p>
                </div>
                <button
                  type="button"
                  disabled={!canDocument}
                  className="rounded-lg border border-border px-3 py-1 text-xs font-semibold disabled:opacity-60"
                  onClick={() => setPrnModalOpen(true)}
                >
                  Record PRN
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {memberSummaries.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">
                    No scheduled medications are due right now.
                  </div>
                ) : (
                  memberSummaries.map((summary) => (
                    <button
                      key={summary.memberId}
                      type="button"
                      className={`w-full rounded-xl border p-3 text-left ${selectedMemberId === summary.memberId ? "border-brand bg-brand/5" : "border-border bg-white"}`}
                      onClick={() => setSelectedMemberId(summary.memberId)}
                    >
                      <div className="flex items-start gap-3">
                        <MemberAvatar name={summary.memberName} photoUrl={summary.memberPhotoUrl} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{summary.memberName}</p>
                          <p className="text-xs text-muted">
                            {summary.completedCount}/{summary.scheduledCount} documented
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                              Due {summary.dueCount}
                            </span>
                            <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">
                              Overdue {summary.overdueCount}
                            </span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">
                              Not Given {summary.notGivenCount}
                            </span>
                          </div>
                          {summary.nextDueTime ? <p className="mt-2 text-xs text-muted">Next due: {formatDateTime(summary.nextDueTime)}</p> : null}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-white p-4">
              <p className="text-sm font-semibold">PRN Standing Orders</p>
              <p className="text-xs text-muted">
                {selectedMemberId
                  ? `${prnMedicationOptions.filter((option) => option.memberId === selectedMemberId).length} active PRN option(s) for the selected member.`
                  : `${prnMedicationOptions.length} active PRN option(s) available.`}
              </p>
              <p className="mt-2 text-xs text-muted">
                Standing PRNs only populate from PRN standing orders checked on the member's active signed POF. Use Record PRN to select one of those existing orders, or add a new PRN medication and administer immediately.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-white p-4">
            {selectedMember ? (
              <div className="mb-4 flex items-center gap-3">
                <MemberAvatar name={selectedMember.memberName} photoUrl={selectedMember.memberPhotoUrl} />
                <div>
                  <p className="text-sm font-semibold">{selectedMember.memberName}</p>
                  <p className="text-xs text-muted">Grouped by scheduled time</p>
                </div>
              </div>
            ) : null}

            {selectedMemberRowsByScheduledTime.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">
                Select a member with scheduled medications due.
              </div>
            ) : (
              <div className="space-y-3">
                {selectedMemberRowsByScheduledTime.map((group) => (
                  <div key={group.scheduledTime} className="rounded-xl border border-border p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{formatEasternTime(group.scheduledTime)}</p>
                      <p className="text-xs text-muted">
                        {group.rows.length} medication{group.rows.length === 1 ? "" : "s"}
                      </p>
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
                                <div
                                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                                    row.status === "Given"
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : "border-rose-200 bg-rose-50 text-rose-700"
                                  }`}
                                >
                                  {row.status} | {row.administeredAt ? formatDateTime(row.administeredAt) : "Time"} |{" "}
                                  {initialsFromName(row.administeredBy ?? "N")}
                                </div>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={!canDocument || isSaving}
                                    className="rounded-lg bg-emerald-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-60"
                                    onClick={() =>
                                      withTimingWarning(row, () => {
                                        void run(
                                          async () =>
                                            recordScheduledMarAdministrationAction({
                                              marScheduleId: row.marScheduleId,
                                              status: "Given"
                                            }),
                                          {
                                            successMessage: "Medication documented as Given.",
                                            fallbackData: {
                                              administrationId: "",
                                              administeredAt: "",
                                              administeredBy: "",
                                              status: "Given" as const,
                                              notGivenReason: null as MarNotGivenReason | null,
                                              notes: null as string | null
                                            },
                                            onSuccess: async (result) => {
                                              applyScheduledAdministration(row, result.data);
                                              setStatusMessage(result.message);
                                            },
                                            onError: async (result) => {
                                              setStatusMessage(`Error: ${result.error}`);
                                            }
                                          }
                                        );
                                      })
                                    }
                                  >
                                    Given
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!canDocument || isSaving}
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
                                    disabled={isSaving || (notGivenReason === "Other" && !notGivenNote.trim())}
                                    className="rounded-lg bg-rose-700 px-3 py-1 text-sm font-semibold text-white disabled:opacity-60"
                                    onClick={() =>
                                      withTimingWarning(row, () => {
                                        void run(
                                          async () =>
                                            recordScheduledMarAdministrationAction({
                                              marScheduleId: row.marScheduleId,
                                              status: "Not Given",
                                              notGivenReason,
                                              notes: notGivenNote
                                            }),
                                          {
                                            successMessage: "Medication documented as Not Given.",
                                            fallbackData: {
                                              administrationId: "",
                                              administeredAt: "",
                                              administeredBy: "",
                                              status: "Not Given" as const,
                                              notGivenReason: null as MarNotGivenReason | null,
                                              notes: null as string | null
                                            },
                                            onSuccess: async (result) => {
                                              applyScheduledAdministration(row, result.data);
                                              setStatusMessage(result.message);
                                            },
                                            onError: async (result) => {
                                              setStatusMessage(`Error: ${result.error}`);
                                            }
                                          }
                                        );
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
          {overdueRowsState.length === 0 ? (
            <div className="rounded-lg border border-border bg-white p-3 text-sm text-muted">No overdue medications right now.</div>
          ) : (
            overdueRowsState.map((row) => (
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
          {notGivenRowsState.length === 0 ? (
            <div className="rounded-lg border border-border bg-white p-3 text-sm text-muted">No Not Given entries documented today.</div>
          ) : (
            notGivenRowsState.map((row) => <NotGivenCardRow key={row.id} row={row} />)
          )}
        </div>
      ) : null}

      {view === "history" ? (
        <div className="space-y-2">
          {historyRowsState.length === 0 ? (
            <div className="rounded-lg border border-border bg-white p-3 text-sm text-muted">No administration history available.</div>
          ) : (
            historyRowsState.map((row) => <HistoryCardRow key={row.id} row={row} />)
          )}
        </div>
      ) : null}

      {view === "prn-log" ? (
        <div className="space-y-2">
          <div className="rounded-2xl border border-border bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">PRN Follow-up Queue</p>
                <p className="text-xs text-muted">Track new PRN administrations, held or refused PRNs, and effectiveness follow-up.</p>
              </div>
              <button
                type="button"
                disabled={!canDocument}
                className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={() => setPrnModalOpen(true)}
              >
                Record PRN
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-lg border px-3 py-1 text-sm ${prnFilter === "awaiting" ? "bg-brand text-white" : "border-border"}`}
                onClick={() => setPrnFilter("awaiting")}
              >
                Follow-up Due ({groupedCounts.prnAwaiting})
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-1 text-sm ${prnFilter === "effective" ? "bg-brand text-white" : "border-border"}`}
                onClick={() => setPrnFilter("effective")}
              >
                Effective ({groupedCounts.prnEffective})
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-1 text-sm ${prnFilter === "ineffective" ? "bg-brand text-white" : "border-border"}`}
                onClick={() => setPrnFilter("ineffective")}
              >
                Ineffective ({groupedCounts.prnIneffective})
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-1 text-sm ${prnFilter === "all" ? "bg-brand text-white" : "border-border"}`}
                onClick={() => setPrnFilter("all")}
              >
                All PRN ({groupedCounts.prn})
              </button>
            </div>
          </div>

          {prnRowsForFilter.length === 0 ? (
            <div className="rounded-lg border border-border bg-white p-3 text-sm text-muted">No PRN administrations for this filter.</div>
          ) : (
            prnRowsForFilter.map((row) => (
              <div key={row.id} className="space-y-2">
                <HistoryCardRow row={row} />
                {row.source === "prn" && row.status === "Given" && row.requiresFollowup && !row.prnOutcome ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-800">
                      {row.followupStatus === "overdue" ? "Follow-up Overdue" : "Follow-up Due"}
                    </p>
                    {row.followupDueAt ? <p className="mt-1 text-xs text-amber-800">Due by {formatDateTime(row.followupDueAt)}</p> : null}
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
                            disabled={isSaving || (prnOutcome === "Ineffective" && !prnOutcomeNote.trim())}
                            className="rounded-lg bg-brand px-3 py-1 text-sm font-semibold text-white disabled:opacity-60"
                            onClick={() =>
                              void run(
                                async () => {
                                  const parsed = new Date(prnOutcomeAssessedDateTime);
                                  const outcomeAssessedAtIso = Number.isNaN(parsed.getTime())
                                    ? new Date().toISOString()
                                    : parsed.toISOString();
                                  return recordPrnOutcomeAction({
                                    administrationId: row.id,
                                    prnOutcome,
                                    prnFollowupNote: prnOutcomeNote,
                                    outcomeAssessedAtIso
                                  });
                                },
                                {
                                  successMessage: "PRN effectiveness follow-up saved.",
                                  fallbackData: {
                                    administrationId: row.id,
                                    prnOutcome,
                                    prnFollowupNote: prnOutcomeNote,
                                    outcomeAssessedAt: new Date().toISOString()
                                  },
                                  onSuccess: async (result) => {
                                    applyPrnOutcome(row.id, result.data);
                                    setStatusMessage(result.message);
                                  },
                                  onError: async (result) => {
                                    setStatusMessage(`Error: ${result.error}`);
                                  }
                                }
                              )
                            }
                          >
                            Save Follow-up
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
                        disabled={!canDocument || isSaving}
                        className="mt-2 rounded-lg border border-amber-300 px-3 py-1 text-sm font-semibold text-amber-800 disabled:opacity-60"
                        onClick={() => {
                          setOutcomeOpenForAdministrationId(row.id);
                          setPrnOutcome("Effective");
                          setPrnOutcomeNote("");
                          setPrnOutcomeAssessedDateTime(toEasternDateTimeLocal());
                        }}
                      >
                        Document Follow-up
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      <MutationNotice kind={statusMessage?.startsWith("Error") ? "error" : "success"} message={statusMessage} />
      {!canDocument ? <p className="text-sm text-rose-700">You can view MAR records but cannot document administrations.</p> : null}
      <p className="text-xs text-muted">
        Medication orders and PRN administration logs are the audit trail for PRN activity. Scheduled MAR administrations remain immutable historical events.
      </p>

      <MarPrnRecordModal
        open={prnModalOpen}
        onClose={() => setPrnModalOpen(false)}
        canDocument={canDocument}
        memberOptions={memberOptions}
        orderOptions={prnMedicationOptions}
        defaultMemberId={selectedMemberId}
        onSaved={(option, data) => {
          applyPrnAdministration(option, {
            administrationId: data.administrationId,
            administeredAt: data.administeredAt,
            administeredBy: data.administeredBy,
            indication: data.indication,
            status: data.status,
            doseGiven: data.doseGiven,
            routeGiven: data.routeGiven,
            followupDueAt: data.followupDueAt,
            followupStatus: (data.followupStatus as MarPrnFollowupStatus | null) ?? null,
            notes: data.notes
          });
        }}
        onStatusMessage={setStatusMessage}
      />
    </div>
  );
}
