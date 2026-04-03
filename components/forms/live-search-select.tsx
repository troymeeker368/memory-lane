"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode
} from "react";

type SearchStatus = "idle" | "hint" | "results" | "empty" | "error";

type LiveSearchSelectProps<TOption> = {
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  onSelectOption?: (option: TOption | null) => void;
  searchPlaceholder: string;
  searchHint: string;
  noMatchesMessage: string;
  minQueryLength?: number;
  search: (input: { query: string; selectedId: string | null }) => Promise<TOption[]>;
  getOptionId: (option: TOption) => string;
  getOptionLabel: (option: TOption) => string;
  renderOption?: (option: TOption, state: { active: boolean; selected: boolean }) => ReactNode;
};

export function LiveSearchSelect<TOption>({
  label,
  value,
  onChange,
  onSelectOption,
  searchPlaceholder,
  searchHint,
  noMatchesMessage,
  minQueryLength = 2,
  search,
  getOptionId,
  getOptionLabel,
  renderOption
}: LiveSearchSelectProps<TOption>) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedValueRef = useRef<string>("");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<TOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [statusMessage, setStatusMessage] = useState(searchHint);
  const [statusKind, setStatusKind] = useState<SearchStatus>("hint");
  const [isPending, startTransition] = useTransition();

  const selectedOption = useMemo(
    () => options.find((option) => getOptionId(option) === value) ?? null,
    [getOptionId, options, value]
  );

  const activeDescendant =
    highlightedIndex >= 0 && highlightedIndex < options.length ? `${listboxId}-${getOptionId(options[highlightedIndex])}` : undefined;

  const selectOption = (option: TOption | null) => {
    const nextValue = option ? getOptionId(option) : "";
    committedValueRef.current = nextValue;
    onChange(nextValue);
    onSelectOption?.(option);
    setQuery(option ? getOptionLabel(option) : "");
    setOptions(option ? [option] : []);
    setHighlightedIndex(option ? 0 : -1);
    setIsOpen(false);
    setStatusKind(option ? "results" : "hint");
    setStatusMessage(option ? `${getOptionLabel(option)} selected.` : searchHint);
  };

  const runSearch = (nextQuery: string, selectedId: string | null) => {
    startTransition(async () => {
      try {
        const nextOptions = await search({
          query: nextQuery,
          selectedId
        });
        setOptions(nextOptions);
        setHighlightedIndex(nextOptions.length > 0 ? 0 : -1);

        if (nextQuery.length < minQueryLength) {
          setStatusKind("hint");
          setStatusMessage(searchHint);
          setIsOpen(false);
          return;
        }

        if (nextOptions.length === 0) {
          setStatusKind("empty");
          setStatusMessage(noMatchesMessage);
          setIsOpen(true);
          return;
        }

        setStatusKind("results");
        setStatusMessage(`Showing ${nextOptions.length} match${nextOptions.length === 1 ? "" : "es"}.`);
        setIsOpen(true);
      } catch (error) {
        setOptions([]);
        setHighlightedIndex(-1);
        setStatusKind("error");
        setStatusMessage(error instanceof Error ? error.message : "Unable to load matches.");
        setIsOpen(true);
      }
    });
  };

  useEffect(() => {
    if (!value || selectedOption) return;
    runSearch("", value);
  }, [selectedOption, value]);

  useEffect(() => {
    if (!value && committedValueRef.current) {
      committedValueRef.current = "";
      setQuery("");
      setOptions([]);
      setHighlightedIndex(-1);
      setStatusKind("hint");
      setStatusMessage(searchHint);
      return;
    }

    if (!selectedOption) return;

    const selectedId = getOptionId(selectedOption);
    if (committedValueRef.current === selectedId) return;
    committedValueRef.current = selectedId;
    setQuery(getOptionLabel(selectedOption));
  }, [getOptionId, getOptionLabel, searchHint, selectedOption, value]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmedQuery = query.trim();
    const selectedId = value || null;

    if (trimmedQuery.length < minQueryLength) {
      if (trimmedQuery.length === 0 && !selectedId) {
        setOptions([]);
        setHighlightedIndex(-1);
        setStatusKind("hint");
        setStatusMessage(searchHint);
      }
      return;
    }

    debounceRef.current = setTimeout(() => {
      runSearch(trimmedQuery, selectedId);
    }, 220);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [minQueryLength, query, searchHint, value]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(event.target as Node)) return;
      setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const handleInputChange = (nextValue: string) => {
    setQuery(nextValue);
    setIsOpen(nextValue.trim().length >= minQueryLength);
    if (value) {
      onChange("");
      onSelectOption?.(null);
    }
    if (nextValue.trim().length === 0) {
      committedValueRef.current = "";
      setOptions([]);
      setHighlightedIndex(-1);
      setStatusKind("hint");
      setStatusMessage(searchHint);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen && options.length > 0) {
        setIsOpen(true);
        setHighlightedIndex(0);
        return;
      }
      setHighlightedIndex((current) => {
        if (options.length === 0) return -1;
        const nextIndex = current < options.length - 1 ? current + 1 : 0;
        return nextIndex;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen && options.length > 0) {
        setIsOpen(true);
        setHighlightedIndex(options.length - 1);
        return;
      }
      setHighlightedIndex((current) => {
        if (options.length === 0) return -1;
        if (current <= 0) return options.length - 1;
        return current - 1;
      });
      return;
    }

    if (event.key === "Enter" && isOpen && highlightedIndex >= 0 && highlightedIndex < options.length) {
      event.preventDefault();
      selectOption(options[highlightedIndex]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-semibold">
        {label}
      </label>
      <div ref={wrapperRef} className="relative">
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-activedescendant={activeDescendant}
            className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/40"
            value={query}
            onChange={(event) => handleInputChange(event.target.value)}
            onFocus={() => {
              if (options.length > 0 || query.trim().length >= minQueryLength || statusKind === "empty" || statusKind === "error") {
                setIsOpen(true);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => selectOption(null)}
            className="h-11 rounded-lg border border-border px-3 text-sm font-semibold text-brand disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isPending && !value && query.trim().length === 0}
          >
            Clear
          </button>
        </div>

        {isOpen ? (
          <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-xl border border-border bg-white shadow-lg">
            {options.length > 0 ? (
              <ul id={listboxId} role="listbox" className="max-h-72 overflow-y-auto py-1">
                {options.map((option, index) => {
                  const optionId = getOptionId(option);
                  const selected = optionId === value;
                  const active = index === highlightedIndex;

                  return (
                    <li
                      key={optionId}
                      id={`${listboxId}-${optionId}`}
                      role="option"
                      aria-selected={selected}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectOption(option);
                      }}
                      className={[
                        "cursor-pointer px-3 py-2 text-sm",
                        active ? "bg-brand/10" : "bg-white",
                        selected ? "text-brand" : "text-fg"
                      ].join(" ")}
                    >
                      {renderOption ? renderOption(option, { active, selected }) : getOptionLabel(option)}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-3 py-3 text-sm text-muted">{statusMessage}</div>
            )}
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted" aria-live="polite">
        {isPending ? "Searching…" : statusMessage}
      </p>
    </div>
  );
}
