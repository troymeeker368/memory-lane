"use client";

import { type FormEvent, useMemo, useState, useTransition } from "react";

import {
  addMhpDiagnosisInlineAction,
  deleteMhpDiagnosisInlineAction,
  updateMhpDiagnosisInlineAction
} from "@/app/(portal)/health/member-health-profiles/diagnosis-actions";
import { MhpEditModal } from "@/components/forms/mhp-edit-modal";
import { toEasternDate } from "@/lib/timezone";
import { formatDate } from "@/lib/utils";

type DiagnosisRow = {
  id: string;
  diagnosis_type: "primary" | "secondary";
  diagnosis_name: string;
  date_added: string;
};

export function MhpDiagnosesSection({
  memberId,
  initialRows
}: {
  memberId: string;
  initialRows: DiagnosisRow[];
}) {
  const [rows, setRows] = useState<DiagnosisRow[]>(initialRows);
  const [newDiagnosisName, setNewDiagnosisName] = useState("");
  const [newDiagnosisDate, setNewDiagnosisDate] = useState(toEasternDate());
  const [editingRow, setEditingRow] = useState<DiagnosisRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editDate, setEditDate] = useState(toEasternDate());
  const [status, setStatus] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const aPrimary = a.diagnosis_type === "primary";
        const bPrimary = b.diagnosis_type === "primary";
        if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;

        const aDate = Date.parse(a.date_added);
        const bDate = Date.parse(b.date_added);
        if (!Number.isNaN(aDate) && !Number.isNaN(bDate) && aDate !== bDate) {
          return bDate - aDate;
        }

        if (a.date_added === b.date_added) return a.id < b.id ? 1 : -1;
        return a.date_added < b.date_added ? 1 : -1;
      }),
    [rows]
  );

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");

    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("diagnosisName", newDiagnosisName);
      formData.set("diagnosisDate", newDiagnosisDate);

      const result = await addMhpDiagnosisInlineAction(formData);
      if (!result.ok || !result.diagnosis) {
        setStatus(result.error ?? "Unable to add diagnosis.");
        return;
      }

      setRows((current) => [result.diagnosis as DiagnosisRow, ...current]);
      setNewDiagnosisName("");
      setStatus("Diagnosis added.");
    });
  };

  const handleDelete = (diagnosisId: string) => {
    if (!window.confirm("Delete this diagnosis entry?")) return;
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("diagnosisId", diagnosisId);

      const result = await deleteMhpDiagnosisInlineAction(formData);
      if (!result.ok) {
        setStatus(result.error ?? "Unable to delete diagnosis.");
        return;
      }

      setRows((current) => current.filter((row) => row.id !== diagnosisId));
      setStatus("Diagnosis deleted.");
    });
  };

  const openEdit = (row: DiagnosisRow) => {
    setEditingRow(row);
    setEditName(row.diagnosis_name);
    setEditDate(row.date_added);
  };

  const handleEditSave = () => {
    if (!editingRow) return;
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("diagnosisId", editingRow.id);
      formData.set("diagnosisName", editName);
      formData.set("diagnosisDate", editDate);

      const result = await updateMhpDiagnosisInlineAction(formData);
      if (!result.ok || !result.diagnosis) {
        setStatus(result.error ?? "Unable to update diagnosis.");
        return;
      }

      setRows((current) => current.map((row) => (row.id === editingRow.id ? (result.diagnosis as DiagnosisRow) : row)));
      setEditingRow(null);
      setStatus("Diagnosis updated.");
    });
  };

  return (
    <>
      <table className="mt-3">
        <thead>
          <tr>
            <th>Type</th>
            <th>Diagnosis</th>
            <th>Date</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {sortedRows.slice(0, 25).map((row) => (
            <tr key={row.id}>
              <td className="capitalize">{row.diagnosis_type}</td>
              <td>{row.diagnosis_name}</td>
              <td>{formatDate(row.date_added)}</td>
              <td>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs"
                    onClick={() => openEdit(row)}
                    disabled={isPending}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs"
                    onClick={() => handleDelete(row.id)}
                    disabled={isPending}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={handleAdd} className="mt-3 grid gap-2 md:grid-cols-3">
        <input type="hidden" name="memberId" value={memberId} />
        <input
          name="diagnosisName"
          value={newDiagnosisName}
          onChange={(event) => setNewDiagnosisName(event.target.value)}
          placeholder="Diagnosis"
          className="h-10 rounded-lg border border-border px-3"
          required
        />
        <input
          type="date"
          name="diagnosisDate"
          value={newDiagnosisDate}
          onChange={(event) => setNewDiagnosisDate(event.target.value)}
          className="h-10 rounded-lg border border-border px-3"
          required
        />
        <button
          type="submit"
          className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white"
          title="First diagnosis is set to Primary. Additional diagnoses are set to Secondary."
          disabled={isPending}
        >
          {isPending ? "Saving..." : "Add Diagnosis"}
        </button>
      </form>
      {status ? <p className="mt-2 text-xs text-muted">{status}</p> : null}
      <MhpEditModal open={Boolean(editingRow)} title="Edit Diagnosis" onClose={() => setEditingRow(null)}>
        <div className="space-y-3">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Diagnosis</span>
            <input
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Date Added</span>
            <input
              type="date"
              value={editDate}
              onChange={(event) => setEditDate(event.target.value)}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded border border-border px-3 py-2 text-sm" onClick={() => setEditingRow(null)}>
              Cancel
            </button>
            <button type="button" className="rounded bg-brand px-3 py-2 text-sm font-semibold text-white" onClick={handleEditSave} disabled={isPending}>
              Save
            </button>
          </div>
        </div>
      </MhpEditModal>
    </>
  );
}
