import Link from "next/link";
import { notFound } from "next/navigation";

import { NameBadgeBuilder } from "@/components/name-badge/name-badge-builder";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { requireRoles } from "@/lib/auth";
import { getMemberNameBadgeDetail } from "@/lib/services/member-name-badge";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeBadgeLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  if (
    normalized.includes("bad gateway") ||
    normalized.includes("error code 502") ||
    normalized.includes("<!doctype html>")
  ) {
    return "Supabase is temporarily unavailable (502 Bad Gateway). Please wait a minute and reload this badge.";
  }
  return "Unable to load badge details right now. Please refresh and try again.";
}

export default async function MemberNameBadgePage({
  params,
  searchParams
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoles(["admin", "manager", "nurse"]);
  const { memberId } = await params;
  const query = await searchParams;
  const source = firstString(query.from);
  const backHref =
    source === "mhp"
      ? `/health/member-health-profiles/${memberId}`
      : `/operations/member-command-center/${memberId}?tab=overview`;

  let badge: Awaited<ReturnType<typeof getMemberNameBadgeDetail>> = null;
  let loadError = "";
  try {
    badge = await getMemberNameBadgeDetail(memberId);
  } catch (error) {
    loadError = normalizeBadgeLoadError(error);
    console.error("[NameBadge] page load failed", {
      memberId,
      loadError
    });
  }
  if (!loadError && !badge) notFound();
  const resolvedBadge = badge;

  return (
    <div className="name-badge-page space-y-4">
      <div className="print-hide flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BackArrowButton fallbackHref={backHref} forceFallback ariaLabel="Back to member record" />
          <Link href={backHref} className="text-sm font-semibold text-brand">
            Back to Member Record
          </Link>
        </div>
      </div>
      {loadError ? (
        <div className="rounded-lg border border-[#f0b6b6] bg-[#fff6f6] px-4 py-3 text-sm text-[#7f1d1d]">
          {loadError}
        </div>
      ) : resolvedBadge ? (
        <NameBadgeBuilder memberId={memberId} badge={resolvedBadge} />
      ) : null}
    </div>
  );
}


