"use client";

import { type FormEvent, useMemo, useState, useTransition } from "react";

import {
  addMhpEquipmentInlineAction,
  deleteMhpEquipmentInlineAction,
  updateMhpEquipmentInlineAction
} from "@/app/(portal)/health/member-health-profiles/actions";
import { MhpEditModal } from "@/components/forms/mhp-edit-modal";

type EquipmentRow = {
  id: string;
  equipment_type: string;
  status: string | null;
  comments: string | null;
  updated_at: string;
};

export function MhpEquipmentSection({
  memberId,
  initialRows,
  statusOptions
}: {
  memberId: string;
  initialRows: EquipmentRow[];
  statusOptions: readonly string[];
}) {
  const [rows, setRows] = useState<EquipmentRow[]>(initialRows);
  const [statusMessage, setStatusMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const [newEquipmentType, setNewEquipmentType] = useState("");
  const [newEquipmentStatus, setNewEquipmentStatus] = useState(statusOptions[0] ?? "Active");
  const [newEquipmentComments, setNewEquipmentComments] = useState("");
  const [editingRow, setEditingRow] = useState<EquipmentRow | null>(null);
  const [editEquipmentType, setEditEquipmentType] = useState("");
  const [editEquipmentStatus, setEditEquipmentStatus] = useState(statusOptions[0] ?? "Active");
  const [editEquipmentComments, setEditEquipmentComments] = useState("");

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const aAt = Date.parse(a.updated_at);
        const bAt = Date.parse(b.updated_at);
        return bAt - aAt;
      }),
    [rows]
  );

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusMessage("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("equipmentType", newEquipmentType);
      formData.set("equipmentStatus", newEquipmentStatus);
      formData.set("equipmentComments", newEquipmentComments);
      const result = await addMhpEquipmentInlineAction(formData);
      if (!result.ok || !result.row) {
        setStatusMessage(result.error ?? "Unable to add equipment.");
        return;
      }
      setRows((current) => [result.row as EquipmentRow, ...current]);
      setNewEquipmentType("");
      setNewEquipmentStatus(statusOptions[0] ?? "Active");
      setNewEquipmentComments("");
      setStatusMessage("Equipment added.");
    });
  };

  const openEdit = (row: EquipmentRow) => {
    setEditingRow(row);
    setEditEquipmentType(row.equipment_type);
    setEditEquipmentStatus(row.status ?? (statusOptions[0] ?? "Active"));
    setEditEquipmentComments(row.comments ?? "");
  };

  const handleEditSave = () => {
    if (!editingRow) return;
    setStatusMessage("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("equipmentId", editingRow.id);
      formData.set("equipmentType", editEquipmentType);
      formData.set("equipmentStatus", editEquipmentStatus);
      formData.set("equipmentComments", editEquipmentComments);

      const result = await updateMhpEquipmentInlineAction(formData);
      if (!result.ok || !result.row) {
        setStatusMessage(result.error ?? "Unable to update equipment.");
        return;
      }
      setRows((current) => current.map((row) => (row.id === editingRow.id ? (result.row as EquipmentRow) : row)));
      setEditingRow(null);
      setStatusMessage("Equipment updated.");
    });
  };

  const handleDelete = (equipmentId: string) => {
    if (!window.confirm("Delete this equipment entry?")) return;
    setStatusMessage("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("equipmentId", equipmentId);
      const result = await deleteMhpEquipmentInlineAction(formData);
      if (!result.ok) {
        setStatusMessage(result.error ?? "Unable to delete equipment.");
        return;
      }
      setRows((current) => current.filter((row) => row.id !== equipmentId));
      setStatusMessage("Equipment deleted.");
    });
  };

  return (
    <>
      <table className="mt-3">
        <thead>
          <tr>
            <th>Type</th>
            <th>Status</th>
            <th>Comments</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {sortedRows.slice(0, 25).map((row) => (
            <tr key={row.id}>
              <td>{row.equipment_type}</td>
              <td>{row.status ?? "-"}</td>
              <td>{row.comments ?? "-"}</td>
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

      <form onSubmit={handleAdd} className="mt-3 grid gap-2 md:grid-cols-4">
        <input value={newEquipmentType} onChange={(event) => setNewEquipmentType(event.target.value)} placeholder="Equipment type" className="h-10 rounded-lg border border-border px-3" required />
        <select value={newEquipmentStatus} onChange={(event) => setNewEquipmentStatus(event.target.value)} className="h-10 rounded-lg border border-border px-3">
          {statusOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <input value={newEquipmentComments} onChange={(event) => setNewEquipmentComments(event.target.value)} placeholder="Comments" className="h-10 rounded-lg border border-border px-3" />
        <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white" disabled={isPending}>
          {isPending ? "Saving..." : "Add Equipment"}
        </button>
      </form>
      {statusMessage ? <p className="mt-2 text-xs text-muted">{statusMessage}</p> : null}
      <MhpEditModal open={Boolean(editingRow)} title="Edit Equipment" onClose={() => setEditingRow(null)}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Equipment Type</span>
            <input value={editEquipmentType} onChange={(event) => setEditEquipmentType(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Status</span>
            <select value={editEquipmentStatus} onChange={(event) => setEditEquipmentStatus(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3">
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="text-xs font-semibold text-muted">Comments</span>
            <input value={editEquipmentComments} onChange={(event) => setEditEquipmentComments(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3" />
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
