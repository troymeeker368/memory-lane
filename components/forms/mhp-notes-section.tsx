"use client";

import { type FormEvent, useMemo, useState, useTransition } from "react";

import {
  addMhpNoteInlineAction,
  deleteMhpNoteInlineAction,
  updateMhpNoteInlineAction
} from "@/app/(portal)/health/member-health-profiles/note-actions";
import { MhpEditModal } from "@/components/forms/mhp-edit-modal";
import { formatDateTime } from "@/lib/utils";

type NoteRow = {
  id: string;
  note_type: string;
  note_text: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export function MhpNotesSection({
  memberId,
  initialRows,
  noteTypeOptions
}: {
  memberId: string;
  initialRows: NoteRow[];
  noteTypeOptions: readonly string[];
}) {
  const [rows, setRows] = useState<NoteRow[]>(initialRows);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  const [newNoteType, setNewNoteType] = useState(noteTypeOptions[0] ?? "General");
  const [newNoteText, setNewNoteText] = useState("");
  const [editingRow, setEditingRow] = useState<NoteRow | null>(null);
  const [editNoteType, setEditNoteType] = useState(noteTypeOptions[0] ?? "General");
  const [editNoteText, setEditNoteText] = useState("");

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const aAt = Date.parse(a.created_at);
        const bAt = Date.parse(b.created_at);
        return bAt - aAt;
      }),
    [rows]
  );

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("noteType", newNoteType);
      formData.set("noteText", newNoteText);
      const result = await addMhpNoteInlineAction(formData);
      if (!result.ok || !result.row) {
        setStatus(result.error ?? "Unable to add note.");
        return;
      }
      setRows((current) => [result.row as NoteRow, ...current]);
      setNewNoteType(noteTypeOptions[0] ?? "General");
      setNewNoteText("");
      setStatus("Note added.");
    });
  };

  const openEdit = (row: NoteRow) => {
    setEditingRow(row);
    setEditNoteType(noteTypeOptions.includes(row.note_type) ? row.note_type : (noteTypeOptions[0] ?? "General"));
    setEditNoteText(row.note_text);
  };

  const handleEditSave = () => {
    if (!editingRow) return;
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("noteId", editingRow.id);
      formData.set("noteType", editNoteType);
      formData.set("noteText", editNoteText);

      const result = await updateMhpNoteInlineAction(formData);
      if (!result.ok || !result.row) {
        setStatus(result.error ?? "Unable to update note.");
        return;
      }
      setRows((current) => current.map((row) => (row.id === editingRow.id ? (result.row as NoteRow) : row)));
      setEditingRow(null);
      setStatus("Note updated.");
    });
  };

  const handleDelete = (noteId: string) => {
    if (!window.confirm("Delete this note?")) return;
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("noteId", noteId);
      const result = await deleteMhpNoteInlineAction(formData);
      if (!result.ok) {
        setStatus(result.error ?? "Unable to delete note.");
        return;
      }
      setRows((current) => current.filter((row) => row.id !== noteId));
      setStatus("Note deleted.");
    });
  };

  return (
    <>
      <table className="mt-3">
        <thead>
          <tr>
            <th>Type</th>
            <th>Text</th>
            <th>Created By</th>
            <th>Created</th>
            <th>Edit</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.slice(0, 25).map((row) => (
            <tr key={row.id}>
              <td>{row.note_type}</td>
              <td>{row.note_text}</td>
              <td>{row.created_by_name ?? "-"}</td>
              <td>{formatDateTime(row.created_at)}</td>
              <td>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-xs"
                  onClick={() => openEdit(row)}
                  disabled={isPending}
                >
                  Edit
                </button>
              </td>
              <td>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-xs"
                  onClick={() => handleDelete(row.id)}
                  disabled={isPending}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={handleAdd} className="mt-3 grid gap-2 md:grid-cols-3">
        <select value={newNoteType} onChange={(event) => setNewNoteType(event.target.value)} className="h-10 rounded-lg border border-border px-3">
          {noteTypeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <textarea value={newNoteText} onChange={(event) => setNewNoteText(event.target.value)} placeholder="Note text" className="min-h-20 rounded-lg border border-border p-3 text-sm" required />
        <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white" disabled={isPending}>
          {isPending ? "Saving..." : "Add Note"}
        </button>
      </form>
      {status ? <p className="mt-2 text-xs text-muted">{status}</p> : null}
      <MhpEditModal open={Boolean(editingRow)} title="Edit Note" onClose={() => setEditingRow(null)}>
        <div className="space-y-3">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Note Type</span>
            <select value={editNoteType} onChange={(event) => setEditNoteType(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3">
              {noteTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Note Text</span>
            <textarea value={editNoteText} onChange={(event) => setEditNoteText(event.target.value)} className="min-h-24 w-full rounded-lg border border-border p-3 text-sm" />
          </label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded border border-border px-3 py-2 text-sm" onClick={() => setEditingRow(null)}>
            Cancel
          </button>
          <button type="button" className="rounded bg-brand px-3 py-2 text-sm font-semibold text-white" onClick={handleEditSave} disabled={isPending}>
            Save
          </button>
        </div>
      </MhpEditModal>
    </>
  );
}
