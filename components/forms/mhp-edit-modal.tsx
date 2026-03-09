"use client";

import type { ReactNode } from "react";

export function MhpEditModal({
  open,
  title,
  onClose,
  children
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-xl border border-border bg-white p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <button type="button" className="text-sm font-medium text-muted hover:text-foreground" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
