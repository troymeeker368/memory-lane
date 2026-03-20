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
  const { selectedId, setSelectedId, options, autoSelectSingle: autoSelectSingleInput } = input;
  const optionIds = useMemo(() => new Set(options.map((option) => option.id)), [options]);
  const autoSelectSingle = autoSelectSingleInput ?? true;

  useEffect(() => {
    if (!selectedId) return;
    if (optionIds.has(selectedId)) return;
    setSelectedId("");
  }, [selectedId, optionIds, setSelectedId]);

  useEffect(() => {
    if (!autoSelectSingle) return;
    if (selectedId) return;
    if (options.length !== 1) return;
    setSelectedId(options[0].id);
  }, [autoSelectSingle, options, selectedId, setSelectedId]);
}
