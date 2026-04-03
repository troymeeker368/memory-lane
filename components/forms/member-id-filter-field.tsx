"use client";

import { useState } from "react";

import { MemberSearchPicker } from "@/components/forms/member-search-picker";

type MemberSearchScope = "documentation" | "health" | "care-plan" | "physician-orders" | "ancillary" | "reports";

export function MemberIdFilterField({
  name,
  scope,
  defaultValue,
  label = "Member",
  searchPlaceholder = "Search member name",
  helperText = "Clear the field to search across all members.",
  className
}: {
  name: string;
  scope: MemberSearchScope;
  defaultValue?: string;
  label?: string;
  searchPlaceholder?: string;
  helperText?: string;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");

  return (
    <div className={className ?? "space-y-1"}>
      <input type="hidden" name={name} value={value} />
      <MemberSearchPicker
        scope={scope}
        value={value}
        onChange={setValue}
        label={label}
        searchPlaceholder={searchPlaceholder}
      />
      <p className="text-xs text-muted">{helperText}</p>
    </div>
  );
}
