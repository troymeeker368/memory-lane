import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@/lib/supabase/server";
import {
  formatBillingPayorAddress,
  formatBillingPayorDisplayName,
  getBillingPayorContact,
  type BillingPayorContact
} from "@/lib/services/billing-payor-contacts";
import {
  DOCUMENT_CENTER_ADDRESS,
  DOCUMENT_CENTER_LOGO_PUBLIC_PATH,
  DOCUMENT_CENTER_NAME,
  DOCUMENT_CENTER_PHONE
} from "@/lib/services/document-branding";
import type { Database } from "@/types/supabase";
import type { PDFDocument as PDFDocumentType, PDFFont, PDFImage, PDFPage } from "pdf-lib";

type BillingInvoiceRow = Database["public"]["Tables"]["billing_invoices"]["Row"];
type BillingInvoiceLineRow = Database["public"]["Tables"]["billing_invoice_lines"]["Row"];
type MemberDisplayNameRow = Pick<Database["public"]["Tables"]["members"]["Row"], "id" | "display_name">;

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

function drawInvoiceHeader(input: {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  logo: PDFImage | null;
  generatedAt: string;
  left: number;
  right: number;
  brand: ReturnType<typeof import("pdf-lib").rgb>;
  text: ReturnType<typeof import("pdf-lib").rgb>;
  divider: ReturnType<typeof import("pdf-lib").rgb>;
}) {
  const { page, font, bold, logo, generatedAt, left, right, brand, text, divider } = input;
  const pageWidth = page.getWidth();
  let y = 760;

  if (logo) {
    const logoHeight = 38;
    const scaled = logo.scale(logoHeight / logo.height);
    const logoWidth = Math.min(scaled.width, 160);
    page.drawImage(logo, {
      x: left,
      y: y - logoHeight + 4,
      width: logoWidth,
      height: logoHeight
    });
  }

  const centerX = pageWidth / 2;
  page.drawText(DOCUMENT_CENTER_NAME, {
    x: centerX - bold.widthOfTextAtSize(DOCUMENT_CENTER_NAME, 14) / 2,
    y,
    size: 14,
    font: bold,
    color: brand
  });
  y -= 14;
  page.drawText(DOCUMENT_CENTER_ADDRESS, {
    x: centerX - font.widthOfTextAtSize(DOCUMENT_CENTER_ADDRESS, 9.5) / 2,
    y,
    size: 9.5,
    font,
    color: text
  });
  y -= 12;
  page.drawText(DOCUMENT_CENTER_PHONE, {
    x: centerX - font.widthOfTextAtSize(DOCUMENT_CENTER_PHONE, 9.5) / 2,
    y,
    size: 9.5,
    font,
    color: text
  });

  const generatedLabel = `Generated: ${generatedAt}`;
  page.drawText(generatedLabel, {
    x: right - font.widthOfTextAtSize(generatedLabel, 8.5),
    y: 760,
    size: 8.5,
    font,
    color: text
  });
  page.drawLine({
    start: { x: left, y: 712 },
    end: { x: right, y: 712 },
    thickness: 1,
    color: divider
  });

  return 688;
}

function drawInvoiceFooter(input: {
  page: PDFPage;
  font: PDFFont;
  left: number;
  right: number;
  text: ReturnType<typeof import("pdf-lib").rgb>;
  divider: ReturnType<typeof import("pdf-lib").rgb>;
}) {
  const { page, font, left, right, text, divider } = input;
  const footerY = 58;
  page.drawLine({
    start: { x: left, y: footerY + 14 },
    end: { x: right, y: footerY + 14 },
    thickness: 1,
    color: divider
  });

  const footerText = `${DOCUMENT_CENTER_NAME} | ${DOCUMENT_CENTER_PHONE}`;
  page.drawText(footerText, {
    x: (page.getWidth() - font.widthOfTextAtSize(footerText, 8.5)) / 2,
    y: footerY,
    size: 8.5,
    font,
    color: text
  });
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
    .eq("id", invoice.member_id)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);

  const payor = await getBillingPayorContact(invoice.member_id, {
    logMissing: true,
    source: "getBillingInvoiceDocumentModel"
  });

  return buildBillingInvoiceDocumentModel({
    invoice: invoice as BillingInvoiceRow as Record<string, unknown>,
    memberName: String((member as MemberDisplayNameRow | null)?.display_name ?? "Unknown Member"),
    payor,
    lines: ((lines ?? []) as BillingInvoiceLineRow[]) as Array<Record<string, unknown>>,
    generatedAt: new Date().toISOString()
  });
}

export async function buildBillingInvoicePdfBytes(model: BillingInvoiceDocumentModel) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadCenterLogoImage(pdf);
  const brand = rgb(0.09, 0.24, 0.55);
  const text = rgb(0.1, 0.12, 0.16);
  const divider = rgb(0.85, 0.87, 0.9);

  const left = 48;
  const right = 564;
  let y = drawInvoiceHeader({
    page,
    font,
    bold,
    logo,
    generatedAt: model.generatedAt,
    left,
    right,
    brand,
    text,
    divider
  });

  const drawText = (value: string, x: number, size = 10, useBold = false, color = text) => {
    page.drawText(value, {
      x,
      y,
      size,
      font: useBold ? bold : font,
      color
    });
    y -= size + 4;
  };

  drawText("Invoice", left, 20, true, brand);
  drawText(`Invoice #: ${model.invoiceNumber || model.invoiceId}`, left, 11, true);
  drawText(`Status: ${model.invoiceStatus}`, left);
  drawText(`Invoice Date: ${model.invoiceDate ?? "-"}`, left);
  drawText(`Due Date: ${model.dueDate ?? "-"}`, left);

  y -= 8;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: divider });
  y -= 18;

  const sectionTop = y;
  let leftColumnY = sectionTop;
  const drawColumnText = (value: string, x: number, cursor: number, size = 10, useBold = false) => {
    page.drawText(value, {
      x,
      y: cursor,
      size,
      font: useBold ? bold : font,
      color: useBold ? brand : text
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
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: divider });
  y -= 18;
  page.drawText("Description", { x: left, y, size: 10, font: bold, color: brand });
  page.drawText("Date", { x: 320, y, size: 10, font: bold, color: brand });
  page.drawText("Qty", { x: 392, y, size: 10, font: bold, color: brand });
  page.drawText("Rate", { x: 436, y, size: 10, font: bold, color: brand });
  page.drawText("Amount", { x: 500, y, size: 10, font: bold, color: brand });
  y -= 14;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.75, color: divider });
  y -= 14;

  const items = model.lineItems.length > 0 ? model.lineItems : [{ description: "No invoice lines available", serviceDate: null, quantity: 0, unitRate: 0, amount: 0 }];
  for (const line of items) {
    page.drawText(line.description.slice(0, 52), { x: left, y, size: 10, font, color: text });
    page.drawText(line.serviceDate ?? "-", { x: 320, y, size: 10, font, color: text });
    page.drawText(String(line.quantity || 0), { x: 392, y, size: 10, font, color: text });
    page.drawText(formatMoney(line.unitRate), { x: 436, y, size: 10, font, color: text });
    page.drawText(formatMoney(line.amount), { x: 500, y, size: 10, font, color: text });
    y -= 16;
    if (y < 110) break;
  }

  y -= 8;
  page.drawLine({ start: { x: 404, y }, end: { x: right, y }, thickness: 1, color: divider });
  y -= 18;
  page.drawText("Total", { x: 436, y, size: 11, font: bold, color: brand });
  page.drawText(formatMoney(model.totalAmount), { x: 500, y, size: 11, font: bold, color: brand });

  drawInvoiceFooter({
    page,
    font,
    left,
    right,
    text,
    divider
  });

  return Buffer.from(await pdf.save());
}
