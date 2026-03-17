import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  formatBillingPayorAddress,
  formatBillingPayorDisplayName,
  getBillingPayorContact,
  type BillingPayorContact
} from "@/lib/services/billing-payor-contacts";

type BillingInvoiceDocumentLine = {
  description: string;
  serviceDate: string | null;
  quantity: number;
  unitRate: number;
  amount: number;
};

export type BillingInvoiceDocumentModel = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceMonth: string;
  invoiceStatus: string;
  invoiceDate: string | null;
  dueDate: string | null;
  memberId: string;
  memberName: string;
  payor: BillingPayorContact;
  billToName: string;
  billToAddressLines: string[];
  billToEmail: string | null;
  billToPhone: string | null;
  billToMessage: string | null;
  basePeriodLabel: string;
  variablePeriodLabel: string;
  lineItems: BillingInvoiceDocumentLine[];
  totalAmount: number;
  generatedAt: string;
};

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDateOnly(value: unknown) {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  return raw.length > 0 ? raw : null;
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

function buildBillToFields(payor: BillingPayorContact) {
  if (payor.status !== "ok") {
    return {
      billToName: "No payor contact designated",
      billToAddressLines: [],
      billToEmail: null,
      billToPhone: null,
      billToMessage:
        payor.status === "invalid_multiple"
          ? "Multiple payor contacts are flagged. Resolve the conflict in Member Command Center."
          : "No payor contact designated"
    };
  }

  return {
    billToName: formatBillingPayorDisplayName(payor),
    billToAddressLines: formatBillingPayorAddress(payor),
    billToEmail: payor.email,
    billToPhone: payor.phone,
    billToMessage: null
  };
}

export function buildBillingInvoiceDocumentModel(input: {
  invoice: Record<string, unknown>;
  memberName: string;
  payor: BillingPayorContact;
  lines: Array<Record<string, unknown>>;
  generatedAt: string;
}): BillingInvoiceDocumentModel {
  const invoiceId = String(input.invoice.id ?? "");
  const totalAmount = asNumber(input.invoice.total_amount);
  const billTo = buildBillToFields(input.payor);

  return {
    invoiceId,
    invoiceNumber: String(input.invoice.invoice_number ?? ""),
    invoiceMonth: String(input.invoice.invoice_month ?? ""),
    invoiceStatus: String(input.invoice.invoice_status ?? "Draft"),
    invoiceDate: normalizeDateOnly(input.invoice.invoice_date),
    dueDate: normalizeDateOnly(input.invoice.due_date),
    memberId: String(input.invoice.member_id ?? ""),
    memberName: input.memberName,
    payor: input.payor,
    billToName: billTo.billToName,
    billToAddressLines: billTo.billToAddressLines,
    billToEmail: billTo.billToEmail,
    billToPhone: billTo.billToPhone,
    billToMessage: billTo.billToMessage,
    basePeriodLabel: `${normalizeDateOnly(input.invoice.base_period_start) ?? ""} to ${normalizeDateOnly(input.invoice.base_period_end) ?? ""}`,
    variablePeriodLabel: `${normalizeDateOnly(input.invoice.variable_charge_period_start) ?? ""} to ${normalizeDateOnly(input.invoice.variable_charge_period_end) ?? ""}`,
    lineItems: input.lines.map((line) => ({
      description: String(line.description ?? ""),
      serviceDate: normalizeDateOnly(line.service_date),
      quantity: asNumber(line.quantity),
      unitRate: asNumber(line.unit_rate),
      amount: asNumber(line.amount)
    })),
    totalAmount,
    generatedAt: input.generatedAt
  };
}

export async function getBillingInvoiceDocumentModel(invoiceId: string) {
  const supabase = await createClient();
  const [{ data: invoice, error: invoiceError }, { data: lines, error: linesError }] = await Promise.all([
    supabase.from("billing_invoices").select("*").eq("id", invoiceId).maybeSingle(),
    supabase.from("billing_invoice_lines").select("*").eq("invoice_id", invoiceId).order("created_at", { ascending: true })
  ]);
  if (invoiceError) throw new Error(invoiceError.message);
  if (!invoice) throw new Error("Invoice not found.");
  if (linesError) throw new Error(linesError.message);

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id, display_name")
    .eq("id", String((invoice as any).member_id))
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);

  const payor = await getBillingPayorContact(String((invoice as any).member_id), {
    logMissing: true,
    source: "getBillingInvoiceDocumentModel"
  });

  return buildBillingInvoiceDocumentModel({
    invoice: invoice as Record<string, unknown>,
    memberName: String((member as any)?.display_name ?? "Unknown Member"),
    payor,
    lines: (lines ?? []) as Array<Record<string, unknown>>,
    generatedAt: new Date().toISOString()
  });
}

export async function buildBillingInvoicePdfBytes(model: BillingInvoiceDocumentModel) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = 748;
  const left = 48;
  const right = 564;

  const drawText = (text: string, x: number, size = 10, useBold = false, color = rgb(0.1, 0.12, 0.16)) => {
    page.drawText(text, {
      x,
      y,
      size,
      font: useBold ? bold : font,
      color
    });
    y -= size + 4;
  };

  drawText("Invoice", left, 20, true);
  drawText(`Invoice #: ${model.invoiceNumber || model.invoiceId}`, left, 11, true);
  drawText(`Status: ${model.invoiceStatus}`, left);
  drawText(`Invoice Date: ${model.invoiceDate ?? "-"}`, left);
  drawText(`Due Date: ${model.dueDate ?? "-"}`, left);

  y -= 8;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: rgb(0.85, 0.87, 0.9) });
  y -= 18;

  const sectionTop = y;
  let leftColumnY = sectionTop;
  const drawColumnText = (text: string, x: number, cursor: number, size = 10, useBold = false) => {
    page.drawText(text, {
      x,
      y: cursor,
      size,
      font: useBold ? bold : font,
      color: rgb(0.1, 0.12, 0.16)
    });
    return cursor - (size + 4);
  };
  leftColumnY = drawColumnText("Member", left, leftColumnY, 12, true);
  leftColumnY = drawColumnText(model.memberName, left, leftColumnY);
  leftColumnY = drawColumnText(`Base Period: ${model.basePeriodLabel}`, left, leftColumnY);
  leftColumnY = drawColumnText(`Variable Period: ${model.variablePeriodLabel}`, left, leftColumnY);

  let rightColumnY = sectionTop;
  rightColumnY = drawColumnText("Bill To", 330, rightColumnY, 12, true);
  rightColumnY = drawColumnText(model.billToName, 330, rightColumnY);
  if (model.billToAddressLines.length > 0) {
    for (const line of model.billToAddressLines) {
      rightColumnY = drawColumnText(line, 330, rightColumnY);
    }
  }
  if (model.billToEmail) rightColumnY = drawColumnText(model.billToEmail, 330, rightColumnY);
  if (model.billToPhone) rightColumnY = drawColumnText(model.billToPhone, 330, rightColumnY);
  if (model.billToMessage) rightColumnY = drawColumnText(model.billToMessage, 330, rightColumnY);

  y = Math.min(leftColumnY, rightColumnY) - 8;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: rgb(0.85, 0.87, 0.9) });
  y -= 18;
  page.drawText("Description", { x: left, y, size: 10, font: bold });
  page.drawText("Date", { x: 320, y, size: 10, font: bold });
  page.drawText("Qty", { x: 392, y, size: 10, font: bold });
  page.drawText("Rate", { x: 436, y, size: 10, font: bold });
  page.drawText("Amount", { x: 500, y, size: 10, font: bold });
  y -= 14;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.75, color: rgb(0.85, 0.87, 0.9) });
  y -= 14;

  const items = model.lineItems.length > 0 ? model.lineItems : [{ description: "No invoice lines available", serviceDate: null, quantity: 0, unitRate: 0, amount: 0 }];
  for (const line of items) {
    page.drawText(line.description.slice(0, 52), { x: left, y, size: 10, font });
    page.drawText(line.serviceDate ?? "-", { x: 320, y, size: 10, font });
    page.drawText(String(line.quantity || 0), { x: 392, y, size: 10, font });
    page.drawText(formatMoney(line.unitRate), { x: 436, y, size: 10, font });
    page.drawText(formatMoney(line.amount), { x: 500, y, size: 10, font });
    y -= 16;
    if (y < 110) break;
  }

  y -= 8;
  page.drawLine({ start: { x: 404, y }, end: { x: right, y }, thickness: 1, color: rgb(0.85, 0.87, 0.9) });
  y -= 18;
  page.drawText("Total", { x: 436, y, size: 11, font: bold });
  page.drawText(formatMoney(model.totalAmount), { x: 500, y, size: 11, font: bold });

  return Buffer.from(await pdf.save());
}
