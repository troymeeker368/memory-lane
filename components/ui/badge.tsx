import type React from "react";

import { cn } from "@/lib/utils";

export function Badge({
  children,
  tone = "default"
}: {
  children: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    default: "bg-brandSoft text-brand",
    success: "bg-emerald-100 text-emerald-700",
    warning: "bg-amber-100 text-amber-700",
    danger: "bg-rose-100 text-rose-700"
  }[tone];

  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", toneClass)}>{children}</span>;
}
