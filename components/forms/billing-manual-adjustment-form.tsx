"use client";

import { useMemo, useState } from "react";

import { submitPayorAction } from "@/app/(portal)/operations/payor/actions";

interface BillingManualAdjustmentFormProps {
  members: Array<{ id: string; displayName: string }>;
  payorByMember: Record<string, { contactId: string | null; displayName: string; status: "ok" | "missing" | "invalid_multiple" }>;
  defaultAdjustmentDate: string;
}

function getPayorHelperText(
  memberId: string,
  payorByMember: BillingManualAdjustmentFormProps["payorByMember"]
) {
  if (!memberId) return "Billing recipient comes from the member's designated MCC contact.";
  const payor = payorByMember[memberId];
  if (!payor) return "No payor contact designated.";
  if (payor.status === "invalid_multiple") return "Multiple payor contacts are flagged. Resolve the conflict in Member Command Center.";
  return payor.displayName;
}

export function BillingManualAdjustmentForm({
  members,
  payorByMember,
  defaultAdjustmentDate
}: BillingManualAdjustmentFormProps) {
  const [memberId, setMemberId] = useState("");

  const payorDisplay = useMemo(
    () => (memberId ? payorByMember[memberId]?.displayName ?? "No payor contact designated" : "Select member first"),
    [memberId, payorByMember]
  );

  return (
    <form action={submitPayorAction} className="mt-3 grid gap-2 md:grid-cols-6">
      <input type="hidden" name="intent" value="saveBillingAdjustment" />
      <select
        name="memberId"
        value={memberId}
        onChange={(event) => setMemberId(event.target.value)}
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

      <input value={payorDisplay} readOnly className="h-10 rounded-lg border border-border bg-surface px-3 text-muted" />

      <input
        type="date"
        name="adjustmentDate"
        defaultValue={defaultAdjustmentDate}
        className="h-10 rounded-lg border border-border px-3"
      />
      <select name="adjustmentType" className="h-10 rounded-lg border border-border px-3">
        <option value="ManualCharge">Manual Charge</option>
        <option value="ManualCredit">Manual Credit</option>
        <option value="Credit">Credit</option>
        <option value="Discount">Discount</option>
        <option value="Refund">Refund</option>
        <option value="PriorBalance">Prior Balance</option>
        <option value="Other">Other</option>
      </select>
      <input name="description" placeholder="Description" className="h-10 rounded-lg border border-border px-3" />
      <input name="amount" type="number" step="0.01" placeholder="Amount" className="h-10 rounded-lg border border-border px-3" />
      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted md:col-span-5">
        {getPayorHelperText(memberId, payorByMember)}
      </div>
      <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white">
        Add Adjustment
      </button>
    </form>
  );
}
