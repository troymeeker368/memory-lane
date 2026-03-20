"use client";

import { useMemo, useState } from "react";

import { submitPayorAction } from "@/app/(portal)/operations/payor/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type BillingMethod = "DailyRateTimesDates" | "FlatAmount" | "ManualLineItems";
type ManualLineType = "BaseProgram" | "Transportation" | "Ancillary" | "Adjustment" | "Credit" | "PriorBalance";

const SELECT_CLASS_NAME =
  "h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand/40";
const TEXTAREA_CLASS_NAME =
  "min-h-[96px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/40";

const MANUAL_LINE_TYPE_OPTIONS: Array<{ label: string; value: ManualLineType }> = [
  { label: "Program", value: "BaseProgram" },
  { label: "Transportation", value: "Transportation" },
  { label: "Ancillary", value: "Ancillary" },
  { label: "Adjustment", value: "Adjustment" },
  { label: "Credit", value: "Credit" },
  { label: "Prior Balance", value: "PriorBalance" }
];

type ManualItemDraft = {
  description: string;
  quantity: string;
  unitRate: string;
  amount: string;
  lineType: ManualLineType;
};

const EMPTY_MANUAL_ITEM: ManualItemDraft = {
  description: "",
  quantity: "1",
  unitRate: "",
  amount: "",
  lineType: "BaseProgram"
};

interface BillingCustomInvoiceFormsProps {
  members: Array<{ id: string; displayName: string }>;
  payorByMember: Record<
    string,
    { contactId: string | null; displayName: string; status: "ok" | "missing" | "invalid_multiple" }
  >;
  today: string;
  endOfMonth: string;
}

function getPayorDisplay(
  memberId: string,
  payorByMember: BillingCustomInvoiceFormsProps["payorByMember"]
) {
  if (!memberId) return "Select a member first";
  return payorByMember[memberId]?.displayName ?? "No billing recipient designated";
}

function getPayorStatusNote(
  memberId: string,
  payorByMember: BillingCustomInvoiceFormsProps["payorByMember"]
) {
  if (!memberId) return "Billing recipient is pulled from the member's designated MCC payor contact.";
  const status = payorByMember[memberId]?.status ?? "missing";
  if (status === "ok") return "Billing recipient is pulled from the member's designated MCC payor contact.";
  if (status === "invalid_multiple") {
    return "Multiple payor contacts are flagged. Resolve the billing recipient in Member Command Center before finalizing.";
  }
  return "No billing recipient is designated. Update Member Command Center contacts before sending the invoice.";
}

function isManualItemEmpty(item: ManualItemDraft) {
  return (
    item.description.trim().length === 0 &&
    item.quantity.trim().length === 0 &&
    item.unitRate.trim().length === 0 &&
    item.amount.trim().length === 0
  );
}

function serializeManualItems(items: ManualItemDraft[]) {
  return items
    .filter((item) => !isManualItemEmpty(item))
    .map((item) =>
      [
        item.description.trim(),
        item.quantity.trim(),
        item.unitRate.trim(),
        item.amount.trim(),
        item.lineType
      ].join("|")
    )
    .join("\n");
}

function Section({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-slate-50/40 p-4">
      <div className="mb-4 space-y-1">
        <h4 className="text-sm font-semibold text-fg">{title}</h4>
        {description ? <p className="text-xs text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  helper,
  children,
  className
}: {
  label: string;
  helper?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={className ?? "space-y-1.5"}>
      <span className="block text-xs font-semibold text-muted">{label}</span>
      {children}
      {helper ? <span className="block text-xs text-muted">{helper}</span> : null}
    </label>
  );
}

function ReadOnlyField({
  label,
  value,
  helper,
  className
}: {
  label: string;
  value: string;
  helper?: string;
  className?: string;
}) {
  return (
    <div className={className ?? "space-y-1.5"}>
      <span className="block text-xs font-semibold text-muted">{label}</span>
      <div className="flex min-h-11 items-center rounded-lg border border-border bg-white px-3 py-2 text-sm text-fg">
        {value}
      </div>
      {helper ? <span className="block text-xs text-muted">{helper}</span> : null}
    </div>
  );
}

function CheckboxCard({
  name,
  label,
  description,
  defaultChecked = false
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex h-full items-start gap-3 rounded-lg border border-border bg-white px-3 py-3 text-sm">
      <input name={name} type="checkbox" value="true" defaultChecked={defaultChecked} className="mt-1 h-4 w-4" />
      <span className="space-y-1">
        <span className="block font-semibold text-fg">{label}</span>
        <span className="block text-xs text-muted">{description}</span>
      </span>
    </label>
  );
}

function ManualItemEditorRow({
  item,
  index,
  disabled,
  onChange,
  onRemove
}: {
  item: ManualItemDraft;
  index: number;
  disabled: boolean;
  onChange: (index: number, patch: Partial<ManualItemDraft>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-fg">Manual Item {index + 1}</p>
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
        >
          Remove
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Field label="Description" className="space-y-1.5 xl:col-span-2">
          <Input
            value={item.description}
            onChange={(event) => onChange(index, { description: event.target.value })}
            placeholder="Program charge or note"
            disabled={disabled}
          />
        </Field>
        <Field label="Quantity">
          <Input
            value={item.quantity}
            onChange={(event) => onChange(index, { quantity: event.target.value })}
            type="number"
            min="0"
            step="1"
            placeholder="1"
            disabled={disabled}
          />
        </Field>
        <Field label="Unit Rate">
          <Input
            value={item.unitRate}
            onChange={(event) => onChange(index, { unitRate: event.target.value })}
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            disabled={disabled}
          />
        </Field>
        <Field label="Amount">
          <Input
            value={item.amount}
            onChange={(event) => onChange(index, { amount: event.target.value })}
            type="number"
            step="0.01"
            placeholder="Optional"
            disabled={disabled}
          />
        </Field>
        <Field label="Line Type">
          <select
            value={item.lineType}
            onChange={(event) => onChange(index, { lineType: event.target.value as ManualLineType })}
            className={SELECT_CLASS_NAME}
            disabled={disabled}
          >
            {MANUAL_LINE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}

export function BillingCustomInvoiceForm({
  members,
  payorByMember,
  today,
  endOfMonth
}: BillingCustomInvoiceFormsProps) {
  const [memberId, setMemberId] = useState("");
  const [calculationMethod, setCalculationMethod] = useState<BillingMethod>("DailyRateTimesDates");
  const [flatAmount, setFlatAmount] = useState("");
  const [manualItems, setManualItems] = useState<ManualItemDraft[]>([]);

  const payorDisplay = useMemo(() => getPayorDisplay(memberId, payorByMember), [memberId, payorByMember]);
  const payorNote = useMemo(() => getPayorStatusNote(memberId, payorByMember), [memberId, payorByMember]);
  const manualLineItems = useMemo(() => serializeManualItems(manualItems), [manualItems]);

  const manualMode = calculationMethod === "ManualLineItems";
  const flatAmountMode = calculationMethod === "FlatAmount";

  function updateManualItem(index: number, patch: Partial<ManualItemDraft>) {
    setManualItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function removeManualItem(index: number) {
    setManualItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <form action={submitPayorAction} className="mt-5 space-y-5">
      <input type="hidden" name="intent" value="createCustomInvoice" />
      <input type="hidden" name="returnPath" value="/operations/payor/custom-invoices?tab=custom-invoice" />
      <input type="hidden" name="flatAmount" value={flatAmount} />
      <input type="hidden" name="manualLineItems" value={manualLineItems} />

      <Section title="Member & Billing" description="Choose who the invoice is for and review the billing context that will be applied.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Member" className="space-y-1.5 xl:col-span-2">
            <select
              name="memberId"
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
              className={SELECT_CLASS_NAME}
              required
            >
              <option value="">Select a member</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </Field>
          <ReadOnlyField label="Payor / Billing Recipient" value={payorDisplay} className="space-y-1.5 xl:col-span-3" />
          <ReadOnlyField label="Invoice Type" value="Custom Invoice" />
          <ReadOnlyField label="Billing Mode" value="Custom" />
          <ReadOnlyField
            label="Rate Source"
            value="Member billing override, otherwise center default"
            className="space-y-1.5 xl:col-span-3"
          />
        </div>
        <div className="mt-4 rounded-lg border border-border bg-white px-3 py-3 text-xs text-muted">{payorNote}</div>
      </Section>

      <Section
        title="Billing Setup"
        description="Set how the draft should calculate the base charge, then choose the billing period and document dates."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Billing Method / Rate Type">
            <select
              name="calculationMethod"
              value={calculationMethod}
              onChange={(event) => setCalculationMethod(event.target.value as BillingMethod)}
              className={SELECT_CLASS_NAME}
            >
              <option value="DailyRateTimesDates">Daily Rate x Billable Dates</option>
              <option value="FlatAmount">Flat Amount</option>
              <option value="ManualLineItems">Manual Line Items</option>
            </select>
          </Field>
          {flatAmountMode ? (
            <Field
              label="Rate"
              helper="Used only for Flat Amount invoices."
            >
              <Input
                value={flatAmount}
                onChange={(event) => setFlatAmount(event.target.value)}
                type="number"
                min="0"
                step="0.01"
                placeholder="Enter flat amount"
              />
            </Field>
          ) : (
            <ReadOnlyField
              label="Rate"
              value={
                manualMode
                  ? "Manual items below determine the billed amount."
                  : "Daily rate is resolved from the selected member's billing setup."
              }
            />
          )}
          <Field label="Start Date">
            <Input name="periodStart" type="date" defaultValue={today} required />
          </Field>
          <Field label="End Date">
            <Input name="periodEnd" type="date" defaultValue={endOfMonth} required />
          </Field>
        </div>
        <div className="mt-4 rounded-lg border border-dashed border-border bg-white px-3 py-3 text-xs text-muted">
          Billing period dates determine which services are billed. Invoice Date and Due Date control the dates printed on the invoice.
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Invoice Date">
            <Input name="invoiceDate" type="date" defaultValue={today} />
          </Field>
          <Field label="Due Date">
            <Input name="dueDate" type="date" defaultValue={today} />
          </Field>
        </div>
      </Section>

      <Section title="Included Items" description="Choose any additional charges or schedule-driven dates that should be included in the draft.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <CheckboxCard
            name="useScheduleTemplate"
            label="Use Schedule Template for Dates"
            description="Build billable dates from the member's schedule template."
            defaultChecked
          />
          <CheckboxCard
            name="includeTransportation"
            label="Include Transportation"
            description="Pull eligible transportation charges into this draft."
          />
          <CheckboxCard
            name="includeAncillary"
            label="Include Ancillary"
            description="Pull eligible ancillary charges into this draft."
          />
          <CheckboxCard
            name="includeAdjustments"
            label="Include Adjustments"
            description="Pull unbilled billing adjustments into this draft."
          />
        </div>
      </Section>

      <details className="rounded-xl border border-border bg-white">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-fg">
          Advanced Date Overrides
          <span className="ml-2 text-xs font-normal text-muted">Optional manual include/exclude dates</span>
        </summary>
        <div className="border-t border-border px-4 py-4">
          <p className="mb-4 text-xs text-muted">
            Use this only when the billing period needs specific date overrides in addition to the schedule and center closure rules.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Manual Include Dates" helper="Enter comma-separated dates such as 2026-03-05, 2026-03-12.">
              <Input name="manualIncludeDates" placeholder="YYYY-MM-DD, YYYY-MM-DD" />
            </Field>
            <Field label="Manual Exclude Dates" helper="Enter comma-separated dates such as 2026-03-10, 2026-03-17.">
              <Input name="manualExcludeDates" placeholder="YYYY-MM-DD, YYYY-MM-DD" />
            </Field>
          </div>
        </div>
      </details>

      <Section
        title="Manual Items"
        description="Use structured manual line items instead of a freeform text block when the invoice should be built from explicit rows."
      >
        <p className="mb-4 text-xs text-muted">
          Leave Amount blank to calculate Quantity x Unit Rate automatically. Manual items are only used when Billing Method / Rate Type is set to Manual Line Items.
        </p>
        {manualItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-white px-4 py-6 text-sm text-muted">
            No manual items added yet.
          </div>
        ) : (
          <div className="space-y-3">
            {manualItems.map((item, index) => (
              <ManualItemEditorRow
                key={`manual-item-${index}`}
                item={item}
                index={index}
                disabled={!manualMode}
                onChange={updateManualItem}
                onRemove={removeManualItem}
              />
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setManualItems((current) => [...current, { ...EMPTY_MANUAL_ITEM }])}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-brand hover:bg-slate-50"
          >
            Add Manual Item
          </button>
          {!manualMode ? (
            <span className="self-center text-xs text-muted">Switch the billing method to Manual Line Items before saving if you want these rows billed.</span>
          ) : null}
        </div>
      </Section>

      <Section title="Notes" description="Optional notes saved with the invoice draft.">
        <Field label="Invoice Notes">
          <textarea name="notes" placeholder="Add any invoice notes or coordinator context." className={TEXTAREA_CLASS_NAME} />
        </Field>
      </Section>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-slate-50/40 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-fg">Preview Total</p>
          <p className="text-xs text-muted">The total is calculated when the draft invoice is saved.</p>
        </div>
        <Button type="submit" className="md:min-w-[220px]">
          Save Custom Draft Invoice
        </Button>
      </div>
    </form>
  );
}

export function BillingEnrollmentProratedForm({
  members,
  payorByMember,
  today,
  endOfMonth
}: BillingCustomInvoiceFormsProps) {
  const [memberId, setMemberId] = useState("");

  const payorDisplay = useMemo(() => getPayorDisplay(memberId, payorByMember), [memberId, payorByMember]);
  const payorNote = useMemo(() => getPayorStatusNote(memberId, payorByMember), [memberId, payorByMember]);

  return (
    <form action={submitPayorAction} className="mt-5 space-y-5">
      <input type="hidden" name="intent" value="createEnrollmentInvoice" />
      <input type="hidden" name="returnPath" value="/operations/payor/custom-invoices?tab=prorated-enrollment" />

      <Section
        title="Enrollment Proration"
        description="Create a compact enrollment-period draft using the member's existing daily billing setup."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Member" className="space-y-1.5 xl:col-span-2">
            <select
              name="memberId"
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
              className={SELECT_CLASS_NAME}
              required
            >
              <option value="">Select a member</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </Field>
          <ReadOnlyField label="Payor / Billing Recipient" value={payorDisplay} className="space-y-1.5 xl:col-span-2" />
          <Field label="Start Date">
            <Input name="effectiveStartDate" type="date" defaultValue={today} required />
          </Field>
          <Field label="End Date">
            <Input name="periodEndDate" type="date" defaultValue={endOfMonth} />
          </Field>
        </div>
        <div className="mt-4 rounded-lg border border-border bg-white px-3 py-3 text-xs text-muted">{payorNote}</div>
      </Section>

      <Section title="Included Items" description="Choose which additional charges should be considered during the enrollment proration run.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <CheckboxCard
            name="includeTransportation"
            label="Include Transportation"
            description="Pull eligible transportation charges into the enrollment invoice."
          />
          <CheckboxCard
            name="includeAncillary"
            label="Include Ancillary"
            description="Pull eligible ancillary charges into the enrollment invoice."
          />
          <CheckboxCard
            name="includeAdjustments"
            label="Include Adjustments"
            description="Pull unbilled adjustments into the enrollment invoice."
          />
        </div>
      </Section>

      <Section title="Notes" description="Optional note saved with the enrollment invoice draft.">
        <Field label="Notes">
          <textarea name="notes" placeholder="Add any enrollment proration notes." className={TEXTAREA_CLASS_NAME} />
        </Field>
      </Section>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-slate-50/40 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-fg">Create Enrollment Invoice</p>
          <p className="text-xs text-muted">This keeps the enrollment workflow separate from one-off custom invoice drafting.</p>
        </div>
        <Button type="submit" className="md:min-w-[220px]">
          Create Enrollment Invoice
        </Button>
      </div>
    </form>
  );
}
