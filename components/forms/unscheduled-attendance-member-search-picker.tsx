"use client";

import { searchUnscheduledAttendanceMembersAction } from "@/app/lookup-actions";
import { LiveSearchSelect } from "@/components/forms/live-search-select";
import type { UnscheduledAttendanceMemberOption } from "@/lib/services/attendance";

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
  return (
    <LiveSearchSelect<UnscheduledAttendanceMemberOption>
      label="Member"
      value={value}
      onChange={onChange}
      onSelectOption={onSelectOption}
      searchPlaceholder="Search active member name"
      searchHint="Search at least 2 letters to load eligible unscheduled members."
      noMatchesMessage="No unscheduled attendance matches found for that search."
      search={({ query, selectedId }) =>
        searchUnscheduledAttendanceMembersAction({
          selectedDate,
          q: query,
          selectedId,
          limit
        })
      }
      getOptionId={(option) => option.id}
      getOptionLabel={(option) => option.displayName}
      renderOption={(option, state) => (
        <div className="min-w-0">
          <p className={`truncate font-medium ${state.selected ? "text-brand" : "text-fg"}`}>{option.displayName}</p>
          <p className="text-xs text-muted">
            {option.makeupBalance > 0
              ? `${option.makeupBalance} makeup day${option.makeupBalance === 1 ? "" : "s"} available`
              : "No makeup days available"}
          </p>
        </div>
      )}
    />
  );
}
