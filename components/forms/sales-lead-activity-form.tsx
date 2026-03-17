"use client";

import { useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createSalesLeadActivityAction } from "@/app/sales-lead-actions";
import { usePropSyncedState, usePropSyncedStatus } from "@/components/forms/use-prop-synced-state";
import { Button } from "@/components/ui/button";
import {
  LEAD_ACTIVITY_OUTCOMES,
  LEAD_ACTIVITY_TYPES,
  LEAD_FOLLOW_UP_TYPES,
  LEAD_LOST_REASON_OPTIONS
} from "@/lib/canonical";
import { toEasternDateTimeLocal } from "@/lib/timezone";

type LeadLostReason = "" | (typeof LEAD_LOST_REASON_OPTIONS)[number];

type LeadLookup = {
  id: string;
  member_name: string;
  stage: string;
  partner_id?: string | null;
  referral_source_id?: string | null;
};

type PartnerLookup = {
  id: string;
  partner_id?: string | null;
  organization_name: string;
};

type ReferralSourceLookup = {
  id: string;
  referral_source_id?: string | null;
  partner_id?: string | null;
  contact_name: string;
  organization_name: string;
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-semibold text-muted">{children}</span>;
}

export function SalesLeadActivityForm({
  leads,
  partners,
  referralSources,
  initialLeadId,
  initialPartnerId,
  initialReferralSourceId,
  lockedLeadId
}: {
  leads: LeadLookup[];
  partners: PartnerLookup[];
  referralSources: ReferralSourceLookup[];
  initialLeadId?: string;
  initialPartnerId?: string;
  initialReferralSourceId?: string;
  lockedLeadId?: string;
}) {
  const router = useRouter();
  const now = useMemo(() => toEasternDateTimeLocal(), []);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = usePropSyncedStatus([initialLeadId, initialPartnerId, initialReferralSourceId, lockedLeadId], "");

  const uniqueLeads = useMemo(() => {
    const seen = new Set<string>();
    return leads.filter((lead) => {
      const key = lead.id?.trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [leads]);

  const uniquePartners = useMemo(() => {
    const seen = new Set<string>();
    return partners.filter((partner) => {
      const key = partner.id?.trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [partners]);

  const uniqueReferralSources = useMemo(() => {
    const seen = new Set<string>();
    return referralSources.filter((source) => {
      const key = source.id?.trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [referralSources]);

  const resolvedInitialLeadId =
    (initialLeadId && uniqueLeads.find((lead) => lead.id === initialLeadId)?.id) ??
    (lockedLeadId && uniqueLeads.find((lead) => lead.id === lockedLeadId)?.id) ??
    uniqueLeads[0]?.id ??
    "";

  const [form, setForm] = usePropSyncedState(
    () => ({
      leadId: resolvedInitialLeadId,
      activityAt: now,
      activityType: "Call" as (typeof LEAD_ACTIVITY_TYPES)[number],
      outcome: "Spoke with caregiver" as (typeof LEAD_ACTIVITY_OUTCOMES)[number],
      lostReason: "" as LeadLostReason,
      nextFollowUpDate: "",
      nextFollowUpType: "Call" as (typeof LEAD_FOLLOW_UP_TYPES)[number],
      notes: "",
      partnerId: initialPartnerId ?? "",
      referralSourceId: initialReferralSourceId ?? ""
    }),
    [resolvedInitialLeadId, initialPartnerId, initialReferralSourceId, now]
  );

  const showLostReason = form.outcome === "Not a fit";
  const selectedLead = uniqueLeads.find((lead) => lead.id === form.leadId) ?? null;
  const isLeadLocked = Boolean(lockedLeadId && selectedLead && selectedLead.id === lockedLeadId);

  const linkedPartnerOptionId = useMemo(() => {
    if (!selectedLead?.partner_id) return "";
    const match = uniquePartners.find(
      (partner) => partner.id === selectedLead.partner_id || (partner.partner_id && partner.partner_id === selectedLead.partner_id)
    );
    return match?.id ?? "";
  }, [selectedLead?.partner_id, uniquePartners]);

  const linkedReferralOptionId = useMemo(() => {
    if (!selectedLead?.referral_source_id) return "";
    const match = uniqueReferralSources.find(
      (source) => source.id === selectedLead.referral_source_id || (source.referral_source_id && source.referral_source_id === selectedLead.referral_source_id)
    );
    return match?.id ?? "";
  }, [selectedLead?.referral_source_id, uniqueReferralSources]);

  useEffect(() => {
    if (!selectedLead) {
      setForm((current) => ({ ...current, partnerId: "", referralSourceId: "" }));
      return;
    }

    setForm((current) => {
      const nextPartnerId = linkedPartnerOptionId || "";
      const nextReferralSourceId = linkedReferralOptionId || "";
      if (current.partnerId === nextPartnerId && current.referralSourceId === nextReferralSourceId) {
        return current;
      }

      return {
        ...current,
        partnerId: nextPartnerId,
        referralSourceId: nextReferralSourceId
      };
    });
  }, [selectedLead?.id, linkedPartnerOptionId, linkedReferralOptionId]);

  const selectedPartner = uniquePartners.find((partner) => partner.id === form.partnerId) ?? null;
  const selectedReferral = uniqueReferralSources.find((source) => source.id === form.referralSourceId) ?? null;
  const showLinkedPartnerField = Boolean(selectedPartner);
  const showLinkedReferralField = Boolean(selectedReferral);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <FieldLabel>Lead</FieldLabel>
          {isLeadLocked ? (
            <div className="h-11 rounded-lg border border-border bg-slate-50 px-3 text-sm flex items-center">
              {selectedLead?.member_name || "(No member name)"} ({selectedLead?.stage || "-"})
            </div>
          ) : (
            <select
              className="h-11 rounded-lg border border-border px-3"
              value={form.leadId}
              onChange={(event) => setForm((current) => ({ ...current, leadId: event.target.value }))}
            >
              {uniqueLeads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.member_name || "(No member name)"} ({lead.stage})
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="space-y-1 text-sm">
          <FieldLabel>Activity Date/Time</FieldLabel>
          <input
            type="datetime-local"
            className="h-11 rounded-lg border border-border px-3"
            value={form.activityAt}
            onChange={(event) => setForm((current) => ({ ...current, activityAt: event.target.value }))}
          />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <FieldLabel>Activity Type</FieldLabel>
          <select
            className="h-11 rounded-lg border border-border px-3"
            value={form.activityType}
            onChange={(event) =>
              setForm((current) => ({ ...current, activityType: event.target.value as (typeof LEAD_ACTIVITY_TYPES)[number] }))
            }
          >
            {LEAD_ACTIVITY_TYPES.map((activityType) => (
              <option key={activityType} value={activityType}>
                {activityType}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <FieldLabel>Outcome</FieldLabel>
          <select
            className="h-11 rounded-lg border border-border px-3"
            value={form.outcome}
            onChange={(event) => {
              const outcome = event.target.value as (typeof LEAD_ACTIVITY_OUTCOMES)[number];
              setForm((current) => ({
                ...current,
                outcome,
                lostReason: outcome === "Not a fit" ? current.lostReason : ""
              }));
            }}
          >
            {LEAD_ACTIVITY_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {outcome}
              </option>
            ))}
          </select>
        </label>

        {showLostReason ? (
          <label className="space-y-1 text-sm">
            <FieldLabel>Lost Reason</FieldLabel>
            <select
              className="h-11 rounded-lg border border-border px-3"
              value={form.lostReason}
              onChange={(event) => setForm((current) => ({ ...current, lostReason: event.target.value as LeadLostReason }))}
            >
              <option value="">Select lost reason</option>
              {LEAD_LOST_REASON_OPTIONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {showLinkedPartnerField || showLinkedReferralField ? (
        <div className="grid gap-3 md:grid-cols-2">
          {showLinkedPartnerField ? (
            <label className="space-y-1 text-sm">
              <FieldLabel>Linked Community Partner Organization</FieldLabel>
              <div className="h-11 rounded-lg border border-border bg-slate-50 px-3 text-sm flex items-center">
                {selectedPartner?.organization_name}
              </div>
            </label>
          ) : null}

          {showLinkedReferralField ? (
            <label className="space-y-1 text-sm">
              <FieldLabel>Linked Referral Source</FieldLabel>
              <div className="h-11 rounded-lg border border-border bg-slate-50 px-3 text-sm flex items-center">
                {selectedReferral?.contact_name}
              </div>
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <FieldLabel>Next Follow-Up Date</FieldLabel>
          <input
            type="date"
            className="h-11 rounded-lg border border-border px-3"
            value={form.nextFollowUpDate}
            onChange={(event) => setForm((current) => ({ ...current, nextFollowUpDate: event.target.value }))}
          />
        </label>

        <label className="space-y-1 text-sm">
          <FieldLabel>Next Follow-Up Type</FieldLabel>
          <select
            className="h-11 rounded-lg border border-border px-3"
            value={form.nextFollowUpType}
            onChange={(event) =>
              setForm((current) => ({ ...current, nextFollowUpType: event.target.value as (typeof LEAD_FOLLOW_UP_TYPES)[number] }))
            }
          >
            {LEAD_FOLLOW_UP_TYPES.map((followupType) => (
              <option key={followupType} value={followupType}>
                {followupType}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="space-y-1 text-sm block">
        <FieldLabel>Notes</FieldLabel>
        <textarea
          className="min-h-20 w-full rounded-lg border border-border p-3"
          placeholder="Notes"
          value={form.notes}
          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
        />
      </label>

      <Button
        type="button"
        disabled={isPending || !form.leadId || (showLostReason && !form.lostReason)}
        onClick={() =>
          startTransition(async () => {
            const response = await createSalesLeadActivityAction(form);
            if (response.error) {
              setStatus(`Error: ${response.error}`);
              return;
            }
            if (lockedLeadId) {
              router.push(`/sales/leads/${lockedLeadId}`);
              return;
            }

            setStatus("Lead activity saved.");
          })
        }
      >
        Save Lead Activity
      </Button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
