"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { loadSalesReferralSourcesForPartnerAction } from "@/app/lookup-actions";
import {
  createCommunityPartnerAction,
  createPartnerActivityAction,
  createReferralSourceAction
} from "@/app/sales-partner-actions";
import { SalesPartnerSearchPicker } from "@/components/forms/sales-partner-search-picker";
import { SalesLeadSearchPicker } from "@/components/forms/sales-lead-search-picker";
import { useConstrainedSelection } from "@/components/forms/use-constrained-selection";
import { usePropSyncedState, usePropSyncedStatus } from "@/components/forms/use-prop-synced-state";
import { Button } from "@/components/ui/button";
import { COMMUNITY_PARTNER_CATEGORY_OPTIONS, LEAD_ACTIVITY_TYPES, LEAD_FOLLOW_UP_TYPES } from "@/lib/canonical";
import { formatPhoneInput } from "@/lib/phone";
import { toEasternDateTimeLocal } from "@/lib/timezone";
type ReferralSourceCategory = (typeof COMMUNITY_PARTNER_CATEGORY_OPTIONS)[number];

type PartnerLookup = {
  id: string;
  partner_id: string;
  organization_name: string;
};

type ReferralSourceLookup = {
  id: string;
  partner_id: string;
  contact_name: string;
  organization_name: string;
};

export function SalesPartnerActivityForm({
  partners,
  referralSources,
  initialPartnerId,
  initialReferralSourceId,
  initialLeadId
}: {
  partners: PartnerLookup[];
  referralSources: ReferralSourceLookup[];
  initialPartnerId?: string;
  initialReferralSourceId?: string;
  initialLeadId?: string;
}) {
  const now = useMemo(() => toEasternDateTimeLocal(), []);
  const [isPending, startTransition] = useTransition();
  const [isReferralLookupPending, startReferralLookupTransition] = useTransition();
  const [status, setStatus] = usePropSyncedStatus([initialLeadId, initialPartnerId, initialReferralSourceId], "");
  const [createdPartners, setCreatedPartners] = useState<PartnerLookup[]>([]);
  const [createdReferralSources, setCreatedReferralSources] = useState<ReferralSourceLookup[]>([]);
  const [loadedReferralSources, setLoadedReferralSources] = useState<ReferralSourceLookup[]>(referralSources);
  const initialSelectedPartner = useMemo(
    () => [...createdPartners, ...partners].find((partner) => partner.id === initialPartnerId || partner.partner_id === initialPartnerId) ?? null,
    [createdPartners, initialPartnerId, partners]
  );
  const [selectedPartner, setSelectedPartner] = usePropSyncedState<PartnerLookup | null>(
    () => initialSelectedPartner,
    [initialSelectedPartner?.id ?? "", initialLeadId, initialPartnerId, initialReferralSourceId]
  );
  const referralOptions = useMemo(
    () =>
      [...loadedReferralSources, ...createdReferralSources].filter(
        (source, index, all) => all.findIndex((candidate) => candidate.id === source.id) === index
      ),
    [createdReferralSources, loadedReferralSources]
  );
  const [form, setForm] = usePropSyncedState(
    () => ({
      partnerId: initialSelectedPartner?.id ?? initialPartnerId ?? "",
      referralSourceId: initialReferralSourceId ?? "",
      leadId: initialLeadId ?? "",
      activityAt: now,
      activityType: "Email" as (typeof LEAD_ACTIVITY_TYPES)[number],
      nextFollowUpDate: "",
      nextFollowUpType: "Call" as (typeof LEAD_FOLLOW_UP_TYPES)[number],
      notes: ""
    }),
    [initialLeadId, initialPartnerId, initialReferralSourceId, initialSelectedPartner?.id ?? "", now]
  );

  const [showCreateOrgInline, setShowCreateOrgInline] = useState(false);
  const [orgForm, setOrgForm] = useState<{
    organizationName: string;
    referralSourceCategory: ReferralSourceCategory;
    location: string;
    primaryPhone: string;
    primaryEmail: string;
  }>({
    organizationName: "",
    referralSourceCategory: COMMUNITY_PARTNER_CATEGORY_OPTIONS[0],
    location: "",
    primaryPhone: "",
    primaryEmail: ""
  });

  const [showCreateReferralInline, setShowCreateReferralInline] = useState(false);
  const [newReferralName, setNewReferralName] = useState("");
  const filteredReferralSources = selectedPartner
    ? referralOptions.filter((source) => source.partner_id === selectedPartner.partner_id)
    : [];

  const selectedReferral = filteredReferralSources.find((source) => source.id === form.referralSourceId) ?? null;

  useEffect(() => {
    setLoadedReferralSources(referralSources);
  }, [referralSources]);

  useEffect(() => {
    if (!selectedPartner?.id) return;
    if (loadedReferralSources.length > 0) return;
    loadReferralSourcesForPartner(selectedPartner.id, form.referralSourceId || null);
  }, [form.referralSourceId, loadedReferralSources.length, selectedPartner?.id]);

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

  useConstrainedSelection({
    selectedId: form.referralSourceId,
    setSelectedId: (nextReferralId) => setForm((current) => ({ ...current, referralSourceId: nextReferralId })),
    options: filteredReferralSources,
    autoSelectSingle: Boolean(form.partnerId)
  });

  return (
    <div className="space-y-3">
      <div>
        <SalesPartnerSearchPicker
          value={form.partnerId}
          initialOptions={partners}
          extraOptions={createdPartners}
          label="Organization (Required)"
          emptyLabel="Select Community Partner Organization"
          onChange={(nextPartnerId) => {
            setForm((current) => ({
              ...current,
              partnerId: nextPartnerId,
              referralSourceId: ""
            }));
            if (!nextPartnerId) {
              setSelectedPartner(null);
              setLoadedReferralSources([]);
              return;
            }
            loadReferralSourcesForPartner(nextPartnerId);
          }}
          onSelectOption={(option) => {
            setSelectedPartner(
              option
                ? {
                    id: option.id,
                    partner_id: option.partner_id,
                    organization_name: option.organization_name
                  }
                : null
            );
          }}
        />
        <button type="button" className="mt-2 text-xs font-semibold text-brand" onClick={() => setShowCreateOrgInline((current) => !current)}>
          {showCreateOrgInline ? "Hide inline organization create" : "Add organization inline"}
        </button>
      </div>

      {showCreateOrgInline ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Create Organization Inline</p>
          <div className="grid gap-3 md:grid-cols-2">
            <input className="h-11 rounded-lg border border-border px-3" placeholder="Organization Name" value={orgForm.organizationName} onChange={(event) => setOrgForm((current) => ({ ...current, organizationName: event.target.value }))} />
            <select
              className="h-11 rounded-lg border border-border px-3"
              value={orgForm.referralSourceCategory}
              onChange={(event) =>
                setOrgForm((current) => ({ ...current, referralSourceCategory: event.target.value as ReferralSourceCategory }))
              }
            >
              {COMMUNITY_PARTNER_CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <input className="h-11 rounded-lg border border-border px-3" placeholder="Location" value={orgForm.location} onChange={(event) => setOrgForm((current) => ({ ...current, location: event.target.value }))} />
            <input className="h-11 rounded-lg border border-border px-3" placeholder="Primary Phone" value={orgForm.primaryPhone} onChange={(event) => setOrgForm((current) => ({ ...current, primaryPhone: formatPhoneInput(event.target.value) }))} />
            <input className="h-11 rounded-lg border border-border px-3" placeholder="Primary Email" value={orgForm.primaryEmail} onChange={(event) => setOrgForm((current) => ({ ...current, primaryEmail: event.target.value }))} />
          </div>
          <Button
            type="button"
            disabled={isPending || !orgForm.organizationName.trim()}
            onClick={() =>
              startTransition(async () => {
                const response = await createCommunityPartnerAction({
                  organizationName: orgForm.organizationName,
                  referralSourceCategory: orgForm.referralSourceCategory,
                  location: orgForm.location,
                  primaryPhone: orgForm.primaryPhone,
                  secondaryPhone: "",
                  primaryEmail: orgForm.primaryEmail,
                  contactName: "",
                  notes: "Created inline from Partner Activity form",
                  active: true
                });

                if (response.error || !response.partner) {
                  setStatus(`Error: ${response.error ?? "Failed to create organization."}`);
                  return;
                }

                setCreatedPartners((current) => [...current, response.partner]);
                setSelectedPartner(response.partner);
                setLoadedReferralSources([]);
                setForm((current) => ({ ...current, partnerId: response.partner.id }));
                setShowCreateOrgInline(false);
                setStatus(`Organization created and selected: ${response.partner.organization_name}`);
              })
            }
          >
            Create Organization
          </Button>
        </div>
      ) : null}

      {selectedPartner ? (
        <>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Referral Source / Contact (Required)</label>
            <select
              className="h-11 w-full rounded-lg border border-border px-3"
              value={form.referralSourceId}
              onChange={(event) => setForm((current) => ({ ...current, referralSourceId: event.target.value }))}
            >
              <option value="">Select Referral Source</option>
              {filteredReferralSources.map((source) => <option key={source.id} value={source.id}>{source.contact_name}</option>)}
            </select>
            {isReferralLookupPending ? (
              <p className="mt-1 text-xs text-muted">Loading referral source contacts...</p>
            ) : null}
            <button type="button" className="mt-2 text-xs font-semibold text-brand" onClick={() => setShowCreateReferralInline((current) => !current)}>
              {showCreateReferralInline ? "Hide inline referral source create" : "Add referral source inline"}
            </button>
          </div>

          {showCreateReferralInline ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Create Referral Source Inline</p>
              <input className="h-11 w-full rounded-lg border border-border px-3" placeholder="Contact Name" value={newReferralName} onChange={(event) => setNewReferralName(event.target.value)} />
              <Button
                type="button"
                disabled={isPending || !form.partnerId || !newReferralName.trim()}
                onClick={() =>
                  startTransition(async () => {
                    const response = await createReferralSourceAction({
                      partnerId: form.partnerId,
                      contactName: newReferralName,
                      jobTitle: "",
                      primaryPhone: "",
                      secondaryPhone: "",
                      primaryEmail: "",
                      preferredContactMethod: "",
                      notes: "Created inline from Partner Activity form",
                      active: true
                    });

                    if (response.error || !response.source) {
                      setStatus(`Error: ${response.error ?? "Failed to create referral source."}`);
                      return;
                    }

                    setCreatedReferralSources((current) => [...current, response.source]);
                    setForm((current) => ({ ...current, referralSourceId: response.source.id }));
                    setNewReferralName("");
                    setShowCreateReferralInline(false);
                    setStatus(`Referral source created and selected: ${response.source.contact_name}`);
                  })
                }
              >
                Create Referral Source
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted">Select organization first to load referral source contacts.</div>
      )}

      {selectedPartner && selectedReferral ? (
        <>
          <div className="rounded-lg border border-border bg-slate-50 px-3 py-2 text-xs text-muted">
            Snapshots will save automatically: <span className="font-semibold text-brand">{selectedPartner.organization_name}</span> / <span className="font-semibold text-brand">{selectedReferral.contact_name}</span>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <SalesLeadSearchPicker
              value={form.leadId}
              onChange={(nextValue) => setForm((current) => ({ ...current, leadId: nextValue }))}
              label="Linked Lead"
            />
            <input type="datetime-local" className="h-11 rounded-lg border border-border px-3" value={form.activityAt} onChange={(event) => setForm((current) => ({ ...current, activityAt: event.target.value }))} />
            <select className="h-11 rounded-lg border border-border px-3" value={form.activityType} onChange={(event) => setForm((current) => ({ ...current, activityType: event.target.value as (typeof LEAD_ACTIVITY_TYPES)[number] }))}>{LEAD_ACTIVITY_TYPES.map((activityType) => <option key={activityType} value={activityType}>{activityType}</option>)}</select>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <input type="date" className="h-11 rounded-lg border border-border px-3" value={form.nextFollowUpDate} onChange={(event) => setForm((current) => ({ ...current, nextFollowUpDate: event.target.value }))} />
            <select className="h-11 rounded-lg border border-border px-3" value={form.nextFollowUpType} onChange={(event) => setForm((current) => ({ ...current, nextFollowUpType: event.target.value as (typeof LEAD_FOLLOW_UP_TYPES)[number] }))}>{LEAD_FOLLOW_UP_TYPES.map((followupType) => <option key={followupType} value={followupType}>{followupType}</option>)}</select>
          </div>

          <textarea className="min-h-20 w-full rounded-lg border border-border p-3" placeholder="Notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        </>
      ) : null}

      <Button
        type="button"
        disabled={isPending || !form.partnerId || !form.referralSourceId}
        onClick={() =>
          startTransition(async () => {
            const response = await createPartnerActivityAction(form);
            setStatus(response.error ? `Error: ${response.error}` : "Partner activity saved.");
          })
        }
      >
        Save Partner Activity
      </Button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
