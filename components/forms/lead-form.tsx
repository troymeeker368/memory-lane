"use client";

import { useMemo, useState, useTransition } from "react";

import { createLeadAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  LEAD_FOLLOW_UP_TYPES,
  LEAD_LIKELIHOOD_OPTIONS,
  LEAD_LOST_REASON_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STAGE_OPTIONS,
  LEAD_STATUS_OPTIONS
} from "@/lib/canonical";
import { formatPhoneInput } from "@/lib/phone";
import { toEasternDate } from "@/lib/timezone";

type LeadLostReason = "" | (typeof LEAD_LOST_REASON_OPTIONS)[number];

export function LeadForm() {
  const today = useMemo(() => toEasternDate(), []);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({
    stage: "Inquiry" as (typeof LEAD_STAGE_OPTIONS)[number],
    status: "Open" as (typeof LEAD_STATUS_OPTIONS)[number],
    inquiryDate: today,
    caregiverName: "",
    caregiverRelationship: "",
    caregiverEmail: "",
    caregiverPhone: "",
    memberName: "",
    leadSource: "Referral" as (typeof LEAD_SOURCE_OPTIONS)[number],
    referralName: "",
    likelihood: "Warm" as (typeof LEAD_LIKELIHOOD_OPTIONS)[number],
    nextFollowUpDate: "",
    nextFollowUpType: "Call" as (typeof LEAD_FOLLOW_UP_TYPES)[number],
    tourDate: "",
    lostReason: "" as LeadLostReason,
    notes: ""
  });

  const needsLostReason = form.stage === "Closed - Lost" || form.status === "Lost";

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Caregiver Name</span>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.caregiverName} onChange={(e) => setForm((f) => ({ ...f, caregiverName: e.target.value }))} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Member Name</span>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.memberName} onChange={(e) => setForm((f) => ({ ...f, memberName: e.target.value }))} />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Caregiver Relationship</span>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.caregiverRelationship} onChange={(e) => setForm((f) => ({ ...f, caregiverRelationship: e.target.value }))} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Phone</span>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.caregiverPhone} onChange={(e) => setForm((f) => ({ ...f, caregiverPhone: formatPhoneInput(e.target.value) }))} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Email</span>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.caregiverEmail} onChange={(e) => setForm((f) => ({ ...f, caregiverEmail: e.target.value }))} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Inquiry Date</span>
          <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.inquiryDate} onChange={(e) => setForm((f) => ({ ...f, inquiryDate: e.target.value }))} />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Stage</span>
          <select className="h-11 w-full rounded-lg border border-border px-3" value={form.stage} onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value as (typeof LEAD_STAGE_OPTIONS)[number] }))}>
            {LEAD_STAGE_OPTIONS.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Status</span>
          <select className="h-11 w-full rounded-lg border border-border px-3" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as (typeof LEAD_STATUS_OPTIONS)[number] }))}>
            {LEAD_STATUS_OPTIONS.map((statusOption) => <option key={statusOption} value={statusOption}>{statusOption}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Lead Source</span>
          <select className="h-11 w-full rounded-lg border border-border px-3" value={form.leadSource} onChange={(e) => setForm((f) => ({ ...f, leadSource: e.target.value as (typeof LEAD_SOURCE_OPTIONS)[number] }))}>
            {LEAD_SOURCE_OPTIONS.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Referral Name</span>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.referralName} onChange={(e) => setForm((f) => ({ ...f, referralName: e.target.value }))} />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Likelihood</span>
          <select className="h-11 w-full rounded-lg border border-border px-3" value={form.likelihood} onChange={(e) => setForm((f) => ({ ...f, likelihood: e.target.value as (typeof LEAD_LIKELIHOOD_OPTIONS)[number] }))}>
            {LEAD_LIKELIHOOD_OPTIONS.map((likelihood) => <option key={likelihood} value={likelihood}>{likelihood}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Next Follow-Up Date</span>
          <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.nextFollowUpDate} onChange={(e) => setForm((f) => ({ ...f, nextFollowUpDate: e.target.value }))} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Next Follow-Up Type</span>
          <select className="h-11 w-full rounded-lg border border-border px-3" value={form.nextFollowUpType} onChange={(e) => setForm((f) => ({ ...f, nextFollowUpType: e.target.value as (typeof LEAD_FOLLOW_UP_TYPES)[number] }))}>
            {LEAD_FOLLOW_UP_TYPES.map((follow) => <option key={follow} value={follow}>{follow}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Tour Date</span>
          <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.tourDate} onChange={(e) => setForm((f) => ({ ...f, tourDate: e.target.value }))} />
        </label>
      </div>

      {needsLostReason ? (
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Lost Reason (required)</span>
          <select
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.lostReason}
            onChange={(e) => setForm((f) => ({ ...f, lostReason: e.target.value as LeadLostReason }))}
          >
            <option value="">Select lost reason</option>
            {LEAD_LOST_REASON_OPTIONS.map((lostReason) => <option key={lostReason} value={lostReason}>{lostReason}</option>)}
          </select>
        </label>
      ) : null}

      <textarea className="min-h-24 w-full rounded-lg border border-border p-3 text-sm" placeholder="Notes (Summary)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />

      <Button
        type="button"
        disabled={isPending || (needsLostReason && !form.lostReason)}
        onClick={() =>
          startTransition(async () => {
            const res = await createLeadAction(form);
            setStatus(res.error ? `Error: ${res.error}` : "Lead created.");
          })
        }
      >
        Save Inquiry
      </Button>
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

