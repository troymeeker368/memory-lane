"use client";

import { useState } from "react";

import {
  POF_DEFAULT_MEDICATION_FORM,
  POF_DEFAULT_MEDICATION_QUANTITY,
  POF_DEFAULT_MEDICATION_ROUTE,
  POF_MEDICATION_FORM_OPTIONS,
  POF_MEDICATION_ROUTE_OPTIONS
} from "@/lib/services/physician-order-config";

type MedicationRow = {
  id: string;
  name: string;
  dose: string;
  quantity: string;
  form: string;
  route: string;
  routeLaterality: string;
  frequency: string;
  givenAtCenter: boolean;
  givenAtCenterTime24h: string;
  comments: string;
};

function requiresRouteLaterality(route: string) {
  const normalized = route.trim().toLowerCase();
  return normalized === "ophthalmic" || normalized === "otic";
}

function buildInitialRows(
  initialRows: Array<{
    id: string;
    name: string;
    dose: string | null;
    quantity: string | null;
    form: string | null;
    route: string | null;
    routeLaterality: string | null;
    frequency: string | null;
    givenAtCenter: boolean;
    givenAtCenterTime24h: string | null;
    comments: string | null;
  }>
) {
  const rows = initialRows.map((row, index) => ({
    id: row.id || `med-${index + 1}`,
    name: row.name,
    dose: row.dose ?? "",
    quantity: row.quantity ?? POF_DEFAULT_MEDICATION_QUANTITY,
    form: row.form ?? POF_DEFAULT_MEDICATION_FORM,
    route: row.route ?? POF_DEFAULT_MEDICATION_ROUTE,
    routeLaterality: row.routeLaterality ?? "",
    frequency: row.frequency ?? "",
    givenAtCenter: row.givenAtCenter === true,
    givenAtCenterTime24h: row.givenAtCenterTime24h ?? "",
    comments: row.comments ?? ""
  }));

  while (rows.length < 6) {
    rows.push({
      id: `blank-med-${rows.length + 1}`,
      name: "",
      dose: "",
      quantity: POF_DEFAULT_MEDICATION_QUANTITY,
      form: POF_DEFAULT_MEDICATION_FORM,
      route: POF_DEFAULT_MEDICATION_ROUTE,
      routeLaterality: "",
      frequency: "",
      givenAtCenter: false,
      givenAtCenterTime24h: "",
      comments: ""
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
    quantity: string | null;
    form: string | null;
    route: string | null;
    routeLaterality: string | null;
    frequency: string | null;
    givenAtCenter: boolean;
    givenAtCenterTime24h: string | null;
    comments: string | null;
  }>;
}) {
  const [rows, setRows] = useState<MedicationRow[]>(() => buildInitialRows(initialRows));

  function updateRow<K extends keyof MedicationRow>(id: string, field: K, value: MedicationRow[K]) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row;
        const next = {
          ...row,
          [field]: value
        } as MedicationRow;
        if (field === "route" && !requiresRouteLaterality(String(value))) {
          next.routeLaterality = "";
        }
        return next;
      })
    );
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        id: `med-${Date.now()}-${current.length + 1}`,
        name: "",
        dose: "",
        quantity: POF_DEFAULT_MEDICATION_QUANTITY,
        form: POF_DEFAULT_MEDICATION_FORM,
        route: POF_DEFAULT_MEDICATION_ROUTE,
        routeLaterality: "",
        frequency: "",
        givenAtCenter: false,
        givenAtCenterTime24h: "",
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
    <div className="mt-2 space-y-2">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="min-w-[260px]">Name</th>
              <th className="min-w-[150px]">Dose</th>
              <th className="min-w-[64px]">Qty</th>
              <th>Form</th>
              <th className="min-w-[92px]">Route</th>
              <th>Frequency</th>
              <th>Given at Center</th>
              <th>Comments</th>
              <th />
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
                    className="h-9 w-[280px] rounded border border-border px-2 text-sm"
                  />
                </td>
                <td>
                  <input
                    name="medicationDose"
                    value={medication.dose}
                    onChange={(event) => updateRow(medication.id, "dose", event.target.value)}
                    className="h-9 w-[160px] rounded border border-border px-2 text-sm"
                  />
                </td>
                <td>
                  <input
                    name="medicationQuantity"
                    value={medication.quantity}
                    onChange={(event) => updateRow(medication.id, "quantity", event.target.value)}
                    className="h-9 w-[58px] rounded border border-border px-2 text-sm"
                  />
                </td>
                <td>
                  <select
                    name="medicationForm"
                    value={medication.form}
                    onChange={(event) => updateRow(medication.id, "form", event.target.value)}
                    className="h-9 w-[120px] rounded border border-border px-2 text-sm"
                  >
                    {POF_MEDICATION_FORM_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    name="medicationRoute"
                    value={medication.route}
                    onChange={(event) => updateRow(medication.id, "route", event.target.value)}
                    className="h-9 w-[82px] rounded border border-border px-2 text-sm"
                  >
                    {POF_MEDICATION_ROUTE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <input type="hidden" name="medicationRouteLaterality" value={medication.routeLaterality} />
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
                  <input type="hidden" name="medicationGivenAtCenter" value={medication.givenAtCenter ? "true" : "false"} />
                  <div className="flex min-w-[168px] flex-col gap-1">
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={medication.givenAtCenter}
                        onChange={(event) => {
                          updateRow(medication.id, "givenAtCenter", event.target.checked);
                          if (!event.target.checked) {
                            updateRow(medication.id, "givenAtCenterTime24h", "");
                          }
                        }}
                      />
                      <span>Yes</span>
                    </label>
                    {medication.givenAtCenter ? (
                      <input
                        type="time"
                        name="medicationGivenAtCenterTime24h"
                        value={medication.givenAtCenterTime24h}
                        onChange={(event) => updateRow(medication.id, "givenAtCenterTime24h", event.target.value)}
                        className="h-9 w-[118px] rounded border border-border px-2 text-sm"
                      />
                    ) : (
                      <input type="hidden" name="medicationGivenAtCenterTime24h" value="" />
                    )}
                  </div>
                </td>
                <td>
                  <input
                    name="medicationComments"
                    value={medication.comments}
                    onChange={(event) => updateRow(medication.id, "comments", event.target.value)}
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
