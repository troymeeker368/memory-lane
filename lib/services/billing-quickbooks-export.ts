import type { Database } from "@/types/supabase-types";
import { toAmount } from "@/lib/services/billing-utils";

type BillingInvoiceRow = Database["public"]["Tables"]["billing_invoices"]["Row"];
type BillingInvoiceLineTableRow = Database["public"]["Tables"]["billing_invoice_lines"]["Row"];

export const QUICKBOOKS_INVOICE_IMPORT_HEADER = [
  "*InvoiceNo",
  "*Customer",
  "*InvoiceDate",
  "*DueDate",
  "Terms",
  "Location",
  "Memo",
  "Item(Product/Service)",
  "ItemDescription",
  "ItemQuantity",
  "ItemRate",
  "*ItemAmount",
  "Service Date"
] as const;

type QuickBooksDetailLevel = "Summary" | "Detailed";

type QuickBooksInvoiceRow = Pick<
  BillingInvoiceRow,
  | "id"
  | "member_id"
  | "payor_id"
  | "invoice_number"
  | "invoice_month"
  | "invoice_date"
  | "due_date"
  | "base_period_start"
  | "base_period_end"
  | "bill_to_name_snapshot"
  | "created_at"
>;

type BillingInvoiceLineRow = Pick<
  BillingInvoiceLineTableRow,
  | "invoice_id"
  | "line_number"
  | "product_or_service"
  | "line_type"
  | "description"
  | "service_date"
  | "quantity"
  | "unit_rate"
  | "amount"
>;

type QuickBooksLineMath = {
  quantity: number;
  rate: number;
  amount: number;
};

type QuickBooksMappedLine = {
  itemName: string;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  serviceDate: string;
  order: number;
};

type QuickBooksGroupingBucket = {
  itemName: string;
  lineType: string;
  rate: number;
  amount: number;
  quantity: number;
  descriptions: string[];
  serviceDates: string[];
  firstOrder: number;
};

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : "";
}

function escapeCsv(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function buildCsvRows(header: readonly string[], body: string[][]) {
  return [Array.from(header), ...body]
    .map((row) => row.map((value) => escapeCsv(String(value ?? ""))).join(","))
    .join("\n");
}

function isIsoDate(value: string | null | undefined) {
  return /^\d{4}-\d{2}-\d{2}$/.test(clean(value));
}

function formatQuickBooksDate(value: string | null | undefined) {
  const normalized = clean(value);
  if (!isIsoDate(normalized)) return normalized;
  const [year, month, day] = normalized.split("-");
  return `${day}/${month}/${year}`;
}

function formatMemoDate(value: string) {
  const normalized = clean(value);
  if (!isIsoDate(normalized)) return normalized;
  const [, month, day] = normalized.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function formatMonthYear(value: string | null | undefined) {
  const normalized = clean(value);
  if (!isIsoDate(normalized)) return normalized;
  const [year, month] = normalized.split("-");
  const monthIndex = Number(month) - 1;
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  return `${monthNames[monthIndex] ?? month} ${year}`;
}

function parseDateToUtc(value: string | null | undefined) {
  const normalized = clean(value);
  if (!isIsoDate(normalized)) return null;
  const [year, month, day] = normalized.split("-").map((part) => Number(part));
  return Date.UTC(year, month - 1, day);
}

function diffDays(left: string | null | undefined, right: string | null | undefined) {
  const leftUtc = parseDateToUtc(left);
  const rightUtc = parseDateToUtc(right);
  if (leftUtc == null || rightUtc == null) return null;
  return Math.round((rightUtc - leftUtc) / 86_400_000);
}

function formatDecimal(value: number) {
  const normalized = toAmount(value);
  if (!Number.isFinite(normalized)) return "0";
  return normalized.toFixed(2).replace(/\.00$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function compareIsoDates(left: string, right: string) {
  return left.localeCompare(right);
}

function resolveQuickBooksTerms(invoiceDate: string | null | undefined, dueDate: string | null | undefined) {
  const days = diffDays(invoiceDate, dueDate);
  if (days == null) return "";
  if (days <= 0) return "Due on receipt";
  return `Net ${days}`;
}

function buildMemo(attendedDates: string[]) {
  if (attendedDates.length === 0) return "Days attended: none";
  return `Days attended: ${attendedDates.map(formatMemoDate).join(", ")}`;
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeAncillaryItemName(description: string, fallbackProductOrService: string) {
  const candidate = clean(description) || clean(fallbackProductOrService);
  const normalized = candidate.toLowerCase();
  if (!candidate) return "Other";
  if (normalized.includes("brief")) return "Briefs";
  if (normalized.includes("transport")) return "Transport";
  if (normalized.includes("shower")) return "Shower Assist";
  if (normalized.includes("supply") || normalized.includes("insulin")) return "Supplies";
  if (normalized.includes("additional care") || normalized.includes("extra care")) return "Additional Care";
  if (normalized.includes("late pickup")) return "Late Pickup";
  if (normalized.includes("laundry")) return "Laundry";
  return /[a-z]/.test(candidate) ? titleCase(candidate) : candidate;
}

function resolveItemName(line: BillingInvoiceLineRow) {
  const description = clean(line.description);
  const productOrService = clean(line.product_or_service);
  switch (String(line.line_type ?? "")) {
    case "BaseProgram":
      return "Daily Rate";
    case "Transportation":
      return "Transport";
    case "Ancillary":
      return normalizeAncillaryItemName(description, productOrService);
    case "Adjustment":
      return "Adjustment";
    case "Credit":
      return "Credit";
    case "PriorBalance":
      return "Prior Balance";
    default:
      return productOrService || "Other";
  }
}

function normalizeMath(quantity: number | null | undefined, unitRate: number | null | undefined, amount: number | null | undefined): QuickBooksLineMath {
  let normalizedQuantity = Number(quantity ?? 0);
  let normalizedRate = toAmount(Number(unitRate ?? 0));
  const normalizedAmount = toAmount(Number(amount ?? 0));

  if (!Number.isFinite(normalizedQuantity) || normalizedQuantity === 0) {
    normalizedQuantity = normalizedAmount === 0 ? 0 : 1;
  }
  if (!Number.isFinite(normalizedRate)) {
    normalizedRate = 0;
  }
  if (normalizedQuantity !== 0 && toAmount(normalizedQuantity * normalizedRate) !== normalizedAmount) {
    normalizedRate = toAmount(normalizedAmount / normalizedQuantity);
  }

  return {
    quantity: normalizedQuantity,
    rate: normalizedRate,
    amount: normalizedAmount
  };
}

function buildDetailedDescription(invoice: QuickBooksInvoiceRow, line: BillingInvoiceLineRow, itemName: string) {
  const existing = clean(line.description);
  const lineType = String(line.line_type ?? "");
  if (lineType === "BaseProgram") {
    if (clean(line.service_date)) {
      return `Attendance on ${formatMemoDate(String(line.service_date))}`;
    }
    return `Attendance charges for ${formatMonthYear(invoice.invoice_month)}`;
  }
  if (lineType === "Transportation" && existing) return existing;
  if (lineType === "Ancillary" && existing) return existing;
  if ((lineType === "Adjustment" || lineType === "Credit" || lineType === "PriorBalance") && existing) return existing;
  return itemName === "Other" ? "" : itemName;
}

function buildSummaryDescription(invoice: QuickBooksInvoiceRow, bucket: QuickBooksGroupingBucket) {
  const uniqueDescriptions = Array.from(new Set(bucket.descriptions.map(clean).filter(Boolean)));
  if (bucket.lineType === "BaseProgram") {
    return `Attendance charges for ${formatMonthYear(invoice.invoice_month)}`;
  }
  if (uniqueDescriptions.length === 1) {
    return uniqueDescriptions[0];
  }
  if (uniqueDescriptions.length === 0) {
    return bucket.itemName === "Other" ? "" : bucket.itemName;
  }
  return bucket.itemName === "Other" ? "" : `${bucket.itemName} charges for ${formatMonthYear(invoice.invoice_month)}`;
}

function resolveSummaryServiceDate(invoice: QuickBooksInvoiceRow, bucket: QuickBooksGroupingBucket) {
  const uniqueDates = Array.from(new Set(bucket.serviceDates.filter(Boolean))).sort(compareIsoDates);
  if (uniqueDates.length === 1) return formatQuickBooksDate(uniqueDates[0]);
  if (bucket.lineType === "BaseProgram") return formatQuickBooksDate(invoice.base_period_end ?? invoice.invoice_date);
  return "";
}

function buildDetailedLines(invoice: QuickBooksInvoiceRow, lines: BillingInvoiceLineRow[]) {
  return lines.map((line, index) => {
    const itemName = resolveItemName(line);
    const math = normalizeMath(line.quantity, line.unit_rate, line.amount);
    const hasServiceDate = clean(line.service_date).length > 0;
    const serviceDate =
      hasServiceDate || String(line.line_type ?? "") === "BaseProgram"
        ? formatQuickBooksDate(line.service_date ?? invoice.base_period_end ?? invoice.invoice_date)
        : "";

    return {
      itemName,
      description: buildDetailedDescription(invoice, line, itemName),
      quantity: math.quantity,
      rate: math.rate,
      amount: math.amount,
      serviceDate,
      order: Number(line.line_number ?? index + 1)
    } satisfies QuickBooksMappedLine;
  });
}

function buildSummaryLines(invoice: QuickBooksInvoiceRow, lines: BillingInvoiceLineRow[]) {
  const buckets = new Map<string, QuickBooksGroupingBucket>();
  const sortedLines = [...lines].sort((left, right) => {
    const leftLineNumber = Number(left.line_number ?? 0);
    const rightLineNumber = Number(right.line_number ?? 0);
    if (leftLineNumber !== rightLineNumber) return leftLineNumber - rightLineNumber;
    const leftDate = clean(left.service_date);
    const rightDate = clean(right.service_date);
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return clean(left.description).localeCompare(clean(right.description));
  });

  sortedLines.forEach((line, index) => {
    const itemName = resolveItemName(line);
    const math = normalizeMath(line.quantity, line.unit_rate, line.amount);
    const lineType = String(line.line_type ?? "");
    const groupingKey = `${lineType}|${itemName}|${formatDecimal(math.rate)}`;
    const bucket = buckets.get(groupingKey);
    if (bucket) {
      bucket.quantity = toAmount(bucket.quantity + math.quantity);
      bucket.amount = toAmount(bucket.amount + math.amount);
      bucket.descriptions.push(clean(line.description));
      if (clean(line.service_date)) bucket.serviceDates.push(String(line.service_date));
      return;
    }
    buckets.set(groupingKey, {
      itemName,
      lineType,
      rate: math.rate,
      amount: math.amount,
      quantity: math.quantity,
      descriptions: [clean(line.description)],
      serviceDates: clean(line.service_date) ? [String(line.service_date)] : [],
      firstOrder: Number(line.line_number ?? index + 1)
    });
  });

  return Array.from(buckets.values())
    .sort((left, right) => left.firstOrder - right.firstOrder)
    .map((bucket) => ({
      itemName: bucket.itemName,
      description: buildSummaryDescription(invoice, bucket),
      quantity: bucket.quantity,
      rate: bucket.rate,
      amount: bucket.amount,
      serviceDate: resolveSummaryServiceDate(invoice, bucket),
      order: bucket.firstOrder
    }));
}

function buildInvoiceDataRows(input: {
  invoice: QuickBooksInvoiceRow;
  customerName: string;
  location: string;
  memo: string;
  lines: QuickBooksMappedLine[];
}) {
  return input.lines.map((line, index) => [
    input.invoice.invoice_number,
    index === 0 ? input.customerName : "",
    index === 0 ? formatQuickBooksDate(input.invoice.invoice_date ?? input.invoice.created_at.slice(0, 10)) : "",
    index === 0 ? formatQuickBooksDate(input.invoice.due_date) : "",
    index === 0 ? resolveQuickBooksTerms(input.invoice.invoice_date, input.invoice.due_date) : "",
    index === 0 ? input.location : "",
    index === 0 ? input.memo : "",
    line.itemName,
    line.description,
    formatDecimal(line.quantity),
    formatDecimal(line.rate),
    formatDecimal(line.amount),
    line.serviceDate
  ]);
}

export function buildQuickBooksInvoiceCsv(input: {
  invoices: QuickBooksInvoiceRow[];
  lines: BillingInvoiceLineRow[];
  detailLevel: QuickBooksDetailLevel;
  customerNameByInvoiceId: Map<string, string>;
  attendedDatesByInvoiceId: Map<string, string[]>;
  locationByMemberId?: Map<string, string>;
}) {
  const linesByInvoiceId = new Map<string, BillingInvoiceLineRow[]>();
  input.lines.forEach((line) => {
    const invoiceId = String(line.invoice_id ?? "");
    if (!invoiceId) return;
    const existing = linesByInvoiceId.get(invoiceId);
    if (existing) {
      existing.push(line);
      return;
    }
    linesByInvoiceId.set(invoiceId, [line]);
  });

  const body = [...input.invoices]
    .sort((left, right) => String(left.invoice_number ?? "").localeCompare(String(right.invoice_number ?? "")))
    .flatMap((invoice) => {
      const invoiceId = String(invoice.id ?? "");
      const customerName = clean(input.customerNameByInvoiceId.get(invoiceId)) || clean(invoice.bill_to_name_snapshot);
      if (!customerName || customerName === "No payor contact designated") {
        throw new Error(`Invoice ${String(invoice.invoice_number ?? invoice.id ?? "")} is missing a valid QuickBooks customer name.`);
      }
      const location = clean(input.locationByMemberId?.get(String(invoice.member_id ?? "")));
      const memo = buildMemo((input.attendedDatesByInvoiceId.get(invoiceId) ?? []).sort(compareIsoDates));
      const invoiceLines = (linesByInvoiceId.get(invoiceId) ?? []).filter((line) => toAmount(Number(line.amount ?? 0)) !== 0);
      const mappedLines =
        input.detailLevel === "Detailed"
          ? buildDetailedLines(invoice, invoiceLines)
          : buildSummaryLines(invoice, invoiceLines);

      if (mappedLines.length === 0) {
        throw new Error(`Invoice ${String(invoice.invoice_number ?? invoice.id ?? "")} has no finalized invoice lines to export.`);
      }

      return buildInvoiceDataRows({
        invoice,
        customerName,
        location,
        memo,
        lines: mappedLines
      });
    });

  return buildCsvRows([...QUICKBOOKS_INVOICE_IMPORT_HEADER], body);
}
