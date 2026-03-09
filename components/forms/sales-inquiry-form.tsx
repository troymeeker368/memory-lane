"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveSalesLeadAction } from "@/app/sales-actions";
import { Button } from "@/components/ui/button";
import {
  LEAD_FOLLOW_UP_TYPES,
  LEAD_LIKELIHOOD_OPTIONS,
  LEAD_LOST_REASON_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STAGE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  canonicalLeadStage,
  canonicalLeadStatus
} from "@/lib/canonical";
import { toEasternDate } from "@/lib/timezone";

type PartnerLookup = {
  id: string;
  partner_id: string;
  organization_name: string;
};

type ReferralSourceLookup = {
  id: string;
  referral_source_id: string;
  partner_id: string;
  contact_name: string;
  organization_name: string;
};

type LeadLookup = {
  id: string;
  stage: string;
  status: string;
  inquiry_date: string;
  caregiver_name: string;
  caregiver_relationship: string | null;
  caregiver_email: string | null;
  caregiver_phone: string;
  member_name: string;
  lead_source: string;
  lead_source_other?: string | null;
  partner_id: string | null;
  referral_source_id?: string | null;
  referral_name: string | null;
  likelihood: string | null;
  next_follow_up_date: string | null;
  next_follow_up_type: string | null;
  tour_date: string | null;
  tour_completed?: boolean;
  discovery_date: string | null;
  member_start_date: string | null;
  notes_summary: string | null;
  lost_reason: string | null;
  closed_date?: string | null;
};

function FieldLabel({ children }: { children: string }) {
  return <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{children}</span>;
}

function splitLostReason(initialLostReason: string | null | undefined) {
  const value = (initialLostReason ?? "").trim();
  if (!value) {
    return { lostReason: "", lostReasonOther: "" };
  }

  if (LEAD_LOST_REASON_OPTIONS.includes(value as (typeof LEAD_LOST_REASON_OPTIONS)[number])) {
    return { lostReason: value, lostReasonOther: "" };
  }

  return { lostReason: "Other", lostReasonOther: value };
}

export function SalesInquiryForm({
  partners,
  referralSources,
  initialLead,
  initialPartnerId,
  initialReferralSourceId
}: {
  partners: PartnerLookup[];
  referralSources: ReferralSourceLookup[];
  initialLead?: LeadLookup | null;
  initialPartnerId?: string;
  initialReferralSourceId?: string;
}) {
  const router = useRouter();
  const today = useMemo(() => toEasternDate(), []);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const defaultPartnerId =
    partners.find((partner) => partner.partner_id === (initialLead?.partner_id ?? initialPartnerId))?.id ?? "";
  const defaultReferralId =
    referralSources.find((source) => source.referral_source_id === (initialLead?.referral_source_id ?? initialReferralSourceId))?.id ?? "";
  const fallbackPartnerFromReferralId =
    defaultReferralId && !defaultPartnerId
      ? partners.find((partner) => {
          const source = referralSources.find((item) => item.id === defaultReferralId);
          return source ? partner.partner_id === source.partner_id : false;
        })?.id ?? ""
      : "";

  const initialLost = splitLostReason(initialLead?.lost_reason);

  const [form, setForm] = useState({
    leadId: initialLead?.id ?? "",
    stage: (initialLead?.stage as (typeof LEAD_STAGE_OPTIONS)[number]) ?? "Inquiry",
    status: (initialLead?.status as (typeof LEAD_STATUS_OPTIONS)[number]) ?? "Open",
    inquiryDate: initialLead?.inquiry_date ?? today,
    caregiverName: initialLead?.caregiver_name ?? "",
    caregiverRelationship: initialLead?.caregiver_relationship ?? "",
    caregiverEmail: initialLead?.caregiver_email ?? "",
    caregiverPhone: initialLead?.caregiver_phone ?? "",
    memberName: initialLead?.member_name ?? "",
    leadSource: (initialLead?.lead_source as (typeof LEAD_SOURCE_OPTIONS)[number]) ?? "Referral",
    leadSourceOther: initialLead?.lead_source_other ?? "",
    partnerId: defaultPartnerId || fallbackPartnerFromReferralId,
    referralSourceId: defaultReferralId,
    referralName: initialLead?.referral_name ?? "",
    likelihood: (initialLead?.likelihood as (typeof LEAD_LIKELIHOOD_OPTIONS)[number]) ?? "Warm",
    nextFollowUpDate: initialLead?.next_follow_up_date ?? "",
    nextFollowUpType: (initialLead?.next_follow_up_type as (typeof LEAD_FOLLOW_UP_TYPES)[number]) ?? "Call",
    tourDate: initialLead?.tour_date ?? "",
    tourCompleted: typeof initialLead?.tour_completed === "boolean" ? (initialLead.tour_completed ? "yes" : "no") : "",
    discoveryDate: initialLead?.discovery_date ?? "",
    memberStartDate: initialLead?.member_start_date ?? "",
    notesSummary: initialLead?.notes_summary ?? "",
    lostReason: initialLost.lostReason,
    lostReasonOther: initialLost.lostReasonOther,
    closedDate: initialLead?.closed_date ?? ""
  });

  const canonicalStage = canonicalLeadStage(form.stage);
  const effectiveStatus = canonicalStage === "Closed - Lost" ? "Lost" : canonicalLeadStatus(form.status, canonicalStage);
  const isEipStage = canonicalStage === "Enrollment in Progress";
  const showLostFields = effectiveStatus === "Lost";
  const showTourCompleted = Boolean(form.tourDate);
  const showReferralName = form.leadSource === "Referral";
  const showLeadSourceOther = form.leadSource === "Other";

  const selectedPartner = partners.find((partner) => partner.id === form.partnerId) ?? null;
  const filteredReferralSources = selectedPartner
    ? referralSources.filter((source) => source.partner_id === selectedPartner.partner_id)
    : [];
  const hasSelectedPartner = Boolean(selectedPartner);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <FieldLabel>Member Name</FieldLabel>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.memberName} onChange={(event) => setForm((current) => ({ ...current, memberName: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Caregiver Name</FieldLabel>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.caregiverName} onChange={(event) => setForm((current) => ({ ...current, caregiverName: event.target.value }))} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <FieldLabel>Caregiver Relationship</FieldLabel>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.caregiverRelationship} onChange={(event) => setForm((current) => ({ ...current, caregiverRelationship: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Caregiver Phone</FieldLabel>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.caregiverPhone} onChange={(event) => setForm((current) => ({ ...current, caregiverPhone: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Caregiver Email</FieldLabel>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.caregiverEmail} onChange={(event) => setForm((current) => ({ ...current, caregiverEmail: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Inquiry Date</FieldLabel>
          <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.inquiryDate} onChange={(event) => setForm((current) => ({ ...current, inquiryDate: event.target.value }))} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <FieldLabel>Stage</FieldLabel>
          <select
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.stage}
            onChange={(event) =>
              setForm((current) => {
                const nextStage = event.target.value as (typeof LEAD_STAGE_OPTIONS)[number];
                const normalizedStage = canonicalLeadStage(nextStage);
                const stageDrivenStatus = normalizedStage === "Closed - Lost" ? "Lost" : canonicalLeadStatus("Open", normalizedStage);
                const isNowLost = stageDrivenStatus === "Lost";
                const isNowEip = normalizedStage === "Enrollment in Progress";

                return {
                  ...current,
                  stage: nextStage,
                  status: stageDrivenStatus,
                  nextFollowUpDate: isNowLost ? "" : current.nextFollowUpDate,
                  nextFollowUpType: isNowLost ? "" : current.nextFollowUpType,
                  lostReason: isNowLost ? current.lostReason : "",
                  lostReasonOther: isNowLost ? current.lostReasonOther : "",
                  closedDate: isNowLost ? current.closedDate || today : "",
                  memberStartDate: isNowEip ? current.memberStartDate : ""
                };
              })
            }
          >
            {LEAD_STAGE_OPTIONS.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>Status</FieldLabel>
          <select
            className="h-11 w-full rounded-lg border border-border px-3"
            value={effectiveStatus}
            onChange={(event) =>
              setForm((current) => {
                const nextStatus = event.target.value as (typeof LEAD_STATUS_OPTIONS)[number];
                const markLost = nextStatus === "Lost";
                const markWon = nextStatus === "Won";
                const markNurture = nextStatus === "Nurture";
                const nextStage = markLost
                  ? "Closed - Lost"
                  : markWon
                    ? "Closed - Won"
                    : markNurture
                      ? "Nurture"
                      : current.stage === "Closed - Lost" || current.stage === "Closed - Won"
                        ? "Inquiry"
                        : current.stage;
                return {
                  ...current,
                  status: nextStatus,
                  stage: nextStage,
                  nextFollowUpDate: markLost ? "" : current.nextFollowUpDate,
                  nextFollowUpType: markLost ? "" : current.nextFollowUpType,
                  lostReason: markLost ? current.lostReason : "",
                  lostReasonOther: markLost ? current.lostReasonOther : "",
                  closedDate: markLost ? current.closedDate || today : markWon ? current.closedDate || today : ""
                };
              })
            }
          >
            {LEAD_STATUS_OPTIONS.map((statusOption) => <option key={statusOption} value={statusOption}>{statusOption}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>Lead Source</FieldLabel>
          <select
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.leadSource}
            onChange={(event) =>
              setForm((current) => {
                const nextSource = event.target.value as (typeof LEAD_SOURCE_OPTIONS)[number];
                return {
                  ...current,
                  leadSource: nextSource,
                  referralSourceId: nextSource === "Referral" ? current.referralSourceId : "",
                  referralName: nextSource === "Referral" ? current.referralName : "",
                  leadSourceOther: nextSource === "Other" ? current.leadSourceOther : ""
                };
              })
            }
          >
            {LEAD_SOURCE_OPTIONS.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>Likelihood</FieldLabel>
          <select className="h-11 w-full rounded-lg border border-border px-3" value={form.likelihood} onChange={(event) => setForm((current) => ({ ...current, likelihood: event.target.value as (typeof LEAD_LIKELIHOOD_OPTIONS)[number] }))}>{LEAD_LIKELIHOOD_OPTIONS.map((likelihood) => <option key={likelihood} value={likelihood}>{likelihood}</option>)}</select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <FieldLabel>Community Partner Organization</FieldLabel>
          <select
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.partnerId}
            onChange={(event) => {
              const nextPartnerId = event.target.value;
              const nextPartner = partners.find((partner) => partner.id === nextPartnerId) ?? null;
              const nextReferralIds = nextPartner
                ? new Set(
                    referralSources
                      .filter((source) => source.partner_id === nextPartner.partner_id)
                      .map((source) => source.id)
                  )
                : new Set<string>();
              setForm((current) => ({
                ...current,
                partnerId: nextPartnerId,
                referralSourceId: nextPartner && nextReferralIds.has(current.referralSourceId) ? current.referralSourceId : "",
                referralName: nextPartner && nextReferralIds.has(current.referralSourceId) ? current.referralName : ""
              }));
            }}
          >
            <option value="">No linked Community Partner</option>
            {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.organization_name}</option>)}
          </select>
        </div>

        {showReferralName ? (
          <div>
            <FieldLabel>Referral Source</FieldLabel>
            <select
              className="h-11 w-full rounded-lg border border-border px-3"
              value={form.referralSourceId}
              disabled={!hasSelectedPartner}
              onChange={(event) => {
                const referralSourceId = event.target.value;
                const source = referralSources.find((item) => item.id === referralSourceId);
                setForm((current) => ({
                  ...current,
                  referralSourceId,
                  referralName: source ? source.contact_name : current.referralName,
                  partnerId: source ? (partners.find((partner) => partner.partner_id === source.partner_id)?.id ?? current.partnerId) : current.partnerId
                }));
              }}
            >
              <option value="">{hasSelectedPartner ? "Select Referral Source" : "Select CPO first"}</option>
              {filteredReferralSources.map((source) => <option key={source.id} value={source.id}>{source.contact_name}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">
              {hasSelectedPartner
                ? "Referral source options are filtered by selected organization."
                : "Select Community Partner Organization to load referral source contacts."}
            </p>
          </div>
        ) : null}
      </div>

      {showReferralName ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <FieldLabel>Referral Name</FieldLabel>
            <input className="h-11 w-full rounded-lg border border-border px-3" value={form.referralName} onChange={(event) => setForm((current) => ({ ...current, referralName: event.target.value }))} />
          </div>
          <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted">
            Select existing referral source first when possible.
            <div className="mt-1 flex gap-3">
              <Link href="/sales/new-entries/new-referral-source" className="font-semibold text-brand">Add Referral Source</Link>
              <Link href="/sales/new-entries/new-community-partner" className="font-semibold text-brand">Add Community Partner</Link>
            </div>
          </div>
        </div>
      ) : null}

      {showLeadSourceOther ? (
        <div>
          <FieldLabel>Lead Source Other</FieldLabel>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.leadSourceOther} onChange={(event) => setForm((current) => ({ ...current, leadSourceOther: event.target.value }))} />
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <FieldLabel>Next Follow-Up Date</FieldLabel>
          <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.nextFollowUpDate} onChange={(event) => setForm((current) => ({ ...current, nextFollowUpDate: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Next Follow-Up Type</FieldLabel>
          <select className="h-11 w-full rounded-lg border border-border px-3" value={form.nextFollowUpType} onChange={(event) => setForm((current) => ({ ...current, nextFollowUpType: event.target.value as (typeof LEAD_FOLLOW_UP_TYPES)[number] }))}><option value="">Select</option>{LEAD_FOLLOW_UP_TYPES.map((followupType) => <option key={followupType} value={followupType}>{followupType}</option>)}</select>
        </div>
        <div>
          <FieldLabel>Tour Date</FieldLabel>
          <input
            type="date"
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.tourDate}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                tourDate: event.target.value,
                tourCompleted: event.target.value ? current.tourCompleted : ""
              }))
            }
          />
        </div>
        <div>
          <FieldLabel>Discovery Date</FieldLabel>
          <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.discoveryDate} onChange={(event) => setForm((current) => ({ ...current, discoveryDate: event.target.value }))} />
        </div>
      </div>

      {showTourCompleted ? (
        <div>
          <FieldLabel>Tour Completed</FieldLabel>
          <select className="h-11 w-full rounded-lg border border-border px-3 md:max-w-sm" value={form.tourCompleted} onChange={(event) => setForm((current) => ({ ...current, tourCompleted: event.target.value }))}>
            <option value="">Select</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {isEipStage ? (
          <div>
            <FieldLabel>Member Start Date</FieldLabel>
            <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.memberStartDate} onChange={(event) => setForm((current) => ({ ...current, memberStartDate: event.target.value }))} />
          </div>
        ) : null}

        {showLostFields ? (
          <div className="space-y-2">
            <FieldLabel>Lost Reason</FieldLabel>
            <select
              className="h-11 w-full rounded-lg border border-border px-3"
              value={form.lostReason}
              onChange={(event) => setForm((current) => ({ ...current, lostReason: event.target.value, lostReasonOther: event.target.value === "Other" ? current.lostReasonOther : "" }))}
            >
              <option value="">Select lost reason</option>
              {LEAD_LOST_REASON_OPTIONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
            </select>
            {form.lostReason === "Other" ? (
              <input
                className="h-11 w-full rounded-lg border border-border px-3"
                placeholder="Enter lost reason"
                value={form.lostReasonOther}
                onChange={(event) => setForm((current) => ({ ...current, lostReasonOther: event.target.value }))}
              />
            ) : null}
            <FieldLabel>Closed Date</FieldLabel>
            <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.closedDate} onChange={(event) => setForm((current) => ({ ...current, closedDate: event.target.value }))} />
          </div>
        ) : null}
      </div>

      <div>
        <FieldLabel>Notes (Summary)</FieldLabel>
        <textarea className="min-h-24 w-full rounded-lg border border-border p-3" value={form.notesSummary} onChange={(event) => setForm((current) => ({ ...current, notesSummary: event.target.value }))} />
      </div>

      <Button
        type="button"
        disabled={
          isPending ||
          !form.memberName.trim() ||
          !form.caregiverName.trim() ||
          !form.caregiverPhone.trim() ||
          !form.inquiryDate ||
          (showReferralName && (!form.partnerId || !form.referralSourceId || !form.referralName.trim())) ||
          (showLeadSourceOther && !form.leadSourceOther.trim()) ||
          (showTourCompleted && !form.tourCompleted) ||
          (showLostFields && (!form.lostReason || !form.closedDate || (form.lostReason === "Other" && !form.lostReasonOther.trim())))
        }
        onClick={() =>
          startTransition(async () => {
            const response = await saveSalesLeadAction({
              ...form,
              tourCompleted: showTourCompleted ? form.tourCompleted === "yes" : undefined,
              closedDate: showLostFields ? form.closedDate : ""
            });
            if (response.error) {
              setStatus(`Error: ${response.error}`);
              return;
            }
            setStatus(initialLead ? "Lead updated." : "Inquiry created.");
            if (response.id) {
              router.push(`/sales/leads/${response.id}`);
            }
          })
        }
      >
        {initialLead ? "Save Lead" : "Save Inquiry"}
      </Button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
