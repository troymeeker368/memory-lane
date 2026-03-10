"use client";

import { useState } from "react";

type AllergyRow = {
  id: string;
  allergyGroup: "food" | "medication" | "environmental" | "other";
  allergyName: string;
  severity: string;
  comments: string;
};

function buildInitialRows(
  initialRows: Array<{
    id: string;
    allergyGroup: "food" | "medication" | "environmental" | "other";
    allergyName: string;
    severity: string | null;
    comments: string | null;
  }>
) {
  const rows = initialRows.map((row, idx) => ({
    id: row.id || `pof-allergy-${idx + 1}`,
    allergyGroup: row.allergyGroup,
    allergyName: row.allergyName,
    severity: row.severity ?? "",
    comments: row.comments ?? ""
  }));
  if (rows.length === 0) {
    rows.push({
      id: "pof-allergy-1",
      allergyGroup: "medication",
      allergyName: "",
      severity: "",
      comments: ""
    });
  }
  return rows;
}

export function PofAllergiesEditor({
  initialRows
}: {
  initialRows: Array<{
    id: string;
    allergyGroup: "food" | "medication" | "environmental" | "other";
    allergyName: string;
    severity: string | null;
    comments: string | null;
  }>;
}) {
  const [rows, setRows] = useState<AllergyRow[]>(() => buildInitialRows(initialRows));

  function updateRow<K extends keyof AllergyRow>(id: string, field: K, value: AllergyRow[K]) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        id: `pof-allergy-${Date.now()}-${current.length + 1}`,
        allergyGroup: "medication",
        allergyName: "",
        severity: "",
        comments: ""
      }
    ]);
  }

  function removeRow(id: string) {
    setRows((current) => {
      if (current.length <= 1) return current;
      return current.filter((row) => row.id !== id);
    });
  }

  return (
    <div className="space-y-2">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Allergy</th>
              <th>Severity</th>
              <th>Comments</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <select
                    name="allergyGroup"
                    value={row.allergyGroup}
                    onChange={(event) => updateRow(row.id, "allergyGroup", event.target.value as AllergyRow["allergyGroup"])}
                    className="h-9 w-full rounded border border-border px-2 text-sm"
                  >
                    <option value="food">Food</option>
                    <option value="medication">Medication</option>
                    <option value="environmental">Environmental</option>
                    <option value="other">Other</option>
                  </select>
                </td>
                <td>
                  <input
                    name="allergyName"
                    value={row.allergyName}
                    onChange={(event) => updateRow(row.id, "allergyName", event.target.value)}
                    className="h-9 w-full rounded border border-border px-2 text-sm"
                    placeholder="Allergy name"
                  />
                </td>
                <td>
                  <input
                    name="allergySeverity"
                    value={row.severity}
                    onChange={(event) => updateRow(row.id, "severity", event.target.value)}
                    className="h-9 w-full rounded border border-border px-2 text-sm"
                    placeholder="Mild/Moderate/Severe"
                  />
                </td>
                <td>
                  <input
                    name="allergyComments"
                    value={row.comments}
                    onChange={(event) => updateRow(row.id, "comments", event.target.value)}
                    className="h-9 w-full rounded border border-border px-2 text-sm"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    className="rounded-md border border-border px-2 py-1 text-xs font-semibold"
                    disabled={rows.length <= 1}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="button" onClick={addRow} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
        Add Allergy Row
      </button>
    </div>
  );
}
