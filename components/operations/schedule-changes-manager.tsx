"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  setScheduleChangeStatusAction,
  upsertScheduleChangeAction
} from "@/app/(portal)/operations/schedule-changes/actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { Button } from "@/components/ui/button";
import { MutationNotice } from "@/components/ui/mutation-notice";
import {
  SCHEDULE_CHANGE_TYPES,
  SCHEDULE_WEEKDAY_KEYS,
  type ScheduleChangeRow,
  type ScheduleChangeType,
  type ScheduleWeekdayKey
} from "@/lib/services/schedule-changes-shared";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

type MemberOption = {
  id: string;
  displayName: string;
};

type ScheduleChangesManagerProps = {
  members: MemberOption[];
  memberNamesById: Record<string, string>;
  rows: ScheduleChangeRow[];
  memberSchedulesById: Record<string, ScheduleWeekdayKey[]>;
  canEdit: boolean;
  todayDate: string;
};

type EditorState = {
  id: string;
  memberId: string;
  changeType: ScheduleChangeType;
  effectiveStartDate: string;
  effectiveEndDate: string;
  originalDays: ScheduleWeekdayKey[];
  newDays: ScheduleWeekdayKey[];
  suspendBaseSchedule: boolean;
  reason: string;
  notes: string;
};

const WEEKDAY_LABELS: Record<ScheduleWeekdayKey, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri"
};

const CHANGE_TYPE_HELP: Record<ScheduleChangeType, string> = {
  "Scheduled Absence": "Use this when the member is temporarily out and should not be expected on their normal schedule.",
  "Makeup Day": "Use this when the member is coming on an extra day outside the normal schedule.",
  "Day Swap": "Use this when one or more normal days are being replaced by different attendance days.",
  "Temporary Schedule Change": "Use this when the member needs a temporary weekday pattern for a defined time range.",
  "Permanent Schedule Change": "Use this when the recurring base weekday pattern should be updated going forward."
};

function formatDays(days: readonly string[]) {
  if (days.length === 0) return "-";
  return days
    .map((day) => WEEKDAY_LABELS[day as ScheduleWeekdayKey] ?? day)
    .join(", ");
}

function createEmptyEditor(memberId: string, todayDate: string): EditorState {
  return {
    id: "",
    memberId,
    changeType: "Scheduled Absence",
    effectiveStartDate: todayDate,
    effectiveEndDate: todayDate,
    originalDays: [],
    newDays: [],
    suspendBaseSchedule: false,
    reason: "",
    notes: ""
  };
}

function toEditorState(row: ScheduleChangeRow): EditorState {
  return {
    id: row.id,
    memberId: row.member_id,
    changeType: row.change_type,
    effectiveStartDate: row.effective_start_date,
    effectiveEndDate: row.effective_end_date ?? "",
    originalDays: row.original_days,
    newDays: row.new_days,
    suspendBaseSchedule: row.suspend_base_schedule,
    reason: row.reason,
    notes: row.notes ?? ""
  };
}

function sortRows(rows: ScheduleChangeRow[]) {
  return [...rows].sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function ScheduleChangesManager({
  members,
  memberNamesById,
  rows,
  memberSchedulesById,
  canEdit,
  todayDate
}: ScheduleChangesManagerProps) {
  const router = useRouter();
  const { isSaving, run } = useScopedMutation();
  const [localRows, setLocalRows] = useState<ScheduleChangeRow[]>(rows);
  const [localSchedulesById, setLocalSchedulesById] = useState<Record<string, ScheduleWeekdayKey[]>>(memberSchedulesById);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);

  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

  useEffect(() => {
    setLocalSchedulesById(memberSchedulesById);
  }, [memberSchedulesById]);

  const orderedRows = sortRows(localRows);
  const defaultMemberId = members[0]?.id ?? "";
  const selectedCurrentSchedule = editor?.memberId ? localSchedulesById[editor.memberId] ?? [] : [];
  const originalDays = editor ? (editor.id ? editor.originalDays : selectedCurrentSchedule) : [];
  const selectMembers =
    editor && editor.id && editor.memberId && !members.some((member) => member.id === editor.memberId)
      ? [{ id: editor.memberId, displayName: memberNamesById[editor.memberId] ?? "Unknown Member" }, ...members]
      : members;
  const showNewDays = editor ? editor.changeType !== "Scheduled Absence" : false;
  const showEffectiveEndDate = editor ? editor.changeType !== "Permanent Schedule Change" : false;
  const showSuspendBaseSchedule =
    editor?.changeType === "Scheduled Absence" ||
    editor?.changeType === "Day Swap" ||
    editor?.changeType === "Temporary Schedule Change";

  function closeEditor() {
    if (isSaving) return;
    setEditor(null);
    setIsEditorOpen(false);
  }

  function openNewEditor() {
    setFeedback(null);
    setEditor(createEmptyEditor(defaultMemberId, todayDate));
    setIsEditorOpen(true);
  }

  function openEditEditor(row: ScheduleChangeRow) {
    setFeedback(null);
    setEditor(toEditorState(row));
    setIsEditorOpen(true);
  }

  function updateEditor(patch: Partial<EditorState>) {
    setEditor((current) => (current ? { ...current, ...patch } : current));
  }

  function toggleNewDay(day: ScheduleWeekdayKey) {
    setEditor((current) => {
      if (!current) return current;
      const next = current.newDays.includes(day)
        ? current.newDays.filter((entry) => entry !== day)
        : [...current.newDays, day];
      return { ...current, newDays: next };
    });
  }

  function handleChangeType(nextType: ScheduleChangeType) {
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        changeType: nextType,
        effectiveEndDate: nextType === "Permanent Schedule Change" ? "" : current.effectiveEndDate || current.effectiveStartDate,
        newDays: nextType === "Scheduled Absence" ? [] : current.newDays,
        suspendBaseSchedule: nextType === "Permanent Schedule Change" ? false : current.suspendBaseSchedule
      };
    });
  }

  function handleSubmit() {
    if (!editor) return;
    if (!editor.memberId) {
      setFeedback("Member is required.");
      return;
    }
    if (!editor.reason.trim()) {
      setFeedback("Reason is required.");
      return;
    }

    const payload = {
      id: editor.id,
      memberId: editor.memberId,
      changeType: editor.changeType,
      effectiveStartDate: editor.effectiveStartDate,
      effectiveEndDate: showEffectiveEndDate ? editor.effectiveEndDate : "",
      originalDays,
      newDays: showNewDays ? editor.newDays : [],
      suspendBaseSchedule: showSuspendBaseSchedule ? editor.suspendBaseSchedule : false,
      reason: editor.reason,
      notes: editor.notes
    };

    setFeedback(null);
    void run(() => upsertScheduleChangeAction(payload), {
      successMessage: editor.id ? "Schedule change updated." : "Schedule change saved.",
      errorMessage: "Unable to save schedule change.",
      onSuccess: async (result) => {
        const data = (result.data as {
          row?: ScheduleChangeRow;
          memberSchedule?: { memberId: string; days: ScheduleWeekdayKey[] };
        } | null) ?? null;
        const savedRow = data?.row ?? null;
        if (savedRow) {
          setLocalRows((current) =>
            editor.id
              ? current.map((row) => (row.id === savedRow.id ? savedRow : row))
              : [savedRow, ...current.filter((row) => row.id !== savedRow.id)]
          );
        }
        if (data?.memberSchedule) {
          setLocalSchedulesById((current) => ({
            ...current,
            [data.memberSchedule!.memberId]: data.memberSchedule!.days
          }));
        }
        setFeedback(result.message);
        setEditor(null);
        setIsEditorOpen(false);
        router.refresh();
      },
      onError: async (result) => {
        setFeedback(`Error: ${result.error}`);
      }
    });
  }

  function handleStatusChange(id: string, status: "active" | "completed" | "cancelled") {
    setFeedback(null);
    void run(() => setScheduleChangeStatusAction({ id, status }), {
      successMessage: `Schedule change marked as ${status}.`,
      errorMessage: "Unable to update schedule change.",
      onSuccess: async (result) => {
        const data = ((result.data as { row?: ScheduleChangeRow } | null) ?? null)?.row ?? null;
        if (data) {
          setLocalRows((current) => current.map((row) => (row.id === data.id ? data : row)));
        }
        setFeedback(result.message);
        router.refresh();
      },
      onError: async (result) => {
        setFeedback(`Error: ${result.error}`);
      }
    });
  }

  return (
    <div className="space-y-4">
      <MutationNotice kind={feedback?.startsWith("Error") ? "error" : "success"} message={feedback} />

      <div className="rounded-xl border border-border bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-fg">Schedule Change Workflow</p>
            <p className="mt-1 text-sm text-muted">
              Start every new or edited change here. Choose the member, choose the change type once, complete only the matching fields, and save.
            </p>
          </div>
          {canEdit ? (
            <Button type="button" onClick={openNewEditor} disabled={isSaving || members.length === 0}>
              New Schedule Change
            </Button>
          ) : null}
        </div>
        {canEdit && members.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No active members are available for new schedule changes.</p>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-white p-4 table-wrap">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-fg">Schedule Change History ({orderedRows.length})</p>
          <p className="text-xs text-muted">Edits use the same workflow as new entries. Completed and cancelled items remain locked as history.</p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Type</th>
                <th>Range</th>
                <th>Original Days</th>
                <th>New Days</th>
                <th>Status</th>
                <th>Entered By</th>
                <th>Created</th>
                {canEdit ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {orderedRows.map((row) => {
                const memberName = memberNamesById[row.member_id] ?? "Unknown Member";
                return (
                  <tr key={row.id}>
                    <td>{memberName}</td>
                    <td>{row.change_type}</td>
                    <td>
                      {formatDate(row.effective_start_date)}
                      {row.effective_end_date ? ` - ${formatDate(row.effective_end_date)}` : " - Open"}
                    </td>
                    <td>{formatDays(row.original_days)}</td>
                    <td>{formatDays(row.new_days)}</td>
                    <td className="capitalize">{row.status}</td>
                    <td>{row.entered_by}</td>
                    <td>{formatDateTime(row.created_at)}</td>
                    {canEdit ? (
                      <td>
                        <div className="flex flex-wrap gap-2">
                          {row.status === "active" ? (
                            <button
                              type="button"
                              className="rounded border border-border px-2 py-1 text-xs font-semibold"
                              onClick={() => openEditEditor(row)}
                              disabled={isSaving}
                            >
                              Edit
                            </button>
                          ) : null}
                          {row.status !== "active" ? (
                            <button
                              type="button"
                              className="rounded border border-border px-2 py-1 text-xs font-semibold"
                              onClick={() => handleStatusChange(row.id, "active")}
                              disabled={isSaving}
                            >
                              Reopen
                            </button>
                          ) : null}
                          {row.status !== "completed" ? (
                            <button
                              type="button"
                              className="rounded border border-border px-2 py-1 text-xs font-semibold"
                              onClick={() => handleStatusChange(row.id, "completed")}
                              disabled={isSaving}
                            >
                              Complete
                            </button>
                          ) : null}
                          {row.status !== "cancelled" ? (
                            <button
                              type="button"
                              className="rounded border border-danger px-2 py-1 text-xs font-semibold text-danger"
                              onClick={() => handleStatusChange(row.id, "cancelled")}
                              disabled={isSaving}
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {orderedRows.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 9 : 8} className="py-4 text-center text-sm text-muted">
                    No schedule changes logged yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {isEditorOpen && editor ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/35"
          onClick={closeEditor}
          role="presentation"
        >
          <div
            className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-change-editor-title"
          >
            <div className="border-b border-border px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p id="schedule-change-editor-title" className="text-lg font-semibold text-fg">
                    {editor.id ? "Edit Schedule Change" : "New Schedule Change"}
                  </p>
                  <p className="mt-1 text-sm text-muted">{CHANGE_TYPE_HELP[editor.changeType]}</p>
                </div>
                <button
                  type="button"
                  className="rounded border border-border px-3 py-2 text-sm font-semibold"
                  onClick={closeEditor}
                  disabled={isSaving}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="text-xs font-semibold text-muted">Member</span>
                  <select
                    value={editor.memberId}
                    onChange={(event) => updateEditor({ memberId: event.target.value })}
                    disabled={isSaving || Boolean(editor.id)}
                    className={cn(
                      "h-11 w-full rounded-lg border border-border px-3",
                      editor.id ? "bg-slate-50 text-muted" : ""
                    )}
                  >
                    <option value="" disabled>Select member</option>
                    {selectMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                  {editor.id ? (
                    <span className="block text-[11px] text-muted">Member stays fixed when editing so the history remains tied to the same record.</span>
                  ) : null}
                </label>

                <label className="space-y-1 text-sm">
                  <span className="text-xs font-semibold text-muted">Change Type</span>
                  <select
                    value={editor.changeType}
                    onChange={(event) => handleChangeType(event.target.value as ScheduleChangeType)}
                    disabled={isSaving}
                    className="h-11 w-full rounded-lg border border-border px-3"
                  >
                    {SCHEDULE_CHANGE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-sm">
                  <span className="text-xs font-semibold text-muted">Effective Start Date</span>
                  <input
                    type="date"
                    value={editor.effectiveStartDate}
                    onChange={(event) => updateEditor({ effectiveStartDate: event.target.value })}
                    disabled={isSaving}
                    className="h-11 w-full rounded-lg border border-border px-3"
                  />
                </label>

                {showEffectiveEndDate ? (
                  <label className="space-y-1 text-sm">
                    <span className="text-xs font-semibold text-muted">Effective End Date</span>
                    <input
                      type="date"
                      value={editor.effectiveEndDate}
                      onChange={(event) => updateEditor({ effectiveEndDate: event.target.value })}
                      disabled={isSaving}
                      className="h-11 w-full rounded-lg border border-border px-3"
                    />
                  </label>
                ) : (
                  <div className="rounded-lg border border-border bg-slate-50 p-3 text-sm">
                    <p className="text-xs font-semibold text-muted">Effective End Date</p>
                    <p className="mt-1 font-semibold text-fg">Permanent change</p>
                    <p className="mt-1 text-xs text-muted">Permanent changes stay open because they update the recurring weekday pattern.</p>
                  </div>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-[#f8fbff] p-3 text-sm">
                  <p className="text-xs font-semibold text-muted">Current Base Schedule</p>
                  <p className="mt-1 font-semibold text-fg">{formatDays(selectedCurrentSchedule)}</p>
                </div>
                <div className="rounded-lg border border-border bg-[#f8fbff] p-3 text-sm">
                  <p className="text-xs font-semibold text-muted">{editor.id ? "Original Days On This Change" : "Original Days That Will Be Saved"}</p>
                  <p className="mt-1 font-semibold text-fg">{formatDays(originalDays)}</p>
                </div>
              </div>

              {showNewDays ? (
                <fieldset className="rounded-lg border border-border p-3 text-sm">
                  <legend className="px-1 text-xs font-semibold text-muted">New Days</legend>
                  <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {SCHEDULE_WEEKDAY_KEYS.map((day) => (
                      <label key={day} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                        <input
                          type="checkbox"
                          checked={editor.newDays.includes(day)}
                          onChange={() => toggleNewDay(day)}
                          disabled={isSaving}
                        />
                        <span>{WEEKDAY_LABELS[day]}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {showSuspendBaseSchedule ? (
                <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={editor.suspendBaseSchedule}
                    onChange={(event) => updateEditor({ suspendBaseSchedule: event.target.checked })}
                    disabled={isSaving}
                  />
                  <span className="font-semibold text-muted">Suspend the normal schedule during the effective range</span>
                </label>
              ) : null}

              <label className="space-y-1 text-sm">
                <span className="text-xs font-semibold text-muted">Reason</span>
                <input
                  value={editor.reason}
                  onChange={(event) => updateEditor({ reason: event.target.value })}
                  disabled={isSaving}
                  placeholder="Reason for change"
                  className="h-11 w-full rounded-lg border border-border px-3"
                />
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-xs font-semibold text-muted">Notes</span>
                <textarea
                  value={editor.notes}
                  onChange={(event) => updateEditor({ notes: event.target.value })}
                  disabled={isSaving}
                  rows={4}
                  className="w-full rounded-lg border border-border px-3 py-2"
                />
              </label>
            </div>

            <div className="border-t border-border px-5 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted">
                  Permanent changes update the member&apos;s recurring weekdays and keep this schedule change as the historical record.
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
                    onClick={closeEditor}
                    disabled={isSaving}
                  >
                    Cancel
                  </button>
                  <Button type="button" onClick={handleSubmit} disabled={isSaving}>
                    {isSaving ? "Saving..." : editor.id ? "Save Changes" : "Save Schedule Change"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
