"use client";

import { type FormEvent, useMemo, useState, useTransition } from "react";

import {
  addMhpMedicationInlineAction,
  deleteMhpMedicationInlineAction,
  inactivateMhpMedicationInlineAction,
  reactivateMhpMedicationInlineAction,
  updateMhpMedicationInlineAction
} from "@/app/(portal)/health/member-health-profiles/actions";
import { MhpEditModal } from "@/components/forms/mhp-edit-modal";
import { toEasternDate } from "@/lib/timezone";
import { formatDate } from "@/lib/utils";

type MedicationRow = {
  id: string;
  medication_name: string;
  date_started: string;
  medication_status: "active" | "inactive";
  inactivated_at: string | null;
  dose: string | null;
  quantity: string | null;
  form: string | null;
  frequency: string | null;
  route: string | null;
  route_laterality?: string | null;
  comments: string | null;
  updated_at: string;
};

const MEDICATION_FORM_OPTIONS = [
  "Tablet",
  "Capsule",
  "Liquid",
  "Injection",
  "Patch",
  "Cream/Ointment",
  "Drops",
  "Inhaler",
  "Powder",
  "Other"
] as const;

const OPHTHALMIC_LATERALITY_OPTIONS = ["OD", "OS", "OU"] as const;
const OTIC_LATERALITY_OPTIONS = ["AD", "AS", "AU"] as const;

export function MhpMedicationsSection({
  memberId,
  initialRows,
  routeOptions
}: {
  memberId: string;
  initialRows: MedicationRow[];
  routeOptions: readonly string[];
}) {
  const [rows, setRows] = useState<MedicationRow[]>(initialRows);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  const [newMedicationName, setNewMedicationName] = useState("");
  const [newDateStarted, setNewDateStarted] = useState(toEasternDate());
  const [newDose, setNewDose] = useState("");
  const [newQuantity, setNewQuantity] = useState("1");
  const [newMedicationForm, setNewMedicationForm] = useState<string>("Tablet");
  const [newMedicationFormOther, setNewMedicationFormOther] = useState("");
  const [newFrequency, setNewFrequency] = useState("");
  const [newRoute, setNewRoute] = useState(routeOptions[0] ?? "PO");
  const [newRouteLaterality, setNewRouteLaterality] = useState("");
  const [editingRow, setEditingRow] = useState<MedicationRow | null>(null);
  const [editMedicationName, setEditMedicationName] = useState("");
  const [editDateStarted, setEditDateStarted] = useState(toEasternDate());
  const [editDose, setEditDose] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editMedicationForm, setEditMedicationForm] = useState<string>("Tablet");
  const [editMedicationFormOther, setEditMedicationFormOther] = useState("");
  const [editFrequency, setEditFrequency] = useState("");
  const [editRoute, setEditRoute] = useState(routeOptions[0] ?? "PO");
  const [editRouteLaterality, setEditRouteLaterality] = useState("");
  const [editComments, setEditComments] = useState("");

  const requiresRouteLaterality = (route: string | null | undefined) => {
    const normalized = (route ?? "").trim().toLowerCase();
    return normalized === "ophthalmic" || normalized === "otic";
  };

  const lateralityOptionsForRoute = (route: string | null | undefined) => {
    const normalized = (route ?? "").trim().toLowerCase();
    if (normalized === "ophthalmic") return OPHTHALMIC_LATERALITY_OPTIONS;
    if (normalized === "otic") return OTIC_LATERALITY_OPTIONS;
    return [];
  };

  const routeDisplay = (row: MedicationRow) =>
    row.route_laterality ? `${row.route ?? "-"} (${row.route_laterality})` : (row.route ?? "-");

  const normalizeRoute = (route: string | null) => {
    const trimmed = route?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : "Unspecified";
  };

  const sortByRouteThenMedicationName = (left: MedicationRow, right: MedicationRow) => {
    const leftRoute = normalizeRoute(left.route);
    const rightRoute = normalizeRoute(right.route);
    const routeCompare = leftRoute.localeCompare(rightRoute, undefined, { sensitivity: "base" });
    if (routeCompare !== 0) {
      return routeCompare;
    }

    const nameCompare = left.medication_name.localeCompare(right.medication_name, undefined, { sensitivity: "base" });
    if (nameCompare !== 0) {
      return nameCompare;
    }

    const leftStarted = Date.parse(left.date_started || "");
    const rightStarted = Date.parse(right.date_started || "");
    return Number.isNaN(leftStarted) || Number.isNaN(rightStarted) ? 0 : rightStarted - leftStarted;
  };

  const activeRows = useMemo(
    () =>
      rows
        .filter((row) => row.medication_status !== "inactive")
        .sort(sortByRouteThenMedicationName),
    [rows]
  );

  const inactiveRows = useMemo(
    () =>
      rows
        .filter((row) => row.medication_status === "inactive")
        .sort(sortByRouteThenMedicationName),
    [rows]
  );

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    if (requiresRouteLaterality(newRoute) && !newRouteLaterality) {
      setStatus("Please select eye/ear side for Ophthalmic/Otic routes.");
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("medicationName", newMedicationName);
      formData.set("dateStarted", newDateStarted);
      formData.set("dose", newDose);
      formData.set("quantity", newQuantity);
      formData.set(
        "medicationForm",
        newMedicationForm === "Other" ? (newMedicationFormOther || "Other") : newMedicationForm
      );
      formData.set("frequency", newFrequency);
      formData.set("route", newRoute);
      formData.set("routeLaterality", requiresRouteLaterality(newRoute) ? newRouteLaterality : "");

      const result = await addMhpMedicationInlineAction(formData);
      if (!result.ok || !result.row) {
        setStatus(result.error ?? "Unable to add medication.");
        return;
      }

      setRows((current) => [result.row as MedicationRow, ...current]);
      setNewMedicationName("");
      setNewDateStarted(toEasternDate());
      setNewDose("");
      setNewQuantity("1");
      setNewMedicationForm("Tablet");
      setNewMedicationFormOther("");
      setNewFrequency("");
      setNewRoute(routeOptions[0] ?? "PO");
      setNewRouteLaterality("");
      setStatus("Medication added.");
    });
  };

  const openEdit = (row: MedicationRow) => {
    setEditingRow(row);
    setEditMedicationName(row.medication_name);
    setEditDateStarted(row.date_started || toEasternDate());
    setEditDose(row.dose ?? "");
    setEditQuantity(row.quantity ?? "");
    const normalizedForm = (row.form ?? "").trim();
    const knownForm = MEDICATION_FORM_OPTIONS.includes(normalizedForm as (typeof MEDICATION_FORM_OPTIONS)[number]);
    setEditMedicationForm(knownForm ? normalizedForm : "Other");
    setEditMedicationFormOther(knownForm ? "" : normalizedForm);
    setEditFrequency(row.frequency ?? "");
    setEditRoute(row.route ?? (routeOptions[0] ?? "PO"));
    setEditRouteLaterality(row.route_laterality ?? "");
    setEditComments(row.comments ?? "");
  };

  const handleEditSave = () => {
    if (!editingRow) return;
    setStatus("");
    if (requiresRouteLaterality(editRoute) && !editRouteLaterality) {
      setStatus("Please select eye/ear side for Ophthalmic/Otic routes.");
      return;
    }
    startTransition(async () => {
      const data = new FormData();
      data.set("memberId", memberId);
      data.set("medicationId", editingRow.id);
      data.set("medicationName", editMedicationName);
      data.set("dateStarted", editDateStarted);
      data.set("dose", editDose);
      data.set("quantity", editQuantity);
      data.set(
        "medicationForm",
        editMedicationForm === "Other" ? (editMedicationFormOther || "Other") : editMedicationForm
      );
      data.set("frequency", editFrequency);
      data.set("route", editRoute);
      data.set("routeLaterality", requiresRouteLaterality(editRoute) ? editRouteLaterality : "");
      data.set("medicationComments", editComments);

      const result = await updateMhpMedicationInlineAction(data);
      if (!result.ok || !result.row) {
        setStatus(result.error ?? "Unable to update medication.");
        return;
      }

      setRows((current) => current.map((row) => (row.id === editingRow.id ? (result.row as MedicationRow) : row)));
      setEditingRow(null);
      setStatus("Medication updated.");
    });
  };

  const handleInactivate = (medicationId: string) => {
    if (!window.confirm("Inactivate this medication?")) return;
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("medicationId", medicationId);
      const result = await inactivateMhpMedicationInlineAction(formData);
      if (!result.ok || !result.row) {
        setStatus(result.error ?? "Unable to inactivate medication.");
        return;
      }

      setRows((current) => current.map((row) => (row.id === medicationId ? (result.row as MedicationRow) : row)));
      setStatus("Medication moved to historical list.");
    });
  };

  const handleReactivate = (medicationId: string) => {
    if (!window.confirm("Reactivate this medication? Start date will be set to today.")) return;
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("medicationId", medicationId);
      const result = await reactivateMhpMedicationInlineAction(formData);
      if (!result.ok || !result.row) {
        setStatus(result.error ?? "Unable to reactivate medication.");
        return;
      }

      setRows((current) => current.map((row) => (row.id === medicationId ? (result.row as MedicationRow) : row)));
      setStatus("Medication reactivated.");
    });
  };

  const handleDelete = (medicationId: string) => {
    if (!window.confirm("Delete this medication?")) return;
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("medicationId", medicationId);
      const result = await deleteMhpMedicationInlineAction(formData);
      if (!result.ok) {
        setStatus(result.error ?? "Unable to delete medication.");
        return;
      }
      setRows((current) => current.filter((row) => row.id !== medicationId));
      setStatus("Medication deleted.");
    });
  };

  return (
    <>
      <form onSubmit={handleAdd} className="mt-3 grid gap-2 md:grid-cols-9">
        <input value={newMedicationName} onChange={(event) => setNewMedicationName(event.target.value)} placeholder="Medication" className="h-10 rounded-lg border border-border px-3" required />
        <input type="date" value={newDateStarted} onChange={(event) => setNewDateStarted(event.target.value)} className="h-10 rounded-lg border border-border px-3" required />
        <input value={newDose} onChange={(event) => setNewDose(event.target.value)} placeholder="Dose" className="h-10 rounded-lg border border-border px-3" />
        <input value={newQuantity} onChange={(event) => setNewQuantity(event.target.value)} placeholder="Qty" className="h-10 rounded-lg border border-border px-3" required />
        <select value={newMedicationForm} onChange={(event) => setNewMedicationForm(event.target.value)} className="h-10 rounded-lg border border-border px-3">
          {MEDICATION_FORM_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {newMedicationForm === "Other" ? (
          <input
            value={newMedicationFormOther}
            onChange={(event) => setNewMedicationFormOther(event.target.value)}
            placeholder="Custom form"
            className="h-10 rounded-lg border border-border px-3"
          />
        ) : null}
        <input value={newFrequency} onChange={(event) => setNewFrequency(event.target.value)} placeholder="Frequency" className="h-10 rounded-lg border border-border px-3" />
        <select
          value={newRoute}
          onChange={(event) => {
            const nextRoute = event.target.value;
            setNewRoute(nextRoute);
            if (!requiresRouteLaterality(nextRoute)) {
              setNewRouteLaterality("");
            }
          }}
          className="h-10 rounded-lg border border-border px-3"
        >
          {routeOptions.map((route) => (
            <option key={route} value={route}>
              {route}
            </option>
          ))}
        </select>
        {requiresRouteLaterality(newRoute) ? (
          <select
            value={newRouteLaterality}
            onChange={(event) => setNewRouteLaterality(event.target.value)}
            className="h-10 rounded-lg border border-border px-3"
            required
          >
            <option value="">Eye/Ear</option>
            {lateralityOptionsForRoute(newRoute).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <div className="h-10 rounded-lg border border-border bg-slate-50 px-3 text-xs leading-10 text-muted">Eye/Ear N/A</div>
        )}
        <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white" disabled={isPending}>
          {isPending ? "Saving..." : "Add Medication"}
        </button>
      </form>

      <table className="mt-3">
        <thead>
          <tr>
            <th>Name</th>
            <th>Started</th>
            <th>Dose</th>
            <th>Qty</th>
            <th>Form</th>
            <th>Frequency</th>
            <th>Route</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {activeRows.slice(0, 25).map((row) => (
            <tr key={row.id}>
              <td>{row.medication_name}</td>
              <td>{formatDate(row.date_started)}</td>
              <td>{row.dose ?? "-"}</td>
              <td>{row.quantity ?? "-"}</td>
              <td>{row.form ?? "-"}</td>
              <td>{row.frequency ?? "-"}</td>
              <td>{routeDisplay(row)}</td>
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
                    onClick={() => handleInactivate(row.id)}
                    disabled={isPending}
                  >
                    Inactivate
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
          {activeRows.length === 0 ? (
            <tr>
              <td colSpan={8} className="text-sm text-muted">No active medications.</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="mt-6">
        <h4 className="text-sm font-semibold text-primary-text">Historical Medications</h4>
        <table className="mt-2">
          <thead>
            <tr>
              <th>Name</th>
              <th>Started</th>
              <th>Inactivated</th>
              <th>Dose</th>
              <th>Qty</th>
              <th>Form</th>
              <th>Frequency</th>
              <th>Route</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {inactiveRows.slice(0, 25).map((row) => (
              <tr key={row.id}>
                <td>{row.medication_name}</td>
                <td>{formatDate(row.date_started)}</td>
                <td>{row.inactivated_at ? formatDate(row.inactivated_at) : "-"}</td>
                <td>{row.dose ?? "-"}</td>
                <td>{row.quantity ?? "-"}</td>
                <td>{row.form ?? "-"}</td>
                <td>{row.frequency ?? "-"}</td>
                <td>{routeDisplay(row)}</td>
                <td>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-1 text-xs"
                      onClick={() => handleReactivate(row.id)}
                      disabled={isPending}
                    >
                      Reactivate
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
            {inactiveRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-sm text-muted">No historical medications.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {status ? <p className="mt-2 text-xs text-muted">{status}</p> : null}
      <MhpEditModal open={Boolean(editingRow)} title="Edit Medication" onClose={() => setEditingRow(null)}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Medication Name</span>
            <input value={editMedicationName} onChange={(event) => setEditMedicationName(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Started Date</span>
            <input type="date" value={editDateStarted} onChange={(event) => setEditDateStarted(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Dose</span>
            <input value={editDose} onChange={(event) => setEditDose(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Quantity</span>
            <input value={editQuantity} onChange={(event) => setEditQuantity(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Form</span>
            <select value={editMedicationForm} onChange={(event) => setEditMedicationForm(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3">
              {MEDICATION_FORM_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          {editMedicationForm === "Other" ? (
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Form (Other)</span>
              <input value={editMedicationFormOther} onChange={(event) => setEditMedicationFormOther(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3" />
            </label>
          ) : null}
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Frequency</span>
            <input value={editFrequency} onChange={(event) => setEditFrequency(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Route</span>
            <select
              value={editRoute}
              onChange={(event) => {
                const nextRoute = event.target.value;
                setEditRoute(nextRoute);
                if (!requiresRouteLaterality(nextRoute)) {
                  setEditRouteLaterality("");
                }
              }}
              className="h-10 w-full rounded-lg border border-border px-3"
            >
              {routeOptions.map((route) => (
                <option key={route} value={route}>
                  {route}
                </option>
              ))}
            </select>
          </label>
          {requiresRouteLaterality(editRoute) ? (
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Eye/Ear</span>
              <select
                value={editRouteLaterality}
                onChange={(event) => setEditRouteLaterality(event.target.value)}
                className="h-10 w-full rounded-lg border border-border px-3"
                required
              >
                <option value="">Select</option>
                {lateralityOptionsForRoute(editRoute).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="text-xs font-semibold text-muted">Comments</span>
            <input value={editComments} onChange={(event) => setEditComments(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3" />
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
