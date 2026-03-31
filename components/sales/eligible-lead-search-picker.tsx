"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { searchEnrollmentPacketEligibleLeadsAction } from "@/app/lookup-actions";
import type { SalesEnrollmentPacketEligibleLeadRow } from "@/lib/services/leads-read";

function getSelectedOption(options: SalesEnrollmentPacketEligibleLeadRow[], value: string) {
  return options.find((option) => option.id === value) ?? null;
}

export function EligibleLeadSearchPicker({
  value,
  onChange,
  onSelectOption,
  limit = 25
}: {
  value: string;
  onChange: (nextValue: string) => void;
  onSelectOption?: (option: SalesEnrollmentPacketEligibleLeadRow | null) => void;
  limit?: number;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SalesEnrollmentPacketEligibleLeadRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedOption = useMemo(() => getSelectedOption(options, value), [options, value]);

  const runSearch = (nextQuery: string, selectedId: string | null = value || null) => {
    const trimmedQuery = nextQuery.trim();
    startTransition(async () => {
      try {
        const nextOptions = await searchEnrollmentPacketEligibleLeadsAction({
          q: trimmedQuery,
          selectedId,
          limit
        });
        setOptions(nextOptions);
        setStatus(
          trimmedQuery.length >= 2
            ? nextOptions.length === 0
              ? "No eligible leads matched that search."
              : `Showing ${nextOptions.length} eligible lead${nextOptions.length === 1 ? "" : "s"}.`
            : selectedId
              ? null
              : "Search at least 2 letters to load eligible leads."
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to load eligible leads.");
      }
    });
  };

  useEffect(() => {
    if (!value || selectedOption) return;
    runSearch("", value);
  }, [selectedOption, value]);

  useEffect(() => {
    onSelectOption?.(selectedOption);
  }, [onSelectOption, selectedOption]);

  return (
    <div className="space-y-2">
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Lead</span>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search eligible lead or caregiver"
          />
          <button
            type="button"
            className="h-11 rounded-lg border border-border px-3 text-sm font-semibold"
            onClick={() => runSearch(query)}
            disabled={isPending}
          >
            {isPending ? "Searching..." : "Search"}
          </button>
          <button
            type="button"
            className="h-11 rounded-lg border border-border px-3 text-sm font-semibold"
            onClick={() => {
              setQuery("");
              setOptions(selectedOption ? [selectedOption] : []);
              setStatus("Search at least 2 letters to load eligible leads.");
            }}
            disabled={isPending}
          >
            Clear
          </button>
        </div>
      </label>

      <select
        className="h-11 w-full rounded-lg border border-border px-3"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          const nextOption = getSelectedOption(options, event.target.value);
          onSelectOption?.(nextOption);
        }}
        disabled={isPending}
      >
        <option value="">{options.length === 0 ? "Search leads to load options" : "Select lead"}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.member_name ?? "Unnamed Lead"}
          </option>
        ))}
      </select>

      <p className="text-xs text-muted">{status ?? "Search at least 2 letters to load eligible leads."}</p>
    </div>
  );
}
