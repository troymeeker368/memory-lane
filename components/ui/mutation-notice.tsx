"use client";

export function MutationNotice({
  kind,
  message,
  className = ""
}: {
  kind: "success" | "error";
  message: string | null | undefined;
  className?: string;
}) {
  if (!message) return null;

  const toneClass =
    kind === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-red-200 bg-red-50 text-red-700";

  return <p className={`rounded-lg border px-3 py-2 text-sm ${toneClass} ${className}`.trim()}>{message}</p>;
}
