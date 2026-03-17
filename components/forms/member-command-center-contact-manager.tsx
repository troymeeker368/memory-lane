"use client";

import { useEffect, useMemo, useState } from "react";

import { MEMBER_CONTACT_CATEGORY_OPTIONS } from "@/lib/canonical";
import { formatPhoneDisplay, formatPhoneInput } from "@/lib/phone";
import {
  deleteMemberContactAction,
  upsertMemberContactAction
} from "@/app/(portal)/operations/member-command-center/contact-actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { MutationNotice } from "@/components/ui/mutation-notice";

interface ContactRow {
  id: string;
  contact_name: string;
  relationship_to_member: string | null;
  category: string;
  category_other: string | null;
  email: string | null;
  cellular_number: string | null;
  work_number: string | null;
  home_number: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

function blankForm() {
  return {
    id: "",
    contactName: "",
    relationshipToMember: "",
    category: "Care Provider",
    categoryOther: "",
    email: "",
    cellularNumber: "",
    workNumber: "",
    homeNumber: "",
    streetAddress: "",
    city: "",
    state: "",
    zip: ""
  };
}

function normalizeContactRow(input: unknown): ContactRow | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const id = String(source.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    contact_name: String(source.contact_name ?? source.contactName ?? "").trim(),
    relationship_to_member: (source.relationship_to_member ?? source.relationshipToMember ?? null) as string | null,
    category: String(source.category ?? "Other"),
    category_other: (source.category_other ?? source.categoryOther ?? null) as string | null,
    email: (source.email ?? null) as string | null,
    cellular_number: formatPhoneInput((source.cellular_number ?? source.cellularNumber ?? null) as string | null) || null,
    work_number: formatPhoneInput((source.work_number ?? source.workNumber ?? null) as string | null) || null,
    home_number: formatPhoneInput((source.home_number ?? source.homeNumber ?? null) as string | null) || null,
    street_address: (source.street_address ?? source.streetAddress ?? null) as string | null,
    city: (source.city ?? null) as string | null,
    state: (source.state ?? null) as string | null,
    zip: (source.zip ?? null) as string | null
  };
}

export function MemberCommandCenterContactManager({
  memberId,
  rows,
  canEdit
}: {
  memberId: string;
  rows: ContactRow[];
  canEdit: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm());
  const [showForm, setShowForm] = useState(false);
  const [localRows, setLocalRows] = useState<ContactRow[]>(rows);
  const { isSaving, run } = useScopedMutation();

  const showCustomCategory = useMemo(() => form.category === "Other", [form.category]);

  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

  useEffect(() => {
    setForm(blankForm());
    setShowForm(false);
    setStatus(null);
  }, [memberId]);

  function loadForEdit(row: ContactRow) {
    setStatus(null);
    setShowForm(true);
    setForm({
      id: row.id,
      contactName: row.contact_name,
      relationshipToMember: row.relationship_to_member ?? "",
      category: MEMBER_CONTACT_CATEGORY_OPTIONS.includes(row.category as (typeof MEMBER_CONTACT_CATEGORY_OPTIONS)[number])
        ? row.category
        : "Other",
      categoryOther: row.category === "Other" ? row.category_other ?? "" : row.category_other ?? "",
      email: row.email ?? "",
      cellularNumber: row.cellular_number ?? "",
      workNumber: row.work_number ?? "",
      homeNumber: row.home_number ?? "",
      streetAddress: row.street_address ?? "",
      city: row.city ?? "",
      state: row.state ?? "",
      zip: row.zip ?? ""
    });
  }

  function clearForm() {
    setForm(blankForm());
    setShowForm(false);
  }

  async function submit() {
    if (!form.contactName.trim()) {
      setStatus("Error: Contact name is required.");
      return;
    }
    if (showCustomCategory && !form.categoryOther.trim()) {
      setStatus("Error: Custom category is required when category is Other.");
      return;
    }

    void run(() => upsertMemberContactAction({
        id: form.id || undefined,
        memberId,
        contactName: form.contactName,
        relationshipToMember: form.relationshipToMember,
        category: form.category,
        categoryOther: showCustomCategory ? form.categoryOther : "",
        email: form.email,
        cellularNumber: form.cellularNumber,
        workNumber: form.workNumber,
        homeNumber: form.homeNumber,
        streetAddress: form.streetAddress,
        city: form.city,
        state: form.state,
        zip: form.zip
      }), {
      successMessage: form.id ? "Contact updated." : "Contact added.",
      errorMessage: "Unable to save contact.",
      onSuccess: (result) => {
        const savedRow = normalizeContactRow((result.data as { row?: unknown } | null)?.row);
        if (savedRow) {
          setLocalRows((current) =>
            form.id
              ? current.map((row) => (row.id === savedRow.id ? savedRow : row))
              : [savedRow, ...current.filter((row) => row.id !== savedRow.id)]
          );
        }
        setStatus(form.id ? "Contact updated." : "Contact added.");
        clearForm();
      },
      onError: (result) => {
        setStatus(`Error: ${result.error}`);
      }
    });
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this contact?")) return;
    void run(() => deleteMemberContactAction({ id, memberId }), {
      successMessage: "Contact deleted.",
      errorMessage: "Unable to delete contact.",
      onSuccess: () => {
        setLocalRows((current) => current.filter((row) => row.id !== id));
        setStatus("Contact deleted.");
        if (form.id === id) {
          clearForm();
        }
      },
      onError: (result) => {
        setStatus(`Error: ${result.error}`);
      }
    });
  }

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{form.id ? "Edit Contact" : "Add Contact"}</p>
            <button
              type="button"
              className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white"
              onClick={() => setShowForm((current) => !current)}
            >
              {showForm ? "Hide Contact Form" : "Add Contact"}
            </button>
          </div>
          {showForm || Boolean(form.id) ? (
            <>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <input
              className="h-10 rounded-lg border border-border px-3"
              placeholder="Name"
              value={form.contactName}
              onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))}
            />
            <input
              className="h-10 rounded-lg border border-border px-3"
              placeholder="Relationship"
              value={form.relationshipToMember}
              onChange={(event) => setForm((current) => ({ ...current, relationshipToMember: event.target.value }))}
            />
            <select
              className="h-10 rounded-lg border border-border px-3"
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  category: event.target.value,
                  categoryOther: event.target.value === "Other" ? current.categoryOther : ""
                }))
              }
            >
              {MEMBER_CONTACT_CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            {showCustomCategory ? (
              <input
                className="h-10 rounded-lg border border-border px-3"
                placeholder="Custom category"
                value={form.categoryOther}
                onChange={(event) => setForm((current) => ({ ...current, categoryOther: event.target.value }))}
              />
            ) : null}

            <input
              className="h-10 rounded-lg border border-border px-3"
              placeholder="Email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            />
            <input
              className="h-10 rounded-lg border border-border px-3"
              placeholder="Cell"
              value={form.cellularNumber}
              onChange={(event) => setForm((current) => ({ ...current, cellularNumber: formatPhoneInput(event.target.value) }))}
            />
            <input
              className="h-10 rounded-lg border border-border px-3"
              placeholder="Work"
              value={form.workNumber}
              onChange={(event) => setForm((current) => ({ ...current, workNumber: formatPhoneInput(event.target.value) }))}
            />
            <input
              className="h-10 rounded-lg border border-border px-3"
              placeholder="Home"
              value={form.homeNumber}
              onChange={(event) => setForm((current) => ({ ...current, homeNumber: formatPhoneInput(event.target.value) }))}
            />
            <input
              className="h-10 rounded-lg border border-border px-3 md:col-span-2"
              placeholder="Street address"
              value={form.streetAddress}
              onChange={(event) => setForm((current) => ({ ...current, streetAddress: event.target.value }))}
            />
            <input
              className="h-10 rounded-lg border border-border px-3"
              placeholder="City"
              value={form.city}
              onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}
            />
            <input
              className="h-10 rounded-lg border border-border px-3"
              placeholder="State"
              value={form.state}
              onChange={(event) => setForm((current) => ({ ...current, state: event.target.value }))}
            />
            <input
              className="h-10 rounded-lg border border-border px-3"
              placeholder="ZIP"
              value={form.zip}
              onChange={(event) => setForm((current) => ({ ...current, zip: event.target.value }))}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
              onClick={submit}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : form.id ? "Save Contact" : "Add Contact"}
            </button>
            {form.id ? (
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
                onClick={clearForm}
                disabled={isSaving}
              >
                Cancel Edit
              </button>
            ) : null}
          </div>
          </>
          ) : null}
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Relationship</th>
              <th>Contact</th>
              <th>Address</th>
              {canEdit ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {localRows.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="text-sm text-muted">
                  No contacts yet.
                </td>
              </tr>
            ) : (
              localRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.contact_name}</td>
                  <td>{row.category === "Other" ? row.category_other ?? "Other" : row.category}</td>
                  <td>{row.relationship_to_member ?? "-"}</td>
                  <td>
                    <div className="text-xs leading-relaxed">
                      <p>{row.email ?? "-"}</p>
                      <p>Cell: {formatPhoneDisplay(row.cellular_number)}</p>
                      <p>Work: {formatPhoneDisplay(row.work_number)}</p>
                      <p>Home: {formatPhoneDisplay(row.home_number)}</p>
                    </div>
                  </td>
                  <td>{[row.street_address, row.city, row.state, row.zip].filter(Boolean).join(", ") || "-"}</td>
                  {canEdit ? (
                    <td>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="text-xs font-semibold text-brand"
                          onClick={() => loadForEdit(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-red-700"
                          onClick={() => handleDelete(row.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <MutationNotice kind={status?.startsWith("Error") ? "error" : "success"} message={status} />
    </div>
  );
}
