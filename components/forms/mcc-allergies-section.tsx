"use client";

import { type FormEvent, useMemo, useState, useTransition } from "react";

import {
  addMemberCommandCenterAllergyInlineAction,
  deleteMemberCommandCenterAllergyInlineAction,
  updateMemberCommandCenterAllergyInlineAction
} from "@/app/(portal)/operations/member-command-center/allergy-actions";
import { MhpEditModal } from "@/components/forms/mhp-edit-modal";

type AllergyRow = {
  id: string;
  allergy_group: "food" | "medication" | "environmental";
  allergy_name: string;
  severity: string | null;
  comments: string | null;
  updated_at: string;
};

export function MccAllergiesSection({
  memberId,
  canEdit,
  initialRows
}: {
  memberId: string;
  canEdit: boolean;
  initialRows: AllergyRow[];
}) {
  const [rows, setRows] = useState<AllergyRow[]>(initialRows);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  const [allergyGroup, setAllergyGroup] = useState<AllergyRow["allergy_group"]>("food");
  const [allergyName, setAllergyName] = useState("");
  const [allergySeverity, setAllergySeverity] = useState("");
  const [editingRow, setEditingRow] = useState<AllergyRow | null>(null);
  const [editAllergyGroup, setEditAllergyGroup] = useState<AllergyRow["allergy_group"]>("food");
  const [editAllergyName, setEditAllergyName] = useState("");
  const [editAllergySeverity, setEditAllergySeverity] = useState("");
  const [editAllergyComments, setEditAllergyComments] = useState("");

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
    if (!canEdit) return;
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("allergyGroup", allergyGroup);
      formData.set("allergyName", allergyName);
      formData.set("allergySeverity", allergySeverity);
      const result = await addMemberCommandCenterAllergyInlineAction(formData);
      if (!result.ok || !result.row) {
        setStatus(result.error ?? "Unable to add allergy.");
        return;
      }
      setRows((current) => [result.row as AllergyRow, ...current]);
      setAllergyGroup("food");
      setAllergyName("");
      setAllergySeverity("");
      setStatus("Allergy added.");
    });
  };

  const handleDelete = (allergyId: string) => {
    if (!canEdit) return;
    if (!window.confirm("Delete this allergy?")) return;
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("allergyId", allergyId);
      const result = await deleteMemberCommandCenterAllergyInlineAction(formData);
      if (!result.ok) {
        setStatus(result.error ?? "Unable to delete allergy.");
        return;
      }
      setRows((current) => current.filter((row) => row.id !== allergyId));
      setStatus("Allergy deleted.");
    });
  };

  const openEdit = (row: AllergyRow) => {
    if (!canEdit) return;
    setEditingRow(row);
    setEditAllergyGroup(row.allergy_group);
    setEditAllergyName(row.allergy_name);
    setEditAllergySeverity(row.severity ?? "");
    setEditAllergyComments(row.comments ?? "");
  };

  const handleEditSave = () => {
    if (!canEdit || !editingRow) return;
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("allergyId", editingRow.id);
      formData.set("allergyGroup", editAllergyGroup);
      formData.set("allergyName", editAllergyName);
      formData.set("allergySeverity", editAllergySeverity);
      formData.set("allergyComments", editAllergyComments);

      const result = await updateMemberCommandCenterAllergyInlineAction(formData);
      if (!result.ok || !result.row) {
        setStatus(result.error ?? "Unable to update allergy.");
        return;
      }

      setRows((current) => current.map((row) => (row.id === editingRow.id ? (result.row as AllergyRow) : row)));
      setEditingRow(null);
      setStatus("Allergy updated.");
    });
  };

  return (
    <>
      <table className="mt-3">
        <thead>
          <tr>
            <th>Group</th>
            <th>Name</th>
            <th>Severity</th>
            <th>Comments</th>
            {canEdit ? <th aria-label="Actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {sortedRows.slice(0, 25).map((row) => (
            <tr key={row.id}>
              <td>{row.allergy_group}</td>
              <td>{row.allergy_name}</td>
              <td>{row.severity ?? "-"}</td>
              <td>{row.comments ?? "-"}</td>
              {canEdit ? (
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
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {canEdit ? (
        <form onSubmit={handleAdd} className="mt-3 grid gap-2 md:grid-cols-4">
          <select value={allergyGroup} onChange={(event) => setAllergyGroup(event.target.value as AllergyRow["allergy_group"])} className="h-10 rounded-lg border border-border px-3">
            <option value="food">Food</option>
            <option value="medication">Medication</option>
            <option value="environmental">Environmental</option>
          </select>
          <input value={allergyName} onChange={(event) => setAllergyName(event.target.value)} placeholder="Allergy" className="h-10 rounded-lg border border-border px-3" required />
          <input value={allergySeverity} onChange={(event) => setAllergySeverity(event.target.value)} placeholder="Severity" className="h-10 rounded-lg border border-border px-3" />
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white" disabled={isPending}>
            {isPending ? "Saving..." : "Add Allergy"}
          </button>
        </form>
      ) : null}
      {status ? <p className="mt-2 text-xs text-muted">{status}</p> : null}
      <MhpEditModal open={Boolean(editingRow)} title="Edit Allergy" onClose={() => setEditingRow(null)}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Group</span>
            <select
              value={editAllergyGroup}
              onChange={(event) => setEditAllergyGroup(event.target.value as AllergyRow["allergy_group"])}
              className="h-10 w-full rounded-lg border border-border px-3"
            >
              <option value="food">Food</option>
              <option value="medication">Medication</option>
              <option value="environmental">Environmental</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Name</span>
            <input value={editAllergyName} onChange={(event) => setEditAllergyName(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Severity</span>
            <input value={editAllergySeverity} onChange={(event) => setEditAllergySeverity(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Comments</span>
            <input value={editAllergyComments} onChange={(event) => setEditAllergyComments(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3" />
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
