"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { searchSalesPartnersAction } from "@/app/lookup-actions";
import type { SalesPartnerPickerRow } from "@/lib/services/leads-read";

function getSelectedOption(options: SalesPartnerPickerRow[], value: string) {
  return options.find((option) => option.id === value) ?? null;
}

function mergePartnerOptions(options: SalesPartnerPickerRow[]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (!option.id || seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  });
}

export function SalesPartnerSearchPicker({
  value,
  onChange,
  onSelectOption,
  label = "Community Partner Organization",
  searchPlaceholder = "Search organization, category, location",
  limit = 25,
  initialOptions = [],
  extraOptions = [],
  emptyOptionLabel = "No linked Community Partner",
  emptyLabel
}: {
  value: string;
  onChange: (nextValue: string) => void;
  onSelectOption?: (option: SalesPartnerPickerRow | null) => void;
  label?: string;
  searchPlaceholder?: string;
  limit?: number;
  initialOptions?: SalesPartnerPickerRow[];
  extraOptions?: SalesPartnerPickerRow[];
  emptyOptionLabel?: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const resolvedEmptyOptionLabel = emptyLabel ?? emptyOptionLabel;
  const [options, setOptions] = useState<SalesPartnerPickerRow[]>(() => mergePartnerOptions([...initialOptions, ...extraOptions]));
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedOption = useMemo(() => getSelectedOption(options, value), [options, value]);

  const runSearch = (nextQuery: string, selectedId: string | null = value || null) => {
    const trimmedQuery = nextQuery.trim();
    startTransition(async () => {
      try {
        const nextOptions = await searchSalesPartnersAction({
          q: trimmedQuery,
          selectedId,
          limit
        });
        setOptions(mergePartnerOptions(nextOptions));
        setStatus(
          trimmedQuery.length >= 2
            ? nextOptions.length === 0
              ? "No organizations matched that search."
              : `Showing ${nextOptions.length} matching organization${nextOptions.length === 1 ? "" : "s"}.`
            : selectedId
              ? null
              : "Search at least 2 letters to load matching organizations."
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to load organizations.");
      }
    });
  };

  useEffect(() => {
    setOptions((current) => mergePartnerOptions([...initialOptions, ...extraOptions, ...current]));
  }, [extraOptions, initialOptions]);

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
        <span className="text-xs font-semibold text-muted">{label}</span>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
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
              setStatus("Search at least 2 letters to load matching organizations.");
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
          onSelectOption?.(getSelectedOption(options, event.target.value));
        }}
        disabled={isPending}
      >
        <option value="">{options.length === 0 ? "Search organizations to load options" : resolvedEmptyOptionLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.organization_name}
          </option>
        ))}
      </select>

      <p className="text-xs text-muted">{status ?? "Search at least 2 letters to load matching organizations."}</p>
    </div>
  );
}
