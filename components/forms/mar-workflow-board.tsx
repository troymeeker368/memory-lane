"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  recordPrnOutcomeAction,
  recordPrnMarAdministrationAction,
  recordScheduledMarAdministrationAction
} from "@/app/(portal)/health/mar/actions";
import type {
  MarAdministrationHistoryRow,
  MarNotGivenReason,
  MarPrnOutcome,
  MarPrnOption,
  MarTodayRow
} from "@/lib/services/mar-shared";
import { MAR_NOT_GIVEN_REASON_OPTIONS } from "@/lib/services/mar-shared";
import { toEasternDateTimeLocal } from "@/lib/timezone";
import { formatDateTime } from "@/lib/utils";

type MarBoardView = "today" | "not-given" | "history" | "prn-log";
type PrnFilterView = "all" | "awaiting" | "effective" | "ineffective";

function MedicationLabel({ dose, route }: { dose: string | null; route: string | null }) {
  const detail = [dose, route].filter(Boolean).join(" | ");
  if (!detail) return null;
  return <p className="text-xs text-muted">{detail}</p>;
}

function NotGivenCardRow({ row }: { row: MarAdministrationHistoryRow }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-sm font-semibold">{row.memberName}</p>
      <p className="text-sm">{row.medicationName}</p>
      <MedicationLabel dose={row.dose} route={row.route} />
      <p className="mt-1 text-xs text-muted">Documented: {formatDateTime(row.administeredAt)}</p>
      <p className="text-xs text-rose-700">Reason: {row.notGivenReason ?? "Not Given"}</p>
      {row.notes ? <p className="text-xs text-muted">Note: {row.notes}</p> : null}
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

export function MarWorkflowBoard({
  canDocument,
  todayRows,
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

  const [notGivenOpenForScheduleId, setNotGivenOpenForScheduleId] = useState<string | null>(null);
  const [notGivenReason, setNotGivenReason] = useState<MarNotGivenReason>("Refused");
  const [notGivenNote, setNotGivenNote] = useState("");

  const [selectedPrnMedicationId, setSelectedPrnMedicationId] = useState(prnMedicationOptions[0]?.pofMedicationId ?? "");
  const [prnReason, setPrnReason] = useState("");
  const [prnNotes, setPrnNotes] = useState("");
  const [prnDateTime, setPrnDateTime] = useState(() => toEasternDateTimeLocal());
  const [outcomeOpenForAdministrationId, setOutcomeOpenForAdministrationId] = useState<string | null>(null);
  const [prnOutcome, setPrnOutcome] = useState<MarPrnOutcome>("Effective");
  const [prnOutcomeNote, setPrnOutcomeNote] = useState("");
  const [prnOutcomeAssessedDateTime, setPrnOutcomeAssessedDateTime] = useState(() => toEasternDateTimeLocal());

  const groupedCounts = useMemo(
    () => ({
      today: todayRows.length,
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

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">MAR Views</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${view === "today" ? "bg-brand text-white" : "border-border"}`} onClick={() => setView("today")}>
            Today&apos;s MAR ({groupedCounts.today})
          </button>
          <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${view === "not-given" ? "bg-brand text-white" : "border-border"}`} onClick={() => setView("not-given")}>
            Not Given Today ({groupedCounts.notGiven})
          </button>
          <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${view === "history" ? "bg-brand text-white" : "border-border"}`} onClick={() => setView("history")}>
            Administration History ({groupedCounts.history})
          </button>
          <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${view === "prn-log" ? "bg-brand text-white" : "border-border"}`} onClick={() => setView("prn-log")}>
            PRN Log ({groupedCounts.prn})
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">PRN Administration</p>
        <p className="text-xs text-muted">Use for as-needed meds only (active + center-given + PRN from signed POF).</p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
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
            placeholder="Reason given (required)"
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
        <div className="mt-2">
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
                setStatusMessage("PRN administration saved.");
                router.refresh();
              })
            }
          >
            Save PRN Administration
          </button>
        </div>
      </div>

      {view === "today" ? (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-3 text-sm">
            <p>
              Completed today: <span className="font-semibold">{documentedToday}</span> / {todayRows.length}
            </p>
          </div>
          {todayRows.length === 0 ? (
            <div className="rounded-lg border border-border p-3 text-sm text-muted">No scheduled doses due today.</div>
          ) : (
            todayRows.map((row) => (
              <div key={row.marScheduleId} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{row.memberName}</p>
                    <p className="text-sm">{row.medicationName}</p>
                    <MedicationLabel dose={row.dose} route={row.route} />
                    <p className="text-xs text-muted">Scheduled: {formatDateTime(row.scheduledTime)}</p>
                    {row.instructions ? <p className="text-xs text-muted">Instructions: {row.instructions}</p> : null}
                  </div>
                  {row.completed ? (
                    <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      {row.status} | {row.administeredBy ?? "Nurse"}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!canDocument || isPending}
                        className="rounded-lg bg-emerald-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-60"
                        onClick={() =>
                          startTransition(async () => {
                            const result = await recordScheduledMarAdministrationAction({
                              marScheduleId: row.marScheduleId,
                              status: "Given"
                            });
                            if (result?.error) {
                              setStatusMessage(`Error: ${result.error}`);
                              return;
                            }
                            setStatusMessage("MAR administration saved as Given.");
                            router.refresh();
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
                  <div className="mt-3 rounded-lg border border-border bg-slate-50 p-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      <select
                        className="h-10 rounded border border-border px-2 text-sm"
                        value={notGivenReason}
                        onChange={(event) => setNotGivenReason(event.target.value as MarNotGivenReason)}
                      >
                        {MAR_NOT_GIVEN_REASON_OPTIONS.map((reasonOption) => (
                          <option key={reasonOption} value={reasonOption}>
                            {reasonOption}
                          </option>
                        ))}
                      </select>
                      <input
                        className="h-10 rounded border border-border px-2 text-sm"
                        placeholder={notGivenReason === "Other" ? "Note required for Other" : "Note (optional)"}
                        value={notGivenNote}
                        onChange={(event) => setNotGivenNote(event.target.value)}
                      />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={isPending || (notGivenReason === "Other" && !notGivenNote.trim())}
                        className="rounded-lg bg-rose-700 px-3 py-1 text-sm font-semibold text-white disabled:opacity-60"
                        onClick={() =>
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
                            setStatusMessage("MAR administration saved as Not Given.");
                            router.refresh();
                          })
                        }
                      >
                        Save Not Given
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
            <p className="text-sm font-semibold">PRN Outcome Filters</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${prnFilter === "awaiting" ? "bg-brand text-white" : "border-border"}`} onClick={() => setPrnFilter("awaiting")}>
                Given Awaiting Outcome ({groupedCounts.prnAwaiting})
              </button>
              <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${prnFilter === "effective" ? "bg-brand text-white" : "border-border"}`} onClick={() => setPrnFilter("effective")}>
                PRN Effective ({groupedCounts.prnEffective})
              </button>
              <button type="button" className={`rounded-lg border px-3 py-1 text-sm ${prnFilter === "ineffective" ? "bg-brand text-white" : "border-border"}`} onClick={() => setPrnFilter("ineffective")}>
                PRN Ineffective ({groupedCounts.prnIneffective})
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
      <p className="text-xs text-muted">History rows are immutable and remain unchanged when future POF medication updates occur.</p>
    </div>
  );
}
