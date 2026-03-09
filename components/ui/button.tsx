import type React from "react";

import { cn } from "@/lib/utils";

export function Button({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex h-11 items-center justify-center rounded-lg border border-transparent px-4 text-sm font-semibold transition",
        "bg-brand text-white hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
