"use client";

import { useState } from "react";

type MedicationRow = {
  id: string;
  name: string;
  dose: string;
  route: string;
  frequency: string;
};

function buildInitialRows(initialRows: MedicationRow[]) {
  const rows = [...initialRows];
  while (rows.length < 8) {
    rows.push({
      id: `blank-med-${rows.length + 1}`,
      name: "",
      dose: "",
      route: "",
      frequency: ""
    });
  }
  return rows;
}

export function PofMedicationsEditor({
  initialRows
}: {
  initialRows: Array<{
    id: string;
    name: string;
    dose: string | null;
    route: string | null;
    frequency: string | null;
  }>;
}) {
  const [rows, setRows] = useState<MedicationRow[]>(() =>
    buildInitialRows(
      initialRows.map((row, index) => ({
        id: row.id || `med-${index + 1}`,
        name: row.name,
        dose: row.dose ?? "",
        route: row.route ?? "",
        frequency: row.frequency ?? ""
      }))
    )
  );

  function updateRow(id: string, field: "name" | "dose" | "route" | "frequency", value: string) {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]: value
            }
          : row
      )
    );
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        id: `med-${Date.now()}-${current.length + 1}`,
        name: "",
        dose: "",
        route: "",
        frequency: ""
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
    <div className="mt-2 space-y-2">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Dose</th>
              <th>Route</th>
              <th>Frequency</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((medication) => (
              <tr key={medication.id}>
                <td>
                  <input
                    name="medicationName"
                    value={medication.name}
                    onChange={(event) => updateRow(medication.id, "name", event.target.value)}
                    className="h-9 w-full rounded border border-border px-2 text-sm"
                  />
                </td>
                <td>
                  <input
                    name="medicationDose"
                    value={medication.dose}
                    onChange={(event) => updateRow(medication.id, "dose", event.target.value)}
                    className="h-9 w-full rounded border border-border px-2 text-sm"
                  />
                </td>
                <td>
                  <input
                    name="medicationRoute"
                    value={medication.route}
                    onChange={(event) => updateRow(medication.id, "route", event.target.value)}
                    className="h-9 w-full rounded border border-border px-2 text-sm"
                  />
                </td>
                <td>
                  <input
                    name="medicationFrequency"
                    value={medication.frequency}
                    onChange={(event) => updateRow(medication.id, "frequency", event.target.value)}
                    className="h-9 w-full rounded border border-border px-2 text-sm"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => removeRow(medication.id)}
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
        Add Medication Line
      </button>
    </div>
  );
}
