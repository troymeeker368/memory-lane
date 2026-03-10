"use client";

import { useEffect, useMemo, useState } from "react";

import { saveBillingAdjustmentAction } from "@/app/(portal)/operations/payor/actions";
import { useConstrainedSelection } from "@/components/forms/use-constrained-selection";

interface BillingManualAdjustmentFormProps {
  members: Array<{ id: string; displayName: string }>;
  payors: Array<{ id: string; payorName: string }>;
  memberPayorIdsByMember: Record<string, string[]>;
  defaultAdjustmentDate: string;
}

export function BillingManualAdjustmentForm({
  members,
  payors,
  memberPayorIdsByMember,
  defaultAdjustmentDate
}: BillingManualAdjustmentFormProps) {
  const [memberId, setMemberId] = useState("");
  const [payorId, setPayorId] = useState("");

  const filteredPayors = useMemo(() => {
    if (!memberId) return [];
    const allowed = new Set(memberPayorIdsByMember[memberId] ?? []);
    if (allowed.size === 0) return [];
    return payors.filter((payor) => allowed.has(payor.id));
  }, [memberId, memberPayorIdsByMember, payors]);

  useConstrainedSelection({
    selectedId: payorId,
    setSelectedId: setPayorId,
    options: filteredPayors,
    autoSelectSingle: Boolean(memberId)
  });

  return (
    <form action={saveBillingAdjustmentAction} className="mt-3 grid gap-2 md:grid-cols-6">
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

      <select
        name="payorId"
        value={payorId}
        onChange={(event) => setPayorId(event.target.value)}
        className="h-10 rounded-lg border border-border px-3"
        disabled={!memberId}
      >
        <option value="">
          {!memberId
            ? "Select member first"
            : filteredPayors.length === 0
              ? "No linked payor"
              : "Payor"}
        </option>
        {filteredPayors.map((payor) => (
          <option key={payor.id} value={payor.id}>
            {payor.payorName}
          </option>
        ))}
      </select>

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
      <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white">
        Add Adjustment
      </button>
    </form>
  );
}
