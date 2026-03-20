"use client";

import { useEffect, useMemo, useState } from "react";

import { runDocumentationUpdateAction } from "@/app/documentation-update-actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { MutationNotice } from "@/components/ui/mutation-notice";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

type AncillaryLog = {
  id: string;
  service_date: string;
  member_name: string;
  category_name: string;
  quantity?: number | null;
  amount_cents: number;
  source_entity?: string | null;
  source_entity_id?: string | null;
  reconciliation_status?: "open" | "reconciled" | "void" | null;
  reconciled_by?: string | null;
  reconciled_at?: string | null;
  reconciliation_note?: string | null;
};

type MemberRow = {
  member_name: string;
  subtotal_cents: number;
  items: Array<{
    id: string;
    service_date: string;
    category_name: string;
    quantity: number;
    unit_amount_cents: number;
    total_amount_cents: number;
    source_entity: string | null;
    source_entity_id: string | null;
    reconciliation_status: "open" | "reconciled" | "void";
    reconciled_by: string | null;
    reconciled_at: string | null;
    reconciliation_note: string | null;
  }>;
};

function monthKeyFromDate(date: string) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildMemberRows(logs: AncillaryLog[], month: string, statusFilter: "all" | "open" | "reconciled" | "void"): MemberRow[] {
  const monthLogs = logs.filter((log) => monthKeyFromDate(log.service_date) === month);
  const scopedLogs =
    statusFilter === "all" ? monthLogs : monthLogs.filter((log) => (log.reconciliation_status ?? "open") === statusFilter);

  const perMember = new Map<string, MemberRow>();

  scopedLogs.forEach((log) => {
    const existing = perMember.get(log.member_name) ?? {
      member_name: log.member_name,
      subtotal_cents: 0,
      items: []
    };

    const qty = log.quantity && log.quantity > 0 ? log.quantity : 1;
    const total = log.amount_cents;

    existing.items.push({
      id: log.id,
      service_date: log.service_date,
      category_name: log.category_name,
      quantity: qty,
      unit_amount_cents: Math.round(total / qty),
      total_amount_cents: total,
      source_entity: log.source_entity ?? null,
      source_entity_id: log.source_entity_id ?? null,
      reconciliation_status: log.reconciliation_status ?? "open",
      reconciled_by: log.reconciled_by ?? null,
      reconciled_at: log.reconciled_at ?? null,
      reconciliation_note: log.reconciliation_note ?? null
    });

    existing.subtotal_cents += total;
    perMember.set(log.member_name, existing);
  });

  return Array.from(perMember.values())
    .map((member) => ({
      ...member,
      items: member.items.sort((a, b) => (a.service_date < b.service_date ? 1 : -1))
    }))
    .sort((a, b) => (a.member_name > b.member_name ? 1 : -1));
}

function csvEscape(value: string | number | null | undefined) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\n") || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadMonthlyCsv(month: string, memberRows: MemberRow[], grandTotal: number) {
  const header = [
    "Month",
    "Member",
    "Service Date",
    "Charge Item",
    "Quantity",
    "Unit Amount",
    "Line Total",
    "Source Module",
    "Source Record",
    "Reconciliation Status",
    "Reconciled By",
    "Reconciled At",
    "Reconciliation Note"
  ];

  const lines = [header.join(",")];

  memberRows.forEach((member) => {
    member.items.forEach((item) => {
      lines.push(
        [
          month,
          member.member_name,
          item.service_date,
          item.category_name,
          item.quantity,
          (item.unit_amount_cents / 100).toFixed(2),
          (item.total_amount_cents / 100).toFixed(2),
          item.source_entity ?? "Manual",
          item.source_entity_id ?? "",
          item.reconciliation_status,
          item.reconciled_by ?? "",
          item.reconciled_at ?? "",
          item.reconciliation_note ?? ""
        ]
          .map((value) => csvEscape(value))
          .join(",")
      );
    });

    lines.push([
      csvEscape(month),
      csvEscape(member.member_name),
      "",
      "Member Subtotal",
      "",
      "",
      csvEscape((member.subtotal_cents / 100).toFixed(2)),
      "",
      "",
      "",
      "",
      "",
      ""
    ].join(","));
  });

  lines.push([
    csvEscape(month),
    "ALL MEMBERS",
    "",
    "Monthly Grand Total",
    "",
    "",
    csvEscape((grandTotal / 100).toFixed(2)),
    "",
    "",
    "",
    "",
    "",
    ""
  ].join(","));

  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `monthly-ancillary-charges-${month}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadMonthlyExcelXml(month: string, memberRows: MemberRow[], grandTotal: number) {
  const headers = [
    "Month",
    "Member",
    "Service Date",
    "Charge Item",
    "Quantity",
    "Unit Amount",
    "Line Total",
    "Source Module",
    "Source Record",
    "Reconciliation Status",
    "Reconciled By",
    "Reconciled At",
    "Reconciliation Note"
  ];

  const rows: Array<Array<string | number>> = [];
  memberRows.forEach((member) => {
    member.items.forEach((item) => {
      rows.push([
        month,
        member.member_name,
        item.service_date,
        item.category_name,
        item.quantity,
        (item.unit_amount_cents / 100).toFixed(2),
        (item.total_amount_cents / 100).toFixed(2),
        item.source_entity ?? "Manual",
        item.source_entity_id ?? "",
        item.reconciliation_status,
        item.reconciled_by ?? "",
        item.reconciled_at ?? "",
        item.reconciliation_note ?? ""
      ]);
    });
    rows.push([month, member.member_name, "", "Member Subtotal", "", "", (member.subtotal_cents / 100).toFixed(2), "", "", "", "", "", ""]);
  });
  rows.push([month, "ALL MEMBERS", "", "Monthly Grand Total", "", "", (grandTotal / 100).toFixed(2), "", "", "", "", "", ""]);

  const xmlHeader = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="MonthlyAncillary">
<Table>`;
  const xmlFooter = `</Table></Worksheet></Workbook>`;

  const escapeXml = (value: string | number) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const headerRow = `<Row>${headers.map((h) => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`).join("")}</Row>`;
  const bodyRows = rows
    .map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join("")}</Row>`)
    .join("");

  const xml = `${xmlHeader}${headerRow}${bodyRows}${xmlFooter}`;
  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `monthly-ancillary-charges-${month}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function MonthlyAncillaryReport({
  availableMonths,
  selectedMonth,
  logs
}: {
  availableMonths: string[];
  selectedMonth: string;
  logs: AncillaryLog[];
}) {
  const [entries, setEntries] = useState(logs);
  const [month, setMonth] = useState(selectedMonth);
  const [reconciliationFilter, setReconciliationFilter] = useState<"all" | "open" | "reconciled" | "void">("all");
  const [status, setStatus] = useState<string | null>(null);
  const { isSaving, run } = useScopedMutation();

  useEffect(() => {
    setEntries(logs);
  }, [logs]);

  const memberRows = useMemo(() => buildMemberRows(entries, month, reconciliationFilter), [entries, month, reconciliationFilter]);
  const grandTotal = useMemo(() => memberRows.reduce((sum, row) => sum + row.subtotal_cents, 0), [memberRows]);
  const monthEntryIdsToReconcile = useMemo(
    () =>
      entries
        .filter((log) => monthKeyFromDate(log.service_date) === month)
        .filter((log) => (log.reconciliation_status ?? "open") !== "reconciled")
        .filter((log) => (log.reconciliation_status ?? "open") !== "void")
        .map((log) => log.id),
    [entries, month]
  );

  function handleDelete(entryId: string) {
    if (!window.confirm("Delete this ancillary charge entry? This cannot be undone.")) {
      return;
    }

    void run(
      async () =>
        runDocumentationUpdateAction({
          kind: "deleteWorkflowRecord",
          payload: { entity: "ancillaryLogs", id: entryId }
        }),
      {
        successMessage: "Ancillary charge entry deleted.",
        onSuccess: async (result) => {
          setEntries((current) => current.filter((entry) => entry.id !== entryId));
          setStatus(result.message);
        },
        onError: async (result) => {
          setStatus(`Error: ${result.error}`);
        }
      }
    );
  }

  function handleReconciliation(entryId: string, nextStatus: "open" | "reconciled" | "void") {
    const label = nextStatus === "reconciled" ? "mark as reconciled" : nextStatus === "void" ? "mark as void" : "mark as open";
    if (!window.confirm(`Are you sure you want to ${label}?`)) {
      return;
    }

    void run(
      async () =>
        runDocumentationUpdateAction({
          kind: "setAncillaryReconciliation",
          payload: { id: entryId, status: nextStatus }
        }),
      {
        successMessage: `Entry updated to ${nextStatus}.`,
        onSuccess: async (result) => {
          setEntries((current) =>
            current.map((entry) =>
              entry.id === entryId
                ? {
                    ...entry,
                    reconciliation_status: nextStatus
                  }
                : entry
            )
          );
          setStatus(result.message);
        },
        onError: async (result) => {
          setStatus(`Error: ${result.error}`);
        }
      }
    );
  }

  function handleMarkAllReconciled() {
    if (monthEntryIdsToReconcile.length === 0) {
      setStatus("No unreconciled entries for the selected month.");
      return;
    }

    if (!window.confirm(`Mark all ${monthEntryIdsToReconcile.length} eligible entries for ${month} as reconciled?`)) {
      return;
    }

    void run(async () => {
      let successCount = 0;
      let failureCount = 0;
      const updatedIds: string[] = [];

      for (const entryId of monthEntryIdsToReconcile) {
        const result = await runDocumentationUpdateAction({
          kind: "setAncillaryReconciliation",
          payload: { id: entryId, status: "reconciled" }
        });
        if ("error" in result) {
          failureCount += 1;
        } else {
          successCount += 1;
          updatedIds.push(entryId);
        }
      }

      setEntries((current) =>
        current.map((entry) =>
          updatedIds.includes(entry.id)
            ? {
                ...entry,
                reconciliation_status: "reconciled"
              }
            : entry
        )
      );

      if (failureCount === 0) {
        return { ok: true, message: `Marked ${successCount} entries as reconciled for ${month}.` };
      }

      return {
        ok: false,
        error: `Marked ${successCount} reconciled; ${failureCount} failed. Retry the remaining entries.`
      };
    }, {
      onSuccess: async (result) => {
        setStatus(result.message);
      },
      onError: async (result) => {
        setStatus(`Error: ${result.error}`);
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Monthly Ancillary Charges by Member</CardTitle>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Month</span>
            <select className="h-11 w-full rounded-lg border border-border px-3" value={month} onChange={(e) => setMonth(e.target.value)}>
              {availableMonths.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Reconciliation</span>
            <select className="h-11 w-full rounded-lg border border-border px-3" value={reconciliationFilter} onChange={(e) => setReconciliationFilter(e.target.value as "all" | "open" | "reconciled" | "void")}>
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="reconciled">Reconciled</option>
              <option value="void">Void</option>
            </select>
          </label>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Members with Charges</p>
            <p className="text-lg font-semibold">{memberRows.length}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Grand Total</p>
            <p className="text-lg font-semibold">${(grandTotal / 100).toFixed(2)}</p>
          </div>
        </div>
        <div className="mt-3">
          <Button
            type="button"
            onClick={handleMarkAllReconciled}
            disabled={isSaving || monthEntryIdsToReconcile.length === 0}
          >
            Mark All as Reconciled ({monthEntryIdsToReconcile.length})
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" onClick={() => downloadMonthlyCsv(month, memberRows, grandTotal)}>
            Export CSV
          </Button>
          <Button type="button" onClick={() => downloadMonthlyExcelXml(month, memberRows, grandTotal)}>
            Export Excel (.xls)
          </Button>
          <MutationNotice kind={status?.startsWith("Error") ? "error" : "success"} message={status} className="self-center" />
        </div>
      </Card>

      <div className="grid gap-3 md:hidden">
        {memberRows.map((member) => (
          <Card key={member.member_name}>
            <CardTitle>{member.member_name} - Subtotal ${(member.subtotal_cents / 100).toFixed(2)}</CardTitle>
            <div className="mt-2 space-y-2">
              {member.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-border p-2 text-xs">
                  <p className="font-semibold text-fg">{formatDate(item.service_date)} - {item.category_name}</p>
                  <p className="text-muted">Qty {item.quantity} | ${ (item.unit_amount_cents / 100).toFixed(2) } each | Line ${ (item.total_amount_cents / 100).toFixed(2) }</p>
                  <p className="text-muted">Source: {item.source_entity ?? "Manual"}</p>
                  <p className="text-muted">Reconciliation: {item.reconciliation_status}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.reconciliation_status === "open" ? (
                      <button
                        type="button"
                        className="rounded border border-green-300 px-2 py-1 font-semibold text-green-700"
                        onClick={() => handleReconciliation(item.id, "reconciled")}
                        disabled={isSaving}
                      >
                        Reconcile
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700"
                        onClick={() => handleReconciliation(item.id, "open")}
                        disabled={isSaving}
                      >
                        Mark Open
                      </button>
                    )}
                    {item.reconciliation_status === "open" || item.reconciliation_status === "reconciled" ? (
                      <button
                        type="button"
                        className="rounded border border-amber-300 px-2 py-1 font-semibold text-amber-700"
                        onClick={() => handleReconciliation(item.id, "void")}
                        disabled={isSaving}
                      >
                        Void
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="mt-2 rounded border border-red-300 px-2 py-1 font-semibold text-red-700"
                    onClick={() => handleDelete(item.id)}
                    disabled={isSaving}
                  >
                    Delete Entry
                  </button>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {memberRows.map((member) => (
        <Card key={member.member_name} className="table-wrap hidden md:block">
          <CardTitle>{member.member_name} - Subtotal ${(member.subtotal_cents / 100).toFixed(2)}</CardTitle>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Charge Item</th>
                <th>Qty</th>
                <th>Per Item</th>
                <th>Line Total</th>
                <th>Source</th>
                <th>Reconciliation</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {member.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.service_date)}</td>
                  <td>{item.category_name}</td>
                  <td>{item.quantity}</td>
                  <td>${(item.unit_amount_cents / 100).toFixed(2)}</td>
                  <td>${(item.total_amount_cents / 100).toFixed(2)}</td>
                  <td>{item.source_entity ?? "Manual"}</td>
                  <td>
                    <div className="space-y-1 text-xs">
                      <p className="font-semibold">{item.reconciliation_status}</p>
                      {item.reconciled_by ? <p className="text-muted">{item.reconciled_by}</p> : null}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {item.reconciliation_status === "open" ? (
                        <button
                          type="button"
                          className="rounded border border-green-300 px-2 py-1 text-xs font-semibold text-green-700"
                          onClick={() => handleReconciliation(item.id, "reconciled")}
                          disabled={isSaving}
                        >
                          Reconcile
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                          onClick={() => handleReconciliation(item.id, "open")}
                          disabled={isSaving}
                        >
                          Mark Open
                        </button>
                      )}
                      {item.reconciliation_status === "open" || item.reconciliation_status === "reconciled" ? (
                        <button
                          type="button"
                          className="rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-700"
                          onClick={() => handleReconciliation(item.id, "void")}
                          disabled={isSaving}
                        >
                          Void
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700"
                        onClick={() => handleDelete(item.id)}
                        disabled={isSaving}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
