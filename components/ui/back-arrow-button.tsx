"use client";

import { useRouter } from "next/navigation";

type BackArrowButtonProps = {
  fallbackHref?: string;
  forceFallback?: boolean;
  className?: string;
  ariaLabel?: string;
};

export function BackArrowButton({
  fallbackHref = "/",
  forceFallback = false,
  className,
  ariaLabel = "Go back"
}: BackArrowButtonProps) {
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={() => {
        if (!forceFallback && window.history.length > 1) {
          router.back();
          return;
        }
        router.push(fallbackHref);
      }}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-border text-lg font-semibold text-brand transition hover:bg-brand hover:text-white ${className ?? ""}`}
    >
      <span aria-hidden="true">&larr;</span>
    </button>
  );
}
