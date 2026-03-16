import type { getDirectorTimecardsWorkspace } from "@/lib/services/director-timecards";

export type DirectorTimecardsWorkspace = Awaited<ReturnType<typeof getDirectorTimecardsWorkspace>>;

export type DirectorTabKey = "pending" | "daily" | "forgotten" | "pto" | "summary" | "export";

export function statusBadge(status: string) {
  if (status === "approved") return "rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700";
  if (status === "needs_review") return "rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700";
  if (status === "corrected") return "rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700";
  return "rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700";
}
