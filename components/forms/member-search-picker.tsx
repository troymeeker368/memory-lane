"use client";

import {
  searchAncillaryMembersAction,
  searchCarePlanMembersAction,
  searchDocumentationMembersAction,
  searchHealthMembersAction,
  searchReportMembersAction,
  searchPhysicianOrderMembersAction
} from "@/app/lookup-actions";
import { LiveSearchSelect } from "@/components/forms/live-search-select";
import type { MemberLookupRow } from "@/lib/services/shared-lookups-supabase";

type MemberSearchScope = "documentation" | "health" | "care-plan" | "physician-orders" | "ancillary" | "reports";

const SEARCH_ACTIONS = {
  ancillary: searchAncillaryMembersAction,
  documentation: searchDocumentationMembersAction,
  health: searchHealthMembersAction,
  reports: searchReportMembersAction,
  "care-plan": searchCarePlanMembersAction,
  "physician-orders": searchPhysicianOrderMembersAction
} satisfies Record<MemberSearchScope, (input: { q?: string; selectedId?: string | null; limit?: number }) => Promise<MemberLookupRow[]>>;

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

  return (
    <LiveSearchSelect<MemberLookupRow>
      label={label}
      value={value}
      onChange={onChange}
      onSelectOption={onSelectOption}
      searchPlaceholder={searchPlaceholder}
      searchHint="Search at least 2 letters to load matching active members."
      noMatchesMessage="No active members matched that search."
      search={({ query, selectedId }) =>
        searchAction({
          q: query,
          selectedId,
          limit
        })
      }
      getOptionId={(option) => option.id}
      getOptionLabel={(option) => option.display_name}
      renderOption={(option, state) => (
        <div className="min-w-0">
          <p className={`truncate font-medium ${state.selected ? "text-brand" : "text-fg"}`}>{option.display_name}</p>
          {option.enrollment_date ? <p className="text-xs text-muted">Enrolled {option.enrollment_date}</p> : null}
        </div>
      )}
    />
  );
}
