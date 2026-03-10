"use client";

import { useEffect, useMemo } from "react";

export interface SelectionOption {
  id: string;
}

export function useConstrainedSelection<TOption extends SelectionOption>(input: {
  selectedId: string;
  setSelectedId: (next: string) => void;
  options: TOption[];
  autoSelectSingle?: boolean;
}) {
  const optionIds = useMemo(() => new Set(input.options.map((option) => option.id)), [input.options]);
  const autoSelectSingle = input.autoSelectSingle ?? true;

  useEffect(() => {
    if (!input.selectedId) return;
    if (optionIds.has(input.selectedId)) return;
    input.setSelectedId("");
  }, [input.selectedId, optionIds, input.setSelectedId]);

  useEffect(() => {
    if (!autoSelectSingle) return;
    if (input.selectedId) return;
    if (input.options.length !== 1) return;
    input.setSelectedId(input.options[0].id);
  }, [autoSelectSingle, input.options, input.selectedId, input.setSelectedId]);
}
