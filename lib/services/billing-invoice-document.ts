import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@/lib/supabase/server";
import { getBillingPayorContact, type BillingPayorContact } from "@/lib/services/billing-payor-contacts";
import {
  buildBillingInvoiceBillToSnapshot,
  formatInvoiceServiceDate,
  resolveInvoiceProductOrService
} from "@/lib/services/billing-invoice-format";
import {
  DOCUMENT_CENTER_ADDRESS_LINE_1,
  DOCUMENT_CENTER_ADDRESS_LINE_2,
  DOCUMENT_CENTER_LOGO_PUBLIC_PATH,
  DOCUMENT_CENTER_NAME,
  DOCUMENT_CENTER_PHONE
} from "@/lib/services/document-branding";
import type { Database } from "@/types/supabase-types";
import type { PDFDocument as PDFDocumentType, PDFFont, PDFImage, PDFPage, RGB } from "pdf-lib";

type BillingInvoiceRow = Database["public"]["Tables"]["billing_invoices"]["Row"];
type BillingInvoiceLineRow = Database["public"]["Tables"]["billing_invoice_lines"]["Row"];
type MemberDisplayNameRow = Pick<Database["public"]["Tables"]["members"]["Row"], "id" | "display_name">;

type BillingInvoiceDocumentLine = {
  lineNumber: number;
  serviceDate: string | null;
  productOrService: string;
  description: string;
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
  billToName: string;
  billToAddressLines: string[];
  billToEmail: string | null;
  billToPhone: string | null;
  billToMessage: string | null;
  lineItems: BillingInvoiceDocumentLine[];
  subtotal: number;
  paymentsAmount: number;
  balanceDueAmount: number;
  totalAmount: number;
  generatedAt: string;
};

function clean(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

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

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "-";
  return formatInvoiceServiceDate(value) || value;
}

function formatMoney(value: number, options?: { negative?: boolean }) {
  const amount = Math.abs(value);
  const dollars = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return options?.negative && amount > 0 ? `-$${dollars}` : `$${dollars}`;
}

function publicAssetPath(publicPath: string) {
  const normalized = publicPath.startsWith("/") ? publicPath.slice(1) : publicPath;
  return path.join(process.cwd(), "public", normalized);
}

async function loadCenterLogoImage(pdf: PDFDocumentType) {
  try {
    const bytes = await readFile(publicAssetPath(DOCUMENT_CENTER_LOGO_PUBLIC_PATH));
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

function resolveHeaderLogoWidth(logo: PDFImage | null, logoHeight: number, maxWidth: number) {
  if (!logo) return 0;
  const scaled = logo.scale(logoHeight / logo.height);
  return Math.min(scaled.width, maxWidth);
}

function wrapText(text: string, width: number, font: PDFFont, size: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = words[0] ?? "";
  for (const word of words.slice(1)) {
    const next = `${current} ${word}`.trim();
    if (font.widthOfTextAtSize(next, size) <= width) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
  }
  lines.push(current);
  return lines;
}

function drawLines(input: {
  page: PDFPage;
  lines: string[];
  x: number;
  y: number;
  font: PDFFont;
  size: number;
  color: RGB;
  lineGap?: number;
}) {
  const { page, lines, x, y, font, size, color } = input;
  const lineGap = input.lineGap ?? 3;
  let cursor = y;
  lines.forEach((line) => {
    page.drawText(line, { x, y: cursor, size, font, color });
    cursor -= size + lineGap;
  });
  return cursor;
}

function drawFooter(input: {
  page: PDFPage;
  font: PDFFont;
  left: number;
  right: number;
  text: RGB;
  divider: RGB;
  pageNumber: number;
}) {
  const { page, font, left, right, text, divider, pageNumber } = input;
  const footerY = 32;
  page.drawLine({
    start: { x: left, y: footerY + 14 },
    end: { x: right, y: footerY + 14 },
    thickness: 0.8,
    color: divider
  });
  const footerText = `${DOCUMENT_CENTER_NAME} | ${DOCUMENT_CENTER_PHONE}`;
  page.drawText(footerText, {
    x: left,
    y: footerY,
    size: 8.5,
    font,
    color: text
  });
  const pageLabel = `Page ${pageNumber}`;
  page.drawText(pageLabel, {
    x: right - font.widthOfTextAtSize(pageLabel, 8.5),
    y: footerY,
    size: 8.5,
    font,
    color: text
  });
}

function drawPageHeader(input: {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  logo: PDFImage | null;
  left: number;
  right: number;
  brand: RGB;
  text: RGB;
  divider: RGB;
}) {
  const { page, font, bold, logo, left, right, brand, text, divider } = input;
  let y = 748;
  const logoHeight = 42;
  const logoWidth = resolveHeaderLogoWidth(logo, logoHeight, 132);

  if (logo) {
    page.drawImage(logo, {
      x: left,
      y: y - logoHeight + 8,
      width: logoWidth,
      height: logoHeight
    });
  }

  const infoX = left + (logoWidth > 0 ? Math.max(logoWidth + 12, 144) : 0);

  page.drawText("INVOICE", {
    x: right - bold.widthOfTextAtSize("INVOICE", 22),
    y: y + 6,
    size: 22,
    font: bold,
    color: brand
  });

  y -= 4;
  page.drawText(DOCUMENT_CENTER_NAME, {
    x: infoX,
    y,
    size: 13,
    font: bold,
    color: text
  });
  y -= 15;
  page.drawText(DOCUMENT_CENTER_ADDRESS_LINE_1, {
    x: infoX,
    y,
    size: 9.5,
    font,
    color: text
  });
  y -= 12;
  page.drawText(DOCUMENT_CENTER_ADDRESS_LINE_2, {
    x: infoX,
    y,
    size: 9.5,
    font,
    color: text
  });
  y -= 12;
  page.drawText(DOCUMENT_CENTER_PHONE, {
    x: infoX,
    y,
    size: 9.5,
    font,
    color: text
  });

  page.drawLine({
    start: { x: left, y: 688 },
    end: { x: right, y: 688 },
    thickness: 1,
    color: divider
  });
}

function drawFirstPageSections(input: {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  left: number;
  right: number;
  brand: RGB;
  text: RGB;
  divider: RGB;
  model: BillingInvoiceDocumentModel;
}) {
  const { page, font, bold, left, right, brand, text, divider, model } = input;
  let billToY = 656;
  page.drawText("Bill to", {
    x: left,
    y: billToY,
    size: 11,
    font: bold,
    color: brand
  });
  billToY -= 16;
  billToY = drawLines({
    page,
    lines: [model.billToName],
    x: left,
    y: billToY,
    font: bold,
    size: 10,
    color: text
  });
  if (model.billToAddressLines.length > 0) {
    billToY = drawLines({
      page,
      lines: model.billToAddressLines,
      x: left,
      y: billToY,
      font,
      size: 10,
      color: text
    });
  }
  if (model.billToEmail) {
    billToY = drawLines({
      page,
      lines: [model.billToEmail],
      x: left,
      y: billToY,
      font,
      size: 10,
      color: text
    });
  }
  if (model.billToPhone) {
    billToY = drawLines({
      page,
      lines: [model.billToPhone],
      x: left,
      y: billToY,
      font,
      size: 10,
      color: text
    });
  }
  if (model.billToMessage) {
    billToY = drawLines({
      page,
      lines: wrapText(model.billToMessage, 220, font, 9),
      x: left,
      y: billToY,
      font,
      size: 9,
      color: text
    });
  }

  let detailY = 656;
  const detailX = 360;
  page.drawText("Invoice details", {
    x: detailX,
    y: detailY,
    size: 11,
    font: bold,
    color: brand
  });
  detailY -= 16;
  const detailLines = [
    `Invoice no.: ${model.invoiceNumber || model.invoiceId}`,
    `Invoice date: ${formatDisplayDate(model.invoiceDate)}`,
    `Due date: ${formatDisplayDate(model.dueDate)}`,
    `Status: ${model.invoiceStatus}`
  ];
  detailLines.forEach((line) => {
    page.drawText(line, {
      x: detailX,
      y: detailY,
      size: 10,
      font,
      color: text
    });
    detailY -= 14;
  });

  const sectionBottom = Math.min(billToY, detailY) - 6;
  page.drawLine({
    start: { x: left, y: sectionBottom },
    end: { x: right, y: sectionBottom },
    thickness: 1,
    color: divider
  });

  return sectionBottom - 22;
}

function drawContinuationDetails(input: {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  left: number;
  text: RGB;
  brand: RGB;
  model: BillingInvoiceDocumentModel;
}) {
  const { page, font, bold, left, text, brand, model } = input;
  const label = `Invoice ${model.invoiceNumber || model.invoiceId} | ${model.memberName}`;
  page.drawText(label, {
    x: left,
    y: 662,
    size: 10,
    font: bold,
    color: brand
  });
  page.drawText(`Invoice date ${formatDisplayDate(model.invoiceDate)} | Due ${formatDisplayDate(model.dueDate)}`, {
    x: left,
    y: 648,
    size: 9,
    font,
    color: text
  });
  return 622;
}

function drawTableHeader(input: {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
  brand: RGB;
  text: RGB;
  divider: RGB;
}) {
  const { page, bold, y, brand, divider, text, font } = input;
  const columns = [
    { label: "#", x: 36 },
    { label: "Service Date", x: 68 },
    { label: "Product / Service", x: 144 },
    { label: "Description", x: 244 },
    { label: "Qty", x: 430 },
    { label: "Rate", x: 462 },
    { label: "Amount", x: 516 }
  ];
  page.drawRectangle({
    x: 36,
    y: y - 6,
    width: 540,
    height: 22,
    color: brand,
    opacity: 0.08,
    borderColor: divider,
    borderWidth: 0.5
  });
  columns.forEach((column) => {
    page.drawText(column.label, {
      x: column.x,
      y,
      size: 9.5,
      font: bold,
      color: text
    });
  });
  return y - 20;
}

function resolveBillToSnapshot(input: {
  invoice: Record<string, unknown>;
  fallbackSnapshot: ReturnType<typeof buildBillingInvoiceBillToSnapshot>;
}) {
  const invoiceLines = [
    clean(input.invoice.bill_to_address_line_1_snapshot),
    clean(input.invoice.bill_to_address_line_2_snapshot),
    clean(input.invoice.bill_to_address_line_3_snapshot)
  ].filter((value): value is string => Boolean(value));

  return {
    billToName:
      clean(input.invoice.bill_to_name_snapshot) ??
      input.fallbackSnapshot.bill_to_name_snapshot ??
      "No payor contact designated",
    billToAddressLines:
      invoiceLines.length > 0
        ? invoiceLines
        : [
            input.fallbackSnapshot.bill_to_address_line_1_snapshot,
            input.fallbackSnapshot.bill_to_address_line_2_snapshot,
            input.fallbackSnapshot.bill_to_address_line_3_snapshot
          ].filter((value): value is string => Boolean(value)),
    billToEmail:
      clean(input.invoice.bill_to_email_snapshot) ?? input.fallbackSnapshot.bill_to_email_snapshot ?? null,
    billToPhone:
      clean(input.invoice.bill_to_phone_snapshot) ?? input.fallbackSnapshot.bill_to_phone_snapshot ?? null,
    billToMessage:
      clean(input.invoice.bill_to_message_snapshot) ?? input.fallbackSnapshot.bill_to_message_snapshot ?? null
  };
}

export function buildBillingInvoiceDocumentModel(input: {
  invoice: Record<string, unknown>;
  memberName: string;
  fallbackBillToSnapshot?: ReturnType<typeof buildBillingInvoiceBillToSnapshot>;
  payor?: BillingPayorContact;
  lines: Array<Record<string, unknown>>;
  generatedAt: string;
}): BillingInvoiceDocumentModel {
  const fallbackBillToSnapshot =
    input.fallbackBillToSnapshot ?? buildBillingInvoiceBillToSnapshot(input.payor ?? {
      status: "missing",
      contact_id: null,
      member_id: String(input.invoice.member_id ?? ""),
      full_name: null,
      relationship_to_member: null,
      email: null,
      cellular_number: null,
      work_number: null,
      home_number: null,
      phone: null,
      address_line_1: null,
      address_line_2: null,
      city: null,
      state: null,
      postal_code: null,
      quickbooks_customer_id: null,
      multiple_contact_ids: []
    });
  const resolvedBillTo = resolveBillToSnapshot({
    invoice: input.invoice,
    fallbackSnapshot: fallbackBillToSnapshot
  });
  const lineItems = input.lines.map((line, index) => ({
    lineNumber: asNumber(line.line_number) || index + 1,
    serviceDate: normalizeDateOnly(line.service_date),
    productOrService: clean(line.product_or_service) ?? resolveInvoiceProductOrService(String(line.line_type ?? "")),
    description: String(line.description ?? "").trim(),
    quantity: asNumber(line.quantity),
    unitRate: asNumber(line.unit_rate),
    amount: asNumber(line.amount)
  }));
  const subtotal = lineItems.length > 0 ? lineItems.reduce((sum, line) => sum + line.amount, 0) : asNumber(input.invoice.total_amount);
  const paymentsAmount = asNumber(input.invoice.payments_amount);
  const totalAmount = asNumber(input.invoice.total_amount);
  const balanceDueAmount =
    clean(input.invoice.balance_due_amount) != null
      ? asNumber(input.invoice.balance_due_amount)
      : Math.max(0, subtotal - paymentsAmount);

  return {
    invoiceId: String(input.invoice.id ?? ""),
    invoiceNumber: String(input.invoice.invoice_number ?? ""),
    invoiceMonth: String(input.invoice.invoice_month ?? ""),
    invoiceStatus: String(input.invoice.invoice_status ?? "Draft"),
    invoiceDate: normalizeDateOnly(input.invoice.invoice_date),
    dueDate: normalizeDateOnly(input.invoice.due_date),
    memberId: String(input.invoice.member_id ?? ""),
    memberName: input.memberName,
    billToName: resolvedBillTo.billToName,
    billToAddressLines: resolvedBillTo.billToAddressLines,
    billToEmail: resolvedBillTo.billToEmail,
    billToPhone: resolvedBillTo.billToPhone,
    billToMessage: resolvedBillTo.billToMessage,
    lineItems,
    subtotal,
    paymentsAmount,
    balanceDueAmount,
    totalAmount,
    generatedAt: input.generatedAt
  };
}

export async function getBillingInvoiceDocumentModel(invoiceId: string) {
  const supabase = await createClient();
  const [{ data: invoice, error: invoiceError }, { data: lines, error: linesError }] = await Promise.all([
    supabase.from("billing_invoices").select("*").eq("id", invoiceId).maybeSingle(),
    supabase
      .from("billing_invoice_lines")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("line_number", { ascending: true })
      .order("created_at", { ascending: true })
  ]);
  if (invoiceError) throw new Error(invoiceError.message);
  if (!invoice) throw new Error("Invoice not found.");
  if (linesError) throw new Error(linesError.message);

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id, display_name")
    .eq("id", invoice.member_id)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);

  const fallbackPayor = await getBillingPayorContact(invoice.member_id, {
    logMissing: true,
    source: "getBillingInvoiceDocumentModel"
  });

  return buildBillingInvoiceDocumentModel({
    invoice: invoice as BillingInvoiceRow as Record<string, unknown>,
    memberName: String((member as MemberDisplayNameRow | null)?.display_name ?? "Unknown Member"),
    fallbackBillToSnapshot: buildBillingInvoiceBillToSnapshot(fallbackPayor),
    lines: ((lines ?? []) as BillingInvoiceLineRow[]) as Array<Record<string, unknown>>,
    generatedAt: new Date().toISOString()
  });
}

export async function buildBillingInvoicePdfBytes(model: BillingInvoiceDocumentModel) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadCenterLogoImage(pdf);
  const brand = rgb(0.09, 0.24, 0.55);
  const text = rgb(0.14, 0.17, 0.2);
  const divider = rgb(0.84, 0.86, 0.9);

  const left = 36;
  const right = 576;
  const descriptionWidth = 180;
  const productWidth = 92;
  const footerReserve = 88;

  const pages: PDFPage[] = [];
  const addPage = (continuation: boolean) => {
    const page = pdf.addPage([612, 792]);
    pages.push(page);
    drawPageHeader({ page, font, bold, logo, left, right, brand, text, divider });
    drawFooter({ page, font, left, right, text, divider, pageNumber: pages.length });
    const startY = continuation
      ? drawContinuationDetails({ page, font, bold, left, text, brand, model })
      : drawFirstPageSections({ page, font, bold, left, right, brand, text, divider, model });
    const tableStartY = drawTableHeader({ page, font, bold, y: startY, brand, text, divider });
    return { page, y: tableStartY };
  };

  let state = addPage(false);
  const rows = model.lineItems.length > 0
    ? [...model.lineItems].sort((leftRow, rightRow) => leftRow.lineNumber - rightRow.lineNumber)
    : [{
        lineNumber: 1,
        serviceDate: null,
        productOrService: "Member Fees",
        description: "No invoice lines available",
        quantity: 0,
        unitRate: 0,
        amount: 0
      }];

  rows.forEach((line) => {
    const descriptionLines = wrapText(line.description || "-", descriptionWidth, font, 9);
    const productLines = wrapText(line.productOrService || "-", productWidth, font, 9);
    const rowLineCount = Math.max(descriptionLines.length, productLines.length, 1);
    const rowHeight = rowLineCount * 12 + 10;

    if (state.y - rowHeight < footerReserve) {
      state = addPage(true);
    }

    const topY = state.y;
    state.page.drawText(`${line.lineNumber}.`, {
      x: 36,
      y: topY,
      size: 9.5,
      font,
      color: text
    });
    state.page.drawText(formatDisplayDate(line.serviceDate), {
      x: 68,
      y: topY,
      size: 9.5,
      font,
      color: text
    });
    drawLines({
      page: state.page,
      lines: productLines,
      x: 144,
      y: topY,
      font,
      size: 9,
      color: text
    });
    drawLines({
      page: state.page,
      lines: descriptionLines,
      x: 244,
      y: topY,
      font,
      size: 9,
      color: text
    });
    state.page.drawText(String(line.quantity || 0), {
      x: 430,
      y: topY,
      size: 9.5,
      font,
      color: text
    });
    state.page.drawText(formatMoney(line.unitRate), {
      x: 462,
      y: topY,
      size: 9.5,
      font,
      color: text
    });
    state.page.drawText(formatMoney(line.amount), {
      x: 516,
      y: topY,
      size: 9.5,
      font,
      color: text
    });
    state.page.drawLine({
      start: { x: left, y: topY - rowHeight + 2 },
      end: { x: right, y: topY - rowHeight + 2 },
      thickness: 0.4,
      color: divider
    });
    state.y -= rowHeight;
  });

  const totalsY = state.y - 6;
  if (totalsY < footerReserve) {
    state = addPage(true);
  }

  const summaryStartX = 418;
  const summaryLabelX = summaryStartX;
  const summaryValueX = 516;
  let summaryY = state.y - 8;

  state.page.drawLine({
    start: { x: summaryStartX, y: summaryY + 10 },
    end: { x: right, y: summaryY + 10 },
    thickness: 1,
    color: divider
  });

  const summaryRows = [
    { label: "Subtotal", value: formatMoney(model.subtotal) },
    { label: "Payments", value: formatMoney(model.paymentsAmount, { negative: model.paymentsAmount > 0 }) },
    { label: "Balance due", value: formatMoney(model.balanceDueAmount) }
  ];

  summaryRows.forEach((row) => {
    summaryY -= 16;
    state.page.drawText(row.label, {
      x: summaryLabelX,
      y: summaryY,
      size: row.label === "Balance due" ? 10.5 : 9.5,
      font: row.label === "Balance due" ? bold : font,
      color: row.label === "Balance due" ? brand : text
    });
    state.page.drawText(row.value, {
      x: summaryValueX,
      y: summaryY,
      size: row.label === "Balance due" ? 10.5 : 9.5,
      font: row.label === "Balance due" ? bold : font,
      color: row.label === "Balance due" ? brand : text
    });
  });

  if (model.balanceDueAmount <= 0 && model.paymentsAmount > 0) {
    summaryY -= 24;
    state.page.drawText("Paid in Full", {
      x: summaryLabelX,
      y: summaryY,
      size: 11,
      font: bold,
      color: brand
    });
  }

  return Buffer.from(await pdf.save());
}
