import assert from "node:assert/strict";
import test from "node:test";

import {
  QUICKBOOKS_INVOICE_IMPORT_HEADER,
  buildQuickBooksInvoiceCsv
} from "../lib/services/billing-quickbooks-export";

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function buildBaseInvoice() {
  return {
    id: "inv-1",
    member_id: "member-1",
    payor_id: null,
    invoice_number: "INV-1001",
    invoice_month: "2026-03-01",
    invoice_date: "2026-04-01",
    due_date: "2026-05-01",
    base_period_start: "2026-03-01",
    base_period_end: "2026-03-31",
    bill_to_name_snapshot: "Chris Smith",
    created_at: "2026-04-01T12:00:00.000Z"
  };
}

function buildBaseLines() {
  return [
    {
      invoice_id: "inv-1",
      line_number: 1,
      product_or_service: "Member Fees",
      line_type: "BaseProgram",
      description: "03/02/2026 / Attended / Chris Smith",
      service_date: "2026-03-02",
      quantity: 1,
      unit_rate: 50,
      amount: 50
    },
    {
      invoice_id: "inv-1",
      line_number: 2,
      product_or_service: "Member Fees",
      line_type: "BaseProgram",
      description: "03/04/2026 / Attended / Chris Smith",
      service_date: "2026-03-04",
      quantity: 1,
      unit_rate: 50,
      amount: 50
    },
    {
      invoice_id: "inv-1",
      line_number: 3,
      product_or_service: "Transportation",
      line_type: "Transportation",
      description: "Transportation",
      service_date: "2026-03-02",
      quantity: 1,
      unit_rate: 10,
      amount: 10
    },
    {
      invoice_id: "inv-1",
      line_number: 4,
      product_or_service: "Ancillary",
      line_type: "Ancillary",
      description: "Briefs",
      service_date: "2026-03-04",
      quantity: 3,
      unit_rate: 2,
      amount: 6
    }
  ];
}

test("QuickBooks summary CSV matches the invoice import template contract", () => {
  const csv = buildQuickBooksInvoiceCsv({
    invoices: [buildBaseInvoice()],
    lines: buildBaseLines(),
    detailLevel: "Summary",
    customerNameByInvoiceId: new Map([["inv-1", "Chris Smith"]]),
    attendedDatesByInvoiceId: new Map([["inv-1", ["2026-03-02", "2026-03-04"]]])
  });

  const rows = csv.split("\n").map(parseCsvLine);
  assert.deepEqual(rows[0], [...QUICKBOOKS_INVOICE_IMPORT_HEADER]);
  assert.equal(rows.length, 4);

  assert.deepEqual(rows[1], [
    "INV-1001",
    "Chris Smith",
    "01/04/2026",
    "01/05/2026",
    "Net 30",
    "",
    "Days attended: 3/2, 3/4",
    "Daily Rate",
    "Attendance charges for March 2026",
    "2",
    "50",
    "100",
    "31/03/2026"
  ]);
  assert.deepEqual(rows[2], [
    "INV-1001",
    "",
    "",
    "",
    "",
    "",
    "",
    "Transport",
    "Transportation",
    "1",
    "10",
    "10",
    "02/03/2026"
  ]);
  assert.deepEqual(rows[3], [
    "INV-1001",
    "",
    "",
    "",
    "",
    "",
    "",
    "Briefs",
    "Briefs",
    "3",
    "2",
    "6",
    "04/03/2026"
  ]);
});

test("QuickBooks detailed CSV preserves raw finalized invoice lines", () => {
  const csv = buildQuickBooksInvoiceCsv({
    invoices: [buildBaseInvoice()],
    lines: buildBaseLines(),
    detailLevel: "Detailed",
    customerNameByInvoiceId: new Map([["inv-1", "Chris Smith"]]),
    attendedDatesByInvoiceId: new Map([["inv-1", ["2026-03-02", "2026-03-04"]]])
  });

  const rows = csv.split("\n").map(parseCsvLine);
  assert.equal(rows.length, 5);
  assert.equal(rows[1][7], "Daily Rate");
  assert.equal(rows[1][8], "Attendance on 3/2");
  assert.equal(rows[1][12], "02/03/2026");
  assert.equal(rows[2][7], "Daily Rate");
  assert.equal(rows[2][8], "Attendance on 3/4");
  assert.equal(rows[2][12], "04/03/2026");
});

test("QuickBooks export fails explicitly when an invoice is missing a valid customer", () => {
  assert.throws(
    () =>
      buildQuickBooksInvoiceCsv({
        invoices: [
          {
            ...buildBaseInvoice(),
            bill_to_name_snapshot: ""
          }
        ],
        lines: buildBaseLines(),
        detailLevel: "Summary",
        customerNameByInvoiceId: new Map(),
        attendedDatesByInvoiceId: new Map()
      }),
    /missing a valid QuickBooks customer name/i
  );
});
