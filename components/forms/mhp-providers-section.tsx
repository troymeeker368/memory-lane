"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { searchMhpProviderDirectoryAction } from "@/app/(portal)/health/member-health-profiles/directory-actions";
import {
  addMhpProviderInlineAction as addMhpProviderInlineMutationAction,
  deleteMhpProviderInlineAction as deleteMhpProviderInlineMutationAction,
  updateMhpProviderInlineAction as updateMhpProviderInlineMutationAction
} from "@/app/(portal)/health/member-health-profiles/provider-actions";
import { MhpEditModal } from "@/components/forms/mhp-edit-modal";
import { formatPhoneDisplay, formatPhoneInput } from "@/lib/phone";

type ProviderRow = {
  id: string;
  provider_name: string;
  specialty: string | null;
  practice_name: string | null;
  provider_phone: string | null;
  updated_at: string;
};

type ProviderDirectoryEntry = {
  id: string;
  provider_name: string;
  specialty: string | null;
  specialty_other?: string | null;
  practice_name: string | null;
  provider_phone: string | null;
  updated_at: string;
};

const PROVIDER_SPECIALTY_OPTIONS = [
  "Primary Care",
  "Geriatrics",
  "Neurology",
  "Psychiatry",
  "Cardiology",
  "Endocrinology",
  "Family Medicine",
  "Internal Medicine",
  "Pain Management",
  "Physical Medicine & Rehab",
  "Other"
] as const;

function ProviderTypeahead({
  value,
  onChange,
  onSelect,
  onBlur,
  options,
  placeholder,
  disabled = false
}: {
  value: string;
  onChange: (next: string) => void;
  onSelect: (next: string) => void;
  onBlur?: () => void;
  options: string[];
  placeholder: string;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const filteredOptions = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (query.length < 2) return [];

    const startsWith = options.filter((option) => option.toLowerCase().startsWith(query));
    const includes = options.filter(
      (option) => option.toLowerCase().includes(query) && !option.toLowerCase().startsWith(query)
    );
    return [...startsWith, ...includes].slice(0, 8);
  }, [options, value]);

  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      setIsOpen(false);
      onBlur?.();
    };

    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentMouseDown);
    };
  }, [onBlur]);

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          // Defer close so option click can register before focus leaves input.
          window.setTimeout(() => {
            setIsOpen(false);
            onBlur?.();
          }, 120);
        }}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-border px-3"
        autoComplete="off"
        disabled={disabled}
      />
      {isOpen && filteredOptions.length > 0 ? (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-white shadow-lg">
          {filteredOptions.map((option) => (
            <button
              key={option}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-primary-text hover:bg-brandSoft"
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(option);
                setIsOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildProviderDirectoryByName(entries: ProviderDirectoryEntry[]) {
  const map = new Map<string, ProviderDirectoryEntry>();
  entries.forEach((entry) => {
    const key = entry.provider_name.trim().toLowerCase();
    if (!key || map.has(key)) return;
    map.set(key, entry);
  });
  return map;
}

export function MhpProvidersSection({
  memberId,
  initialRows
}: {
  memberId: string;
  initialRows: ProviderRow[];
}) {
  const [rows, setRows] = useState<ProviderRow[]>(initialRows);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const [providerSuggestions, setProviderSuggestions] = useState<ProviderDirectoryEntry[]>([]);
  const [editProviderSuggestions, setEditProviderSuggestions] = useState<ProviderDirectoryEntry[]>([]);

  const [providerName, setProviderName] = useState("");
  const [providerSpecialty, setProviderSpecialty] = useState<string>("Primary Care");
  const [providerSpecialtyOther, setProviderSpecialtyOther] = useState("");
  const [practiceName, setPracticeName] = useState("");
  const [providerPhone, setProviderPhone] = useState("");
  const [editingRow, setEditingRow] = useState<ProviderRow | null>(null);
  const [editProviderName, setEditProviderName] = useState("");
  const [editProviderSpecialty, setEditProviderSpecialty] = useState<string>("Primary Care");
  const [editProviderSpecialtyOther, setEditProviderSpecialtyOther] = useState("");
  const [editPracticeName, setEditPracticeName] = useState("");
  const [editProviderPhone, setEditProviderPhone] = useState("");

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const aAt = Date.parse(a.updated_at);
        const bAt = Date.parse(b.updated_at);
        return bAt - aAt;
      }),
    [rows]
  );

  const normalizeProviderName = (value: string) => value.trim().toLowerCase();

  useEffect(() => {
    let isCancelled = false;
    const query = providerName.trim();

    if (query.length < 2) {
      setProviderSuggestions([]);
      return () => {
        isCancelled = true;
      };
    }

    void (async () => {
      try {
        const nextMatches = await searchMhpProviderDirectoryAction({ q: query, limit: 8 });
        if (isCancelled) return;
        setProviderSuggestions(nextMatches as ProviderDirectoryEntry[]);
      } catch {
        if (isCancelled) return;
        setProviderSuggestions([]);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [providerName]);

  useEffect(() => {
    let isCancelled = false;
    const query = editProviderName.trim();

    if (query.length < 2) {
      setEditProviderSuggestions([]);
      return () => {
        isCancelled = true;
      };
    }

    void (async () => {
      try {
        const nextMatches = await searchMhpProviderDirectoryAction({ q: query, limit: 8 });
        if (isCancelled) return;
        setEditProviderSuggestions(nextMatches as ProviderDirectoryEntry[]);
      } catch {
        if (isCancelled) return;
        setEditProviderSuggestions([]);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [editProviderName]);

  const directoryByName = useMemo(
    () => buildProviderDirectoryByName(providerSuggestions),
    [providerSuggestions]
  );
  const editDirectoryByName = useMemo(
    () => buildProviderDirectoryByName(editProviderSuggestions),
    [editProviderSuggestions]
  );

  const directoryNameOptions = useMemo(
    () =>
      Array.from(directoryByName.values())
        .map((entry) => entry.provider_name)
        .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })),
    [directoryByName]
  );

  const editDirectoryNameOptions = useMemo(
    () =>
      Array.from(editDirectoryByName.values())
        .map((entry) => entry.provider_name)
        .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })),
    [editDirectoryByName]
  );

  const applyProviderDefaults = (providerNameValue: string, mode: "add" | "edit") => {
    const matched =
      mode === "add"
        ? directoryByName.get(normalizeProviderName(providerNameValue))
        : editDirectoryByName.get(normalizeProviderName(providerNameValue));
    if (!matched) return;

    const specialty = matched.specialty ?? "";
    const knownSpecialty = PROVIDER_SPECIALTY_OPTIONS.includes(specialty as (typeof PROVIDER_SPECIALTY_OPTIONS)[number]);
    const specialtySelectValue = knownSpecialty ? specialty : specialty ? "Other" : "Primary Care";
    const specialtyOtherValue = knownSpecialty ? "" : specialty;

    if (mode === "add") {
      setProviderSpecialty(specialtySelectValue);
      setProviderSpecialtyOther(specialtyOtherValue);
      setPracticeName(matched.practice_name ?? "");
      setProviderPhone(formatPhoneInput(matched.provider_phone));
      return;
    }

    setEditProviderSpecialty(specialtySelectValue);
    setEditProviderSpecialtyOther(specialtyOtherValue);
    setEditPracticeName(matched.practice_name ?? "");
    setEditProviderPhone(formatPhoneInput(matched.provider_phone));
  };

  const applyDefaultsIfExactMatch = (providerNameValue: string, mode: "add" | "edit") => {
    const normalized = normalizeProviderName(providerNameValue);
    const directoryMap = mode === "add" ? directoryByName : editDirectoryByName;
    if (!normalized || !directoryMap.has(normalized)) return;
    applyProviderDefaults(providerNameValue, mode);
  };

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("providerName", providerName);
      formData.set("providerSpecialty", providerSpecialty);
      formData.set("providerSpecialtyOther", providerSpecialtyOther);
      formData.set("practiceName", practiceName);
      formData.set("providerPhone", providerPhone);

      const result = await addMhpProviderInlineMutationAction(formData);
      if (!result.ok || !result.row) {
        setStatus(result.error ?? "Unable to add provider.");
        return;
      }

      setRows((current) => [result.row as ProviderRow, ...current]);
      setProviderName("");
      setProviderSpecialty("Primary Care");
      setProviderSpecialtyOther("");
      setPracticeName("");
      setProviderPhone("");
      setStatus("Provider added.");
    });
  };

  const handleDelete = (providerId: string) => {
    if (!window.confirm("Delete this provider?")) return;
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("providerId", providerId);

      const result = await deleteMhpProviderInlineMutationAction(formData);
      if (!result.ok) {
        setStatus(result.error ?? "Unable to delete provider.");
        return;
      }

      setRows((current) => current.filter((row) => row.id !== providerId));
      setStatus("Provider deleted.");
    });
  };

  const openEdit = (row: ProviderRow) => {
      setEditingRow(row);
      setEditProviderName(row.provider_name);
    const specialty = row.specialty ?? "";
    const known = PROVIDER_SPECIALTY_OPTIONS.includes(specialty as (typeof PROVIDER_SPECIALTY_OPTIONS)[number]);
    setEditProviderSpecialty(known ? specialty : "Other");
    setEditProviderSpecialtyOther(known ? "" : specialty);
    setEditPracticeName(row.practice_name ?? "");
    setEditProviderPhone(formatPhoneInput(row.provider_phone));
  };

  const handleEditSave = () => {
    if (!editingRow) return;
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("providerId", editingRow.id);
      formData.set("providerName", editProviderName);
      formData.set("providerSpecialty", editProviderSpecialty);
      formData.set("providerSpecialtyOther", editProviderSpecialtyOther);
      formData.set("practiceName", editPracticeName);
      formData.set("providerPhone", editProviderPhone);

      const result = await updateMhpProviderInlineMutationAction(formData);
      if (!result.ok || !result.row) {
        setStatus(result.error ?? "Unable to update provider.");
        return;
      }

      setRows((current) => current.map((row) => (row.id === editingRow.id ? (result.row as ProviderRow) : row)));
      setEditingRow(null);
      setStatus("Provider updated.");
    });
  };

  return (
    <>
      <table className="mt-3">
        <thead>
          <tr>
            <th>Name</th>
            <th>Specialty</th>
            <th>Practice</th>
            <th>Phone</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {sortedRows.slice(0, 25).map((row) => (
            <tr key={row.id}>
              <td>{row.provider_name}</td>
              <td>{row.specialty ?? "-"}</td>
              <td>{row.practice_name ?? "-"}</td>
              <td>{formatPhoneDisplay(row.provider_phone)}</td>
              <td>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs"
                    onClick={() => openEdit(row)}
                    disabled={isPending}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs"
                    onClick={() => handleDelete(row.id)}
                    disabled={isPending}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={handleAdd} className="mt-3 grid gap-2 md:grid-cols-6">
        <ProviderTypeahead
          value={providerName}
          onChange={(next) => {
            setProviderName(next);
            applyDefaultsIfExactMatch(next, "add");
          }}
          onSelect={(next) => {
            setProviderName(next);
            applyProviderDefaults(next, "add");
          }}
          onBlur={() => applyDefaultsIfExactMatch(providerName, "add")}
          options={directoryNameOptions}
          placeholder="Provider name (type 2+ chars)"
          disabled={isPending}
        />
        <select
          value={providerSpecialty}
          onChange={(event) => setProviderSpecialty(event.target.value)}
          className="h-10 rounded-lg border border-border px-3"
        >
          {PROVIDER_SPECIALTY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {providerSpecialty === "Other" ? (
          <input
            value={providerSpecialtyOther}
            onChange={(event) => setProviderSpecialtyOther(event.target.value)}
            placeholder="Specialty (Other)"
            className="h-10 rounded-lg border border-border px-3"
          />
        ) : (
          <div />
        )}
        <input
          value={practiceName}
          onChange={(event) => setPracticeName(event.target.value)}
          placeholder="Practice"
          className="h-10 rounded-lg border border-border px-3"
        />
        <input
          value={providerPhone}
          onChange={(event) => setProviderPhone(formatPhoneInput(event.target.value))}
          placeholder="Phone"
          className="h-10 rounded-lg border border-border px-3"
        />
        <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white" disabled={isPending}>
          {isPending ? "Saving..." : "Add Provider"}
        </button>
      </form>
      {status ? <p className="mt-2 text-xs text-muted">{status}</p> : null}
      <MhpEditModal open={Boolean(editingRow)} title="Edit Provider" onClose={() => setEditingRow(null)}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Provider Name</span>
            <ProviderTypeahead
              value={editProviderName}
              onChange={(next) => {
                setEditProviderName(next);
                applyDefaultsIfExactMatch(next, "edit");
              }}
              onSelect={(next) => {
                setEditProviderName(next);
                applyProviderDefaults(next, "edit");
              }}
              onBlur={() => applyDefaultsIfExactMatch(editProviderName, "edit")}
              options={editDirectoryNameOptions}
              placeholder="Provider name (type 2+ chars)"
              disabled={isPending}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Specialty</span>
            <select value={editProviderSpecialty} onChange={(event) => setEditProviderSpecialty(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3">
              {PROVIDER_SPECIALTY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          {editProviderSpecialty === "Other" ? (
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Specialty (Other)</span>
              <input value={editProviderSpecialtyOther} onChange={(event) => setEditProviderSpecialtyOther(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3" />
            </label>
          ) : null}
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Practice</span>
            <input value={editPracticeName} onChange={(event) => setEditPracticeName(event.target.value)} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Phone</span>
            <input value={editProviderPhone} onChange={(event) => setEditProviderPhone(formatPhoneInput(event.target.value))} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded border border-border px-3 py-2 text-sm" onClick={() => setEditingRow(null)}>
            Cancel
          </button>
          <button type="button" className="rounded bg-brand px-3 py-2 text-sm font-semibold text-white" onClick={handleEditSave} disabled={isPending}>
            Save
          </button>
        </div>
      </MhpEditModal>
    </>
  );
}
