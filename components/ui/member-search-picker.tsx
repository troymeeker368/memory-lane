"use client";

import { useEffect, useState } from "react";

type MemberSearchOption = {
  id: string;
  display_name: string;
};

type MemberSearchPickerProps = {
  value: string;
  onChange: (memberId: string) => void;
  label?: string;
  placeholder?: string;
  status?: "all" | "active" | "inactive";
  minQueryLength?: number;
  limit?: number;
};

export function MemberSearchPicker({
  value,
  onChange,
  label = "Member",
  placeholder = "Search active member name",
  status = "active",
  minQueryLength = 2,
  limit = 25
}: MemberSearchPickerProps) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<MemberSearchOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < minQueryLength) {
      setOptions([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({
          q: normalized,
          status,
          limit: String(limit),
          minQueryLength: String(minQueryLength)
        });
        const response = await fetch(`/api/member-lookup?${params.toString()}`, {
          method: "GET",
          signal: controller.signal,
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error("Unable to load matching members.");
        }
        const payload = (await response.json()) as { rows?: MemberSearchOption[] };
        setOptions(Array.isArray(payload.rows) ? payload.rows : []);
      } catch (fetchError) {
        if (controller.signal.aborted) return;
        setOptions([]);
        setError(fetchError instanceof Error ? fetchError.message : "Unable to load matching members.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [limit, minQueryLength, query, status]);

  const selectedMember = options.find((option) => option.id === value) ?? null;

  return (
    <div className="space-y-2">
      <label className="space-y-1 text-sm">
        <span className="font-semibold">{label}</span>
        <input
          type="text"
          className="h-11 w-full rounded-lg border border-border bg-white px-3"
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="rounded-lg border border-border bg-slate-50 p-3 text-sm">
        {value && selectedMember ? (
          <p className="font-medium text-foreground">Selected: {selectedMember.display_name}</p>
        ) : value ? (
          <p className="font-medium text-foreground">Member selected.</p>
        ) : (
          <p className="text-muted">Search to choose one member.</p>
        )}

        {query.trim().length < minQueryLength ? (
          <p className="mt-1 text-xs text-muted">Type at least {minQueryLength} letters to load a limited member list.</p>
        ) : loading ? (
          <p className="mt-1 text-xs text-muted">Searching members...</p>
        ) : error ? (
          <p className="mt-1 text-xs text-rose-700">{error}</p>
        ) : options.length === 0 ? (
          <p className="mt-1 text-xs text-muted">No matching members found.</p>
        ) : (
          <select
            className="mt-2 h-11 w-full rounded-lg border border-border bg-white px-3"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">Select member</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.display_name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
