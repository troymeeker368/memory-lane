import type React from "react";

import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-fg",
        "placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/40",
        className
      )}
      {...props}
    />
  );
}
