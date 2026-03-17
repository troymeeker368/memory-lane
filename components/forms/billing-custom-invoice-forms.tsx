"use client";

import { useMemo, useState } from "react";

import {
  createCustomInvoiceAction,
  createEnrollmentInvoiceAction
} from "@/app/(portal)/operations/payor/actions";

interface BillingCustomInvoiceFormsProps {
  members: Array<{ id: string; displayName: string }>;
  payorByMember: Record<string, { contactId: string | null; displayName: string; status: "ok" | "missing" | "invalid_multiple" }>;
  today: string;
  endOfMonth: string;
}

function getPayorDisplay(
  memberId: string,
  payorByMember: BillingCustomInvoiceFormsProps["payorByMember"]
) {
  if (!memberId) return "Select member first";
  return payorByMember[memberId]?.displayName ?? "No payor contact designated";
}

function getPayorStatusNote(
  memberId: string,
  payorByMember: BillingCustomInvoiceFormsProps["payorByMember"]
) {
  if (!memberId) return "Billing recipient comes from the member's designated MCC contact.";
  const status = payorByMember[memberId]?.status ?? "missing";
  if (status === "ok") return "Billing recipient comes from the member's designated MCC contact.";
  if (status === "invalid_multiple") return "Multiple payor contacts are flagged. Resolve the conflict in Member Command Center.";
  return "No payor contact designated. Update Member Command Center contacts before sending the invoice.";
}

export function BillingCustomInvoiceForms({
  members,
  payorByMember,
  today,
  endOfMonth
}: BillingCustomInvoiceFormsProps) {
  const [customMemberId, setCustomMemberId] = useState("");
  const [enrollmentMemberId, setEnrollmentMemberId] = useState("");

  const customPayorDisplay = useMemo(
    () => getPayorDisplay(customMemberId, payorByMember),
    [customMemberId, payorByMember]
  );
  const enrollmentPayorDisplay = useMemo(
    () => getPayorDisplay(enrollmentMemberId, payorByMember),
    [enrollmentMemberId, payorByMember]
  );

  return (
    <>
      <form action={createCustomInvoiceAction} className="mt-3 grid gap-2 md:grid-cols-6">
        <input type="hidden" name="returnPath" value="/operations/payor/custom-invoices" />
        <input type="hidden" name="invoiceSource" value="Custom" />
        <select
          name="memberId"
          value={customMemberId}
          onChange={(event) => setCustomMemberId(event.target.value)}
          className="h-10 rounded-lg border border-border px-3"
          required
        >
          <option value="">Member</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
            </option>
          ))}
        </select>
        <input value={customPayorDisplay} readOnly className="h-10 rounded-lg border border-border bg-surface px-3 text-muted" />
        <input value="Custom Invoice" readOnly className="h-10 rounded-lg border border-border bg-surface px-3 text-muted" />
        <input value="Billing Mode: Custom" readOnly className="h-10 rounded-lg border border-border bg-surface px-3 text-muted" />
        <input value="Rate Source: Member override, else center default" readOnly className="h-10 rounded-lg border border-border bg-surface px-3 text-muted md:col-span-2" />
        <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted md:col-span-6">
          {getPayorStatusNote(customMemberId, payorByMember)}
        </div>
        <select name="calculationMethod" defaultValue="DailyRateTimesDates" className="h-10 rounded-lg border border-border px-3">
          <option value="DailyRateTimesDates">Daily Rate x Billable Dates</option>
          <option value="FlatAmount">Flat Custom Amount</option>
          <option value="ManualLineItems">Manual Line Items</option>
        </select>
        <input name="flatAmount" type="number" step="0.01" min="0" placeholder="Flat Amount (if used)" className="h-10 rounded-lg border border-border px-3" />
        <input name="invoiceDate" type="date" defaultValue={today} className="h-10 rounded-lg border border-border px-3" />
        <input name="dueDate" type="date" defaultValue={today} className="h-10 rounded-lg border border-border px-3" />
        <input name="periodStart" type="date" defaultValue={today} className="h-10 rounded-lg border border-border px-3" required />
        <input name="periodEnd" type="date" defaultValue={endOfMonth} className="h-10 rounded-lg border border-border px-3" required />
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted">
          <input name="useScheduleTemplate" type="checkbox" value="true" defaultChecked />
          Use schedule template for dates
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted">
          <input name="includeTransportation" type="checkbox" value="true" />
          Include transportation
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted">
          <input name="includeAncillary" type="checkbox" value="true" />
          Include ancillary
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted">
          <input name="includeAdjustments" type="checkbox" value="true" />
          Include adjustments
        </label>
        <input name="manualIncludeDates" placeholder="Manual include dates (comma-separated YYYY-MM-DD)" className="h-10 rounded-lg border border-border px-3 md:col-span-3" />
        <input name="manualExcludeDates" placeholder="Manual exclude dates (comma-separated YYYY-MM-DD)" className="h-10 rounded-lg border border-border px-3 md:col-span-3" />
        <input
          value="Calculated billable dates are generated on save from schedule + manual include/exclude, excluding center closures."
          readOnly
          className="h-10 rounded-lg border border-border bg-surface px-3 text-xs text-muted md:col-span-6"
        />
        <textarea
          name="manualLineItems"
          placeholder="Manual line items (one per line): Description|Qty|UnitRate|Amount|LineType"
          className="min-h-[88px] rounded-lg border border-border px-3 py-2 text-xs md:col-span-4"
        />
        <input name="notes" placeholder="Invoice notes" className="h-10 rounded-lg border border-border px-3 md:col-span-2" />
        <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted md:col-span-4">
          Preview Total: Calculated when draft invoice is saved.
        </div>
        <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white md:col-span-2">
          Save Custom Draft Invoice
        </button>
      </form>

      <form action={createEnrollmentInvoiceAction} className="mt-3 grid gap-2 md:grid-cols-6">
        <div className="md:col-span-6">
          <p className="text-sm font-semibold text-primary-text">Create Enrollment Prorated Invoice</p>
        </div>
        <input type="hidden" name="returnPath" value="/operations/payor/custom-invoices" />
        <select
          name="memberId"
          value={enrollmentMemberId}
          onChange={(event) => setEnrollmentMemberId(event.target.value)}
          className="h-10 rounded-lg border border-border px-3"
          required
        >
          <option value="">Member</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
            </option>
          ))}
        </select>
        <input value={enrollmentPayorDisplay} readOnly className="h-10 rounded-lg border border-border bg-surface px-3 text-muted" />
        <input name="effectiveStartDate" type="date" defaultValue={today} className="h-10 rounded-lg border border-border px-3" required />
        <input name="periodEndDate" type="date" defaultValue={endOfMonth} className="h-10 rounded-lg border border-border px-3" />
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted">
          <input name="includeTransportation" type="checkbox" value="true" />
          Include transportation
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted">
          <input name="includeAncillary" type="checkbox" value="true" />
          Include ancillary
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted">
          <input name="includeAdjustments" type="checkbox" value="true" />
          Include adjustments
        </label>
        <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted md:col-span-6">
          {getPayorStatusNote(enrollmentMemberId, payorByMember)}
        </div>
        <input name="notes" placeholder="Proration notes" className="h-10 rounded-lg border border-border px-3 md:col-span-4" />
        <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white md:col-span-2">
          Create Enrollment Invoice
        </button>
      </form>
    </>
  );
}
