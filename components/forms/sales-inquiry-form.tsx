"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { loadSalesReferralSourcesForPartnerAction } from "@/app/lookup-actions";
import { saveSalesLeadAction } from "@/app/sales-lead-actions";
import { usePropSyncedState, usePropSyncedStatus } from "@/components/forms/use-prop-synced-state";
import { Button } from "@/components/ui/button";
import {
  LEAD_FOLLOW_UP_TYPES,
  LEAD_LIKELIHOOD_OPTIONS,
  LEAD_LOST_REASON_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STAGE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  resolveCanonicalLeadState
} from "@/lib/canonical";
import { formatPhoneDisplay, formatPhoneInput } from "@/lib/phone";
import {
  normalizeLeadFormInquiryDate,
  normalizeLeadFormSummary
} from "@/lib/services/lead-form-normalization";
import { toEasternDate } from "@/lib/timezone";

export type PartnerLookup = {
  id: string;
  partner_id: string;
  organization_name: string;
};

export type ReferralSourceLookup = {
  id: string;
  referral_source_id: string;
  partner_id: string;
  contact_name: string;
  organization_name: string;
};

export type LeadLookup = {
  id: string;
  stage: string;
  status: string;
  inquiry_date: string;
  caregiver_name: string;
  caregiver_relationship: string | null;
  caregiver_email: string | null;
  caregiver_phone: string;
  member_name: string;
  member_dob: string | null;
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

type LeadDuplicateMatch = {
  leadId: string;
  leadDisplayId: string;
  memberName: string;
  caregiverName: string;
  caregiverPhone: string | null;
  caregiverEmail: string | null;
  memberDob: string | null;
  stage: string;
  status: string;
  inquiryDate: string;
  score: number;
  reasons: string[];
};

type SalesLeadSaveResponse = {
  ok?: boolean;
  id?: string;
  merged?: boolean;
  mergedIntoLeadId?: string;
  mergedSourceLeadId?: string | null;
  error?: string;
  duplicateRequiresDecision?: boolean;
  duplicateMatches?: LeadDuplicateMatch[];
  canKeepSeparate?: boolean;
};

type SalesLeadFormState = {
  leadId: string;
  stage: (typeof LEAD_STAGE_OPTIONS)[number];
  status: (typeof LEAD_STATUS_OPTIONS)[number];
  inquiryDate: string;
  caregiverName: string;
  caregiverRelationship: string;
  caregiverEmail: string;
  caregiverPhone: string;
  memberName: string;
  memberDob: string;
  leadSource: (typeof LEAD_SOURCE_OPTIONS)[number];
  leadSourceOther: string;
  partnerId: string;
  referralSourceId: string;
  referralName: string;
  likelihood: (typeof LEAD_LIKELIHOOD_OPTIONS)[number];
  nextFollowUpDate: string;
  nextFollowUpType: (typeof LEAD_FOLLOW_UP_TYPES)[number] | "";
  tourDate: string;
  tourCompleted: "yes" | "no" | "";
  discoveryDate: string;
  memberStartDate: string;
  notesSummary: string;
  lostReason: string;
  lostReasonOther: string;
  closedDate: string;
};

type DuplicateReviewState = {
  matches: LeadDuplicateMatch[];
  canKeepSeparate: boolean;
};

function FieldLabel({ children }: { children: string }) {
  return <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{children}</span>;
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
  const [isReferralLookupPending, startReferralLookupTransition] = useTransition();
  const syncDeps = [initialLead?.id ?? "", initialPartnerId ?? "", initialReferralSourceId ?? ""];
  const [status, setStatus] = usePropSyncedStatus(syncDeps, "");
  const [duplicateReview, setDuplicateReview] = usePropSyncedState<DuplicateReviewState | null>(null, syncDeps);
  const [mergeTargetLeadId, setMergeTargetLeadId] = usePropSyncedState("", syncDeps);
  const normalizedInitialLead = normalizeLeadFormSummary(initialLead);
  const [loadedReferralSources, setLoadedReferralSources] = useState<ReferralSourceLookup[]>(referralSources);

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

  const [form, setForm] = usePropSyncedState<SalesLeadFormState>(
    () => ({
      leadId: initialLead?.id ?? "",
      stage: normalizedInitialLead.stage,
      status: normalizedInitialLead.status,
      inquiryDate: normalizeLeadFormInquiryDate(initialLead?.inquiry_date, today),
      caregiverName: initialLead?.caregiver_name ?? "",
      caregiverRelationship: initialLead?.caregiver_relationship ?? "",
      caregiverEmail: initialLead?.caregiver_email ?? "",
      caregiverPhone: formatPhoneInput(initialLead?.caregiver_phone ?? ""),
      memberName: initialLead?.member_name ?? "",
      memberDob: initialLead?.member_dob ?? "",
      leadSource: normalizedInitialLead.leadSource,
      leadSourceOther: normalizedInitialLead.leadSourceOther ?? "",
      partnerId: defaultPartnerId || fallbackPartnerFromReferralId,
      referralSourceId: defaultReferralId,
      referralName: initialLead?.referral_name ?? "",
      likelihood: normalizedInitialLead.likelihood,
      nextFollowUpDate: initialLead?.next_follow_up_date ?? "",
      nextFollowUpType: normalizedInitialLead.nextFollowUpType,
      tourDate: initialLead?.tour_date ?? "",
      tourCompleted: normalizedInitialLead.tourCompleted,
      discoveryDate: initialLead?.discovery_date ?? "",
      memberStartDate: initialLead?.member_start_date ?? "",
      notesSummary: initialLead?.notes_summary ?? "",
      lostReason: normalizedInitialLead.lostReason,
      lostReasonOther: normalizedInitialLead.lostReasonOther,
      closedDate: normalizedInitialLead.closedDate
    }),
    [
      today,
      ...syncDeps,
      defaultPartnerId,
      defaultReferralId,
      fallbackPartnerFromReferralId,
      normalizedInitialLead.closedDate,
      normalizedInitialLead.leadSource,
      normalizedInitialLead.leadSourceOther,
      normalizedInitialLead.likelihood,
      normalizedInitialLead.lostReason,
      normalizedInitialLead.lostReasonOther,
      normalizedInitialLead.nextFollowUpType,
      normalizedInitialLead.stage,
      normalizedInitialLead.status,
      normalizedInitialLead.tourCompleted
    ]
  );

  function clearDuplicateReview() {
    setDuplicateReview(null);
    setMergeTargetLeadId("");
  }

  useEffect(() => {
    setLoadedReferralSources(referralSources);
  }, [referralSources]);

  function updateForm(updater: SalesLeadFormState | ((current: SalesLeadFormState) => SalesLeadFormState)) {
    setForm((current) => (typeof updater === "function" ? updater(current) : updater));
    if (status) setStatus("");
    if (duplicateReview) clearDuplicateReview();
  }

  function loadReferralSourcesForPartner(nextPartnerId: string, selectedId?: string | null) {
    if (!nextPartnerId) {
      setLoadedReferralSources([]);
      return;
    }
    startReferralLookupTransition(async () => {
      const nextSources = await loadSalesReferralSourcesForPartnerAction({
        partnerId: nextPartnerId,
        selectedId: selectedId ?? null
      });
      setLoadedReferralSources(nextSources as ReferralSourceLookup[]);
    });
  }

  async function submitLead(options?: { duplicateDecision?: "merge" | "keep-separate"; mergeTargetLeadId?: string }) {
    const result = (await saveSalesLeadAction({
      ...form,
      tourCompleted: showTourCompleted ? form.tourCompleted === "yes" : undefined,
      closedDate: showLostFields ? form.closedDate : "",
      duplicateDecision: options?.duplicateDecision ?? "",
      mergeTargetLeadId: options?.mergeTargetLeadId ?? "",
      submissionMode: initialLead ? "edit" : "create"
    })) as SalesLeadSaveResponse;

    if (result.duplicateRequiresDecision) {
      const matches = result.duplicateMatches ?? [];
      setDuplicateReview({
        matches,
        canKeepSeparate: Boolean(result.canKeepSeparate)
      });
      setMergeTargetLeadId(matches[0]?.leadId ?? "");
      setStatus("Potential duplicate lead found. Review options below before saving.");
      return;
    }

    if (result.error) {
      setStatus(`Error: ${result.error}`);
      return;
    }

    clearDuplicateReview();
    if (result.merged && result.id) {
      setStatus("Lead merged into existing record.");
      router.push(`/sales/leads/${result.id}`);
      return;
    }

    setStatus(initialLead ? "Lead updated." : "Inquiry created.");
    if (result.id) {
      router.push(`/sales/leads/${result.id}`);
    }
  }

  const { stage: canonicalStage, status: effectiveStatus } = resolveCanonicalLeadState({
    requestedStage: form.stage,
    requestedStatus: form.status
  });
  const isEipStage = canonicalStage === "Enrollment in Progress";
  const showLostFields = effectiveStatus === "Lost";
  const showTourCompleted = Boolean(form.tourDate);
  const showReferralName = form.leadSource === "Referral";
  const showLeadSourceOther = form.leadSource === "Other";

  const selectedPartner = partners.find((partner) => partner.id === form.partnerId) ?? null;
  const filteredReferralSources = selectedPartner
    ? loadedReferralSources.filter((source) => source.partner_id === selectedPartner.partner_id)
    : [];
  const hasSelectedPartner = Boolean(selectedPartner);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <FieldLabel>Member Name</FieldLabel>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.memberName} onChange={(event) => updateForm((current) => ({ ...current, memberName: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Member DOB</FieldLabel>
          <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.memberDob} onChange={(event) => updateForm((current) => ({ ...current, memberDob: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Caregiver Name</FieldLabel>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.caregiverName} onChange={(event) => updateForm((current) => ({ ...current, caregiverName: event.target.value }))} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <FieldLabel>Caregiver Relationship</FieldLabel>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.caregiverRelationship} onChange={(event) => updateForm((current) => ({ ...current, caregiverRelationship: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Caregiver Phone</FieldLabel>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.caregiverPhone} onChange={(event) => updateForm((current) => ({ ...current, caregiverPhone: formatPhoneInput(event.target.value) }))} />
        </div>
        <div>
          <FieldLabel>Caregiver Email</FieldLabel>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.caregiverEmail} onChange={(event) => updateForm((current) => ({ ...current, caregiverEmail: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Inquiry Date</FieldLabel>
          <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.inquiryDate} onChange={(event) => updateForm((current) => ({ ...current, inquiryDate: event.target.value }))} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <FieldLabel>Stage</FieldLabel>
          <select
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.stage}
            onChange={(event) =>
              updateForm((current) => {
                const nextStage = event.target.value as (typeof LEAD_STAGE_OPTIONS)[number];
                const { stage: normalizedStage, status: stageDrivenStatus } = resolveCanonicalLeadState({
                  requestedStage: nextStage,
                  requestedStatus: "Open"
                });
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
              updateForm((current) => {
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
                const resolved = resolveCanonicalLeadState({
                  requestedStage: nextStage,
                  requestedStatus: nextStatus
                });
                return {
                  ...current,
                  status: resolved.status,
                  stage: resolved.stage,
                  nextFollowUpDate: resolved.status === "Lost" ? "" : current.nextFollowUpDate,
                  nextFollowUpType: resolved.status === "Lost" ? "" : current.nextFollowUpType,
                  lostReason: resolved.status === "Lost" ? current.lostReason : "",
                  lostReasonOther: resolved.status === "Lost" ? current.lostReasonOther : "",
                  closedDate:
                    resolved.status === "Lost" ? current.closedDate || today : resolved.status === "Won" ? current.closedDate || today : ""
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
              updateForm((current) => {
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
          <select className="h-11 w-full rounded-lg border border-border px-3" value={form.likelihood} onChange={(event) => updateForm((current) => ({ ...current, likelihood: event.target.value as (typeof LEAD_LIKELIHOOD_OPTIONS)[number] }))}>{LEAD_LIKELIHOOD_OPTIONS.map((likelihood) => <option key={likelihood} value={likelihood}>{likelihood}</option>)}</select>
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
              updateForm((current) => ({
                ...current,
                partnerId: nextPartnerId,
                referralSourceId: "",
                referralName: ""
              }));
              loadReferralSourcesForPartner(nextPartnerId);
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
                const source = loadedReferralSources.find((item) => item.id === referralSourceId);
                updateForm((current) => ({
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
              {isReferralLookupPending
                ? "Loading referral source contacts..."
                : hasSelectedPartner
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
            <input className="h-11 w-full rounded-lg border border-border px-3" value={form.referralName} onChange={(event) => updateForm((current) => ({ ...current, referralName: event.target.value }))} />
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
          <input className="h-11 w-full rounded-lg border border-border px-3" value={form.leadSourceOther} onChange={(event) => updateForm((current) => ({ ...current, leadSourceOther: event.target.value }))} />
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <FieldLabel>Next Follow-Up Date</FieldLabel>
          <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.nextFollowUpDate} onChange={(event) => updateForm((current) => ({ ...current, nextFollowUpDate: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Next Follow-Up Type</FieldLabel>
          <select className="h-11 w-full rounded-lg border border-border px-3" value={form.nextFollowUpType} onChange={(event) => updateForm((current) => ({ ...current, nextFollowUpType: event.target.value as (typeof LEAD_FOLLOW_UP_TYPES)[number] }))}><option value="">Select</option>{LEAD_FOLLOW_UP_TYPES.map((followupType) => <option key={followupType} value={followupType}>{followupType}</option>)}</select>
        </div>
        <div>
          <FieldLabel>Tour Date</FieldLabel>
          <input
            type="date"
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.tourDate}
            onChange={(event) =>
              updateForm((current) => ({
                ...current,
                tourDate: event.target.value,
                tourCompleted: event.target.value ? current.tourCompleted : ""
              }))
            }
          />
        </div>
        <div>
          <FieldLabel>Discovery Date</FieldLabel>
          <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.discoveryDate} onChange={(event) => updateForm((current) => ({ ...current, discoveryDate: event.target.value }))} />
        </div>
      </div>

      {showTourCompleted ? (
        <div>
          <FieldLabel>Tour Completed</FieldLabel>
          <select className="h-11 w-full rounded-lg border border-border px-3 md:max-w-sm" value={form.tourCompleted} onChange={(event) => updateForm((current) => ({ ...current, tourCompleted: event.target.value as "yes" | "no" | "" }))}>
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
            <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.memberStartDate} onChange={(event) => updateForm((current) => ({ ...current, memberStartDate: event.target.value }))} />
          </div>
        ) : null}

        {showLostFields ? (
          <div className="space-y-2">
            <FieldLabel>Lost Reason</FieldLabel>
            <select
              className="h-11 w-full rounded-lg border border-border px-3"
              value={form.lostReason}
              onChange={(event) => updateForm((current) => ({ ...current, lostReason: event.target.value, lostReasonOther: event.target.value === "Other" ? current.lostReasonOther : "" }))}
            >
              <option value="">Select lost reason</option>
              {LEAD_LOST_REASON_OPTIONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
            </select>
            {form.lostReason === "Other" ? (
              <input
                className="h-11 w-full rounded-lg border border-border px-3"
                placeholder="Enter lost reason"
                value={form.lostReasonOther}
                onChange={(event) => updateForm((current) => ({ ...current, lostReasonOther: event.target.value }))}
              />
            ) : null}
            <FieldLabel>Closed Date</FieldLabel>
            <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.closedDate} onChange={(event) => updateForm((current) => ({ ...current, closedDate: event.target.value }))} />
          </div>
        ) : null}
      </div>

      <div>
        <FieldLabel>Notes (Summary)</FieldLabel>
        <textarea className="min-h-24 w-full rounded-lg border border-border p-3" value={form.notesSummary} onChange={(event) => updateForm((current) => ({ ...current, notesSummary: event.target.value }))} />
      </div>

      {duplicateReview ? (
        <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">
            Likely duplicate leads found. Please review before final save.
          </p>
          <div className="space-y-2">
            {duplicateReview.matches.map((match) => (
              <div key={match.leadId} className="rounded-md border border-amber-200 bg-white p-3 text-sm">
                <p className="font-semibold text-slate-900">
                  {match.memberName} ({match.leadDisplayId})
                </p>
                <p className="text-xs text-muted">
                  Stage/Status: {match.stage} / {match.status} | Inquiry Date: {match.inquiryDate}
                </p>
                <p className="text-xs text-muted">Caregiver: {match.caregiverName || "-"} | Phone: {formatPhoneDisplay(match.caregiverPhone)} | Email: {match.caregiverEmail || "-"}</p>
                <p className="mt-1 text-xs text-slate-700">{match.reasons.join(" ")}</p>
                <Link className="mt-2 inline-block text-xs font-semibold text-brand" href={`/sales/leads/${match.leadId}`}>
                  Review Existing Lead
                </Link>
              </div>
            ))}
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <FieldLabel>Merge Into Existing Lead</FieldLabel>
              <select
                className="h-11 w-full rounded-lg border border-border px-3"
                value={mergeTargetLeadId}
                onChange={(event) => setMergeTargetLeadId(event.target.value)}
              >
                <option value="">Select lead to merge into</option>
                {duplicateReview.matches.map((match) => (
                  <option key={match.leadId} value={match.leadId}>
                    {match.memberName} ({match.leadDisplayId}) - {match.stage}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <Button
                type="button"
                disabled={isPending || !mergeTargetLeadId}
                onClick={() =>
                  startTransition(async () => {
                    await submitLead({ duplicateDecision: "merge", mergeTargetLeadId });
                  })
                }
              >
                Merge Into Existing Lead
              </Button>
              {duplicateReview.canKeepSeparate ? (
                <Button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      await submitLead({ duplicateDecision: "keep-separate" });
                    })
                  }
                >
                  Keep Separate
                </Button>
              ) : null}
            </div>
          </div>
          {!duplicateReview.canKeepSeparate ? (
            <p className="text-xs text-amber-900">
              Only Admin, Manager, or Director can keep likely duplicates as separate leads.
            </p>
          ) : null}
        </div>
      ) : null}

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
        onClick={() => startTransition(async () => submitLead())}
      >
        {initialLead ? "Save Lead" : "Save Inquiry"}
      </Button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
