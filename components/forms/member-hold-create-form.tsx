"use client";

import { useState } from "react";

import { MEMBER_HOLD_REASON_OPTIONS } from "@/lib/canonical";

export function MemberHoldCreateForm({
  action,
  activeMembers,
  defaultStartDate,
  defaultEndDate
}: {
  action: (formData: FormData) => void | Promise<void>;
  activeMembers: Array<{ id: string; displayName: string }>;
  defaultStartDate: string;
  defaultEndDate: string;
}) {
  const [reason, setReason] = useState("");

  return (
    <form action={action} className="mt-3 grid gap-3 md:grid-cols-3">
      <label className="space-y-1 text-sm md:col-span-2">
        <span className="text-xs font-semibold text-muted">Member</span>
        <select name="memberId" required className="h-10 w-full rounded-lg border border-border px-3">
          <option value="">Select member</option>
          {activeMembers.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Reason</span>
        <select
          name="reason"
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="h-10 w-full rounded-lg border border-border px-3"
        >
          <option value="">Select reason</option>
          {MEMBER_HOLD_REASON_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Start Date</span>
        <input
          type="date"
          name="startDate"
          required
          defaultValue={defaultStartDate}
          className="h-10 w-full rounded-lg border border-border px-3"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">End Date</span>
        <input
          type="date"
          name="endDate"
          defaultValue={defaultEndDate}
          className="h-10 w-full rounded-lg border border-border px-3"
        />
      </label>
      {reason === "Other" ? (
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Reason (Other)</span>
          <input
            name="reasonOther"
            required
            placeholder="Enter custom reason"
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
      ) : (
        <input type="hidden" name="reasonOther" value="" />
      )}
      <label className="space-y-1 text-sm md:col-span-3">
        <span className="text-xs font-semibold text-muted">Notes</span>
        <textarea name="notes" className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" />
      </label>
      <div className="md:col-span-3">
        <button type="submit" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
          Save Hold
        </button>
      </div>
    </form>
  );
}
