"use client";

import { useState } from "react";

type DiagnosisRow = {
  id: string;
  diagnosisType: "primary" | "secondary";
  diagnosisName: string;
  diagnosisCode: string;
};

function normalizeRows(initialRows: DiagnosisRow[]): DiagnosisRow[] {
  const rows = [...initialRows];
  if (rows.length === 0) {
    rows.push({
      id: "pof-diagnosis-1",
      diagnosisType: "primary",
      diagnosisName: "",
      diagnosisCode: ""
    });
  }
  return rows.map(
    (row, idx): DiagnosisRow => ({
      ...row,
      diagnosisType: idx === 0 ? "primary" : "secondary"
    })
  );
}

export function PofDiagnosesEditor({
  initialRows
}: {
  initialRows: Array<{
    id: string;
    diagnosisType: "primary" | "secondary";
    diagnosisName: string;
    diagnosisCode: string | null;
  }>;
}) {
  const [rows, setRows] = useState<DiagnosisRow[]>(
    normalizeRows(
      initialRows.map((row, idx) => {
        const diagnosisType: DiagnosisRow["diagnosisType"] = row.diagnosisType === "primary" ? "primary" : "secondary";
        return {
          id: row.id || `pof-diagnosis-${idx + 1}`,
          diagnosisType,
          diagnosisName: row.diagnosisName,
          diagnosisCode: row.diagnosisCode ?? ""
        };
      })
    )
  );

  function updateRow(id: string, patch: Partial<DiagnosisRow>) {
    setRows((current) =>
      current.map((row, idx) =>
        row.id === id
          ? {
              ...row,
              ...patch,
              diagnosisType: idx === 0 ? "primary" : "secondary"
            }
          : row
      )
    );
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        id: `pof-diagnosis-${Date.now()}-${current.length + 1}`,
        diagnosisType: "secondary",
        diagnosisName: "",
        diagnosisCode: ""
      }
    ]);
  }

  function removeRow(id: string) {
    setRows((current) => {
      if (current.length <= 1) return current;
      return current
        .filter((row) => row.id !== id)
        .map((row, idx) => ({
          ...row,
          diagnosisType: idx === 0 ? "primary" : "secondary"
        }));
    });
  }

  return (
    <div className="space-y-2">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Diagnosis</th>
              <th>Code</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id}>
                <td>
                  <input type="hidden" name="diagnosisType" value={idx === 0 ? "primary" : "secondary"} />
                  <span className="text-xs font-semibold capitalize">{idx === 0 ? "primary" : "secondary"}</span>
                </td>
                <td>
                  <input
                    name="diagnosisName"
                    value={row.diagnosisName}
                    onChange={(event) => updateRow(row.id, { diagnosisName: event.target.value })}
                    className="h-9 w-full rounded border border-border px-2 text-sm"
                    placeholder="Diagnosis name"
                  />
                </td>
                <td>
                  <input
                    name="diagnosisCode"
                    value={row.diagnosisCode}
                    onChange={(event) => updateRow(row.id, { diagnosisCode: event.target.value })}
                    className="h-9 w-full rounded border border-border px-2 text-sm"
                    placeholder="ICD-10 (optional)"
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
        Add Diagnosis Row
      </button>
    </div>
  );
}
