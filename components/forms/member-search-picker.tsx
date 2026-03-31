"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import {
  searchCarePlanMembersAction,
  searchDocumentationMembersAction,
  searchHealthMembersAction,
  searchPhysicianOrderMembersAction
} from "@/app/lookup-actions";
import type { MemberLookupRow } from "@/lib/services/shared-lookups-supabase";

type MemberSearchScope = "documentation" | "health" | "care-plan" | "physician-orders";

const SEARCH_ACTIONS = {
  documentation: searchDocumentationMembersAction,
  health: searchHealthMembersAction,
  "care-plan": searchCarePlanMembersAction,
  "physician-orders": searchPhysicianOrderMembersAction
} satisfies Record<MemberSearchScope, (input: { q?: string; selectedId?: string | null; limit?: number }) => Promise<MemberLookupRow[]>>;

function getSelectedOption(options: MemberLookupRow[], value: string) {
  return options.find((option) => option.id === value) ?? null;
}

export function MemberSearchPicker({
  scope,
  value,
  onChange,
  onSelectOption,
  label = "Member",
  searchPlaceholder = "Search member name",
  limit = 25
}: {
  scope: MemberSearchScope;
  value: string;
  onChange: (nextValue: string) => void;
  onSelectOption?: (option: MemberLookupRow | null) => void;
  label?: string;
  searchPlaceholder?: string;
  limit?: number;
}) {
  const searchAction = SEARCH_ACTIONS[scope];
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<MemberLookupRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedOption = useMemo(() => getSelectedOption(options, value), [options, value]);

  const runSearch = (nextQuery: string, selectedId: string | null = value || null) => {
    const trimmedQuery = nextQuery.trim();
    startTransition(async () => {
      try {
        const nextOptions = await searchAction({
          q: trimmedQuery,
          selectedId,
          limit
        });
        setOptions(nextOptions);
        setStatus(
          trimmedQuery.length >= 2
            ? nextOptions.length === 0
              ? "No active members matched that search."
              : `Showing ${nextOptions.length} matching member${nextOptions.length === 1 ? "" : "s"}.`
            : selectedId
              ? null
              : "Search at least 2 letters to load matching active members."
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to load member matches.");
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
        <span className="font-semibold">{label}</span>
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
              setStatus("Search at least 2 letters to load matching active members.");
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
        <option value="">{options.length === 0 ? "Search members to load options" : "Select member"}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.display_name}
          </option>
        ))}
      </select>

      <p className="text-xs text-muted">
        {status ?? "Search at least 2 letters to load matching active members."}
      </p>
    </div>
  );
}
