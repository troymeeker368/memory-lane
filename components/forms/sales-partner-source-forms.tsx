"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { createCommunityPartnerAction, createReferralSourceAction } from "@/app/sales-actions";
import { useConstrainedSelection } from "@/components/forms/use-constrained-selection";
import { Button } from "@/components/ui/button";
import { COMMUNITY_PARTNER_CATEGORY_OPTIONS } from "@/lib/canonical";
import { formatPhoneInput } from "@/lib/phone";
type ReferralSourceCategory = (typeof COMMUNITY_PARTNER_CATEGORY_OPTIONS)[number];

type PartnerLookup = {
  id: string;
  partner_id?: string;
  organization_name: string;
};

export function NewCommunityPartnerForm() {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState<{
    organizationName: string;
    referralSourceCategory: ReferralSourceCategory;
    location: string;
    primaryPhone: string;
    secondaryPhone: string;
    primaryEmail: string;
    contactName: string;
    notes: string;
    active: boolean;
  }>({
    organizationName: "",
    referralSourceCategory: COMMUNITY_PARTNER_CATEGORY_OPTIONS[0],
    location: "",
    primaryPhone: "",
    secondaryPhone: "",
    primaryEmail: "",
    contactName: "",
    notes: "",
    active: true
  });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <input className="h-11 rounded-lg border border-border px-3" placeholder="Organization Name" value={form.organizationName} onChange={(event) => setForm((current) => ({ ...current, organizationName: event.target.value }))} />
        <select
          className="h-11 rounded-lg border border-border px-3"
          value={form.referralSourceCategory}
          onChange={(event) => setForm((current) => ({ ...current, referralSourceCategory: event.target.value as ReferralSourceCategory }))}
        >
          {COMMUNITY_PARTNER_CATEGORY_OPTIONS.map((category) => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <input className="h-11 rounded-lg border border-border px-3" placeholder="Location" value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} />
        <input className="h-11 rounded-lg border border-border px-3" placeholder="Primary Phone" value={form.primaryPhone} onChange={(event) => setForm((current) => ({ ...current, primaryPhone: formatPhoneInput(event.target.value) }))} />
        <input className="h-11 rounded-lg border border-border px-3" placeholder="Primary Email" value={form.primaryEmail} onChange={(event) => setForm((current) => ({ ...current, primaryEmail: event.target.value }))} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <input className="h-11 rounded-lg border border-border px-3" placeholder="Secondary Phone" value={form.secondaryPhone} onChange={(event) => setForm((current) => ({ ...current, secondaryPhone: formatPhoneInput(event.target.value) }))} />
        <input className="h-11 rounded-lg border border-border px-3" placeholder="Primary Contact Name" value={form.contactName} onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))} />
      </div>

      <textarea className="min-h-20 w-full rounded-lg border border-border p-3" placeholder="Notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />Active</label>

      <Button
        type="button"
        disabled={isPending || !form.organizationName.trim()}
        onClick={() =>
          startTransition(async () => {
            const response = await createCommunityPartnerAction(form);
            setStatus(response.error ? `Error: ${response.error}` : "Community partner saved.");
          })
        }
      >
        Save Community Partner
      </Button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

export function NewReferralSourceForm({ partners }: { partners: PartnerLookup[] }) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const [partnerOptions, setPartnerOptions] = useState(() =>
    [...partners].sort((a, b) => a.organization_name.localeCompare(b.organization_name))
  );

  const [form, setForm] = useState({
    partnerId: "",
    contactName: "",
    jobTitle: "",
    primaryPhone: "",
    secondaryPhone: "",
    primaryEmail: "",
    preferredContactMethod: "",
    notes: "",
    active: true
  });

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

  const selectedPartner = useMemo(
    () => partnerOptions.find((partner) => partner.id === form.partnerId) ?? null,
    [partnerOptions, form.partnerId]
  );

  useEffect(() => {
    setPartnerOptions([...partners].sort((a, b) => a.organization_name.localeCompare(b.organization_name)));
  }, [partners]);

  useConstrainedSelection({
    selectedId: form.partnerId,
    setSelectedId: (nextPartnerId) => setForm((current) => ({ ...current, partnerId: nextPartnerId })),
    options: partnerOptions,
    autoSelectSingle: false
  });

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Organization</label>
        <select className="h-11 w-full rounded-lg border border-border px-3" value={form.partnerId} onChange={(event) => setForm((current) => ({ ...current, partnerId: event.target.value }))}>
          <option value="">Select Organization</option>
          {partnerOptions.map((partner) => <option key={partner.id} value={partner.id}>{partner.organization_name}</option>)}
        </select>
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
                  notes: "Created inline from Referral Source form",
                  active: true
                });

                if (response.error || !response.partner) {
                  setStatus(`Error: ${response.error ?? "Failed to create organization."}`);
                  return;
                }

                setPartnerOptions((current) => {
                  const next = [...current, response.partner];
                  next.sort((a, b) => a.organization_name.localeCompare(b.organization_name));
                  return next;
                });
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
          <div className="rounded-lg border border-border bg-slate-50 px-3 py-2 text-xs text-muted">
            Organization Name snapshot will be saved automatically from: <span className="font-semibold text-brand">{selectedPartner.organization_name}</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <input className="h-11 rounded-lg border border-border px-3" placeholder="Contact Name" value={form.contactName} onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))} />
            <input className="h-11 rounded-lg border border-border px-3" placeholder="Job Title" value={form.jobTitle} onChange={(event) => setForm((current) => ({ ...current, jobTitle: event.target.value }))} />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <input className="h-11 rounded-lg border border-border px-3" placeholder="Primary Phone" value={form.primaryPhone} onChange={(event) => setForm((current) => ({ ...current, primaryPhone: formatPhoneInput(event.target.value) }))} />
            <input className="h-11 rounded-lg border border-border px-3" placeholder="Secondary Phone" value={form.secondaryPhone} onChange={(event) => setForm((current) => ({ ...current, secondaryPhone: formatPhoneInput(event.target.value) }))} />
            <input className="h-11 rounded-lg border border-border px-3" placeholder="Primary Email" value={form.primaryEmail} onChange={(event) => setForm((current) => ({ ...current, primaryEmail: event.target.value }))} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <input className="h-11 rounded-lg border border-border px-3" placeholder="Preferred Contact Method" value={form.preferredContactMethod} onChange={(event) => setForm((current) => ({ ...current, preferredContactMethod: event.target.value }))} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />Active</label>
          </div>

          <textarea className="min-h-20 w-full rounded-lg border border-border p-3" placeholder="Notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        </>
      ) : (
        <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted">Select an organization first. Contact fields will appear after organization selection.</div>
      )}

      <Button
        type="button"
        disabled={isPending || !form.partnerId || !form.contactName.trim()}
        onClick={() =>
          startTransition(async () => {
            const response = await createReferralSourceAction(form);
            setStatus(response.error ? `Error: ${response.error}` : "Referral source saved.");
          })
        }
      >
        Save Referral Source
      </Button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
