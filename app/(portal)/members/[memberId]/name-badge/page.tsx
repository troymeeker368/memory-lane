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
      : `/operations/member-command-center/${memberId}?tab=member-summary`;

  const badge = await getMemberNameBadgeDetail(memberId);
  if (!badge) notFound();

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
      <NameBadgeBuilder memberId={memberId} badge={badge} />
    </div>
  );
}


