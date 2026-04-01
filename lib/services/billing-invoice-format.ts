import type { BillingPayorContact } from "@/lib/services/billing-payor-contacts";

export type BillingInvoiceBillToSnapshot = {
  bill_to_name_snapshot: string | null;
  bill_to_address_line_1_snapshot: string | null;
  bill_to_address_line_2_snapshot: string | null;
  bill_to_address_line_3_snapshot: string | null;
  bill_to_email_snapshot: string | null;
  bill_to_phone_snapshot: string | null;
  bill_to_message_snapshot: string | null;
};

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function formatServiceDate(dateOnly: string) {
  const normalized = String(dateOnly ?? "").trim().slice(0, 10);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return normalized;
  return `${match[2]}/${match[3]}/${match[1]}`;
}

export function formatInvoiceServiceDate(dateOnly: string | null | undefined) {
  if (!dateOnly) return "";
  return formatServiceDate(dateOnly);
}

export function buildAttendanceInvoiceLineDescription(dateOnly: string, memberName: string) {
  return `${formatServiceDate(dateOnly)} / Attended / ${memberName}`;
}

export function buildServiceDateInvoiceLineDescription(dateOnly: string, memberName: string, label = "Service Date") {
  return `${formatServiceDate(dateOnly)} / ${label} / ${memberName}`;
}

export function resolveInvoiceProductOrService(lineType: string | null | undefined) {
  switch (lineType) {
    case "Transportation":
      return "Transportation";
    case "Ancillary":
      return "Ancillary";
    case "Adjustment":
      return "Adjustment";
    case "Credit":
      return "Credit";
    case "PriorBalance":
      return "Prior Balance";
    case "BaseProgram":
    default:
      return "Member Fees";
  }
}

export function buildBillingInvoiceBillToSnapshot(payor: BillingPayorContact): BillingInvoiceBillToSnapshot {
  if (payor.status !== "ok") {
    return {
      bill_to_name_snapshot: "No payor contact designated",
      bill_to_address_line_1_snapshot: null,
      bill_to_address_line_2_snapshot: null,
      bill_to_address_line_3_snapshot: null,
      bill_to_email_snapshot: null,
      bill_to_phone_snapshot: null,
      bill_to_message_snapshot:
        payor.status === "invalid_multiple"
          ? "Multiple payor contacts are flagged. Resolve the conflict in Member Command Center."
          : "No payor contact designated"
    };
  }

  const cityStatePostal = [clean(payor.city), clean(payor.state), clean(payor.postal_code)].filter(Boolean).join(", ");
  return {
    bill_to_name_snapshot: clean(payor.full_name) ?? "No payor contact designated",
    bill_to_address_line_1_snapshot: clean(payor.address_line_1),
    bill_to_address_line_2_snapshot: clean(payor.address_line_2),
    bill_to_address_line_3_snapshot: clean(cityStatePostal),
    bill_to_email_snapshot: clean(payor.email),
    bill_to_phone_snapshot: clean(payor.phone),
    bill_to_message_snapshot: null
  };
}
