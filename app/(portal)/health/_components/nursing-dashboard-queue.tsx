"use client";

import { cn } from "@/lib/utils";

import type { QueueItem, QueueTone } from "@/app/(portal)/health/_components/nursing-dashboard-types";

const toneClassName: Record<QueueTone, string> = {
  default: "border-slate-200 bg-slate-50 text-slate-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700"
};

export function NursingDashboardQueue({
  description,
  emptyMessage,
  items,
  onSelectItem,
  selectedId,
  title
}: {
  description?: string;
  emptyMessage: string;
  items: QueueItem[];
  onSelectItem: (itemId: string) => void;
  selectedId: string | null;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{items.length}</span>
        </div>
      </div>
      <div className="divide-y divide-slate-200">
        {items.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-500">{emptyMessage}</div>
        ) : (
          items.map((item) => {
            const isSelected = selectedId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectItem(item.id)}
                className={cn(
                  "flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-50",
                  isSelected ? "bg-sky-50/70" : "bg-white"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", toneClassName[item.tone])}>
                      {item.statusLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{item.subtitle}</p>
                  {item.meta.length > 0 ? (
                    <p className="mt-1 text-xs text-slate-500">{item.meta.slice(0, 2).join(" | ")}</p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{item.primaryActionLabel}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.dueText ?? "Review details"}</p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
