"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { searchUnscheduledAttendanceMembersAction } from "@/app/lookup-actions";
import type { UnscheduledAttendanceMemberOption } from "@/lib/services/attendance";

function getSelectedOption(options: UnscheduledAttendanceMemberOption[], value: string) {
  return options.find((option) => option.id === value) ?? null;
}

export function UnscheduledAttendanceMemberSearchPicker({
  selectedDate,
  value,
  onChange,
  onSelectOption,
  limit = 25
}: {
  selectedDate: string;
  value: string;
  onChange: (nextValue: string) => void;
  onSelectOption?: (option: UnscheduledAttendanceMemberOption | null) => void;
  limit?: number;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<UnscheduledAttendanceMemberOption[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedOption = useMemo(() => getSelectedOption(options, value), [options, value]);

  const runSearch = (nextQuery: string, selectedId: string | null = value || null) => {
    const trimmedQuery = nextQuery.trim();
    startTransition(async () => {
      try {
        const nextOptions = await searchUnscheduledAttendanceMembersAction({
          selectedDate,
          q: trimmedQuery,
          selectedId,
          limit
        });
        setOptions(nextOptions);
        setStatus(
          trimmedQuery.length >= 2
            ? nextOptions.length === 0
              ? "No unscheduled attendance matches found for that search."
              : `Showing ${nextOptions.length} eligible member${nextOptions.length === 1 ? "" : "s"} for unscheduled attendance.`
            : selectedId
              ? null
              : "Search at least 2 letters to load eligible unscheduled members."
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to load unscheduled attendance matches.");
      }
    });
  };

  useEffect(() => {
    if (!value || selectedOption) return;
    runSearch("", value);
  }, [selectedDate, selectedOption, value]);

  useEffect(() => {
    onSelectOption?.(selectedOption);
  }, [onSelectOption, selectedOption]);

  return (
    <div className="space-y-2">
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Member</span>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input
            className="h-10 w-full rounded-lg border border-border px-3"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search active member name"
          />
          <button
            type="button"
            className="h-10 rounded-lg border border-border px-3 text-sm font-semibold"
            onClick={() => runSearch(query)}
            disabled={isPending}
          >
            {isPending ? "Searching..." : "Search"}
          </button>
          <button
            type="button"
            className="h-10 rounded-lg border border-border px-3 text-sm font-semibold"
            onClick={() => {
              setQuery("");
              setOptions(selectedOption ? [selectedOption] : []);
              setStatus("Search at least 2 letters to load eligible unscheduled members.");
            }}
            disabled={isPending}
          >
            Clear
          </button>
        </div>
      </label>

      <select
        className="h-10 w-full rounded-lg border border-border px-3"
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
            {option.displayName}
            {option.makeupBalance > 0 ? ` (${option.makeupBalance} makeup day${option.makeupBalance === 1 ? "" : "s"})` : ""}
          </option>
        ))}
      </select>

      <p className="text-xs text-muted">{status ?? "Search at least 2 letters to load eligible unscheduled members."}</p>
    </div>
  );
}
