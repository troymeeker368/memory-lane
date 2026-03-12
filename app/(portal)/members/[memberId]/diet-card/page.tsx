import { notFound } from "next/navigation";

import { DietCardActions } from "@/components/diet-card/diet-card-actions";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { requireModuleAccess } from "@/lib/auth";
import { getMemberDietCard } from "@/lib/services/member-diet-card";
import { formatDateTime } from "@/lib/utils";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function MemberDietCardPage({
  params,
  searchParams
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleAccess("operations");

  const { memberId } = await params;
  const query = await searchParams;
  const source = firstString(query.from);
  const backHref =
    source === "mcc"
      ? `/operations/member-command-center/${memberId}?tab=diet-allergies`
      : source === "mhp"
        ? `/health/member-health-profiles/${memberId}?tab=medical`
        : `/operations/member-command-center/${memberId}?tab=diet-allergies`;

  const dietCard = await getMemberDietCard(memberId);
  if (!dietCard) notFound();
  const allergyDisplay = (dietCard.allergies || "").trim().length > 0 ? dietCard.allergies : "NONE";
  const showNoAllergyStyle = allergyDisplay.toUpperCase() === "NONE";

  return (
    <div className="diet-card-page space-y-4">
      <div className="print-hide flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BackArrowButton fallbackHref={backHref} ariaLabel="Back to member record" />
          <a href={backHref} className="text-sm font-semibold text-brand">
            Back to Member Record
          </a>
        </div>
        <DietCardActions memberId={memberId} />
      </div>

      <section className="diet-card-sheet">
        <header className="diet-card-header border-b border-black/30 pb-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xl font-bold uppercase tracking-wide">Diet Card</p>
              <p className="text-sm">Town Square Fort Mill</p>
            </div>
            <div className="text-right text-xs">
              <p>Generated: {formatDateTime(dietCard.generatedAt)} (ET)</p>
            </div>
          </div>
        </header>

        <dl className="diet-card-grid mt-3">
          <div className="diet-card-row">
            <dt>Member Name</dt>
            <dd>{dietCard.member.name}</dd>
          </div>
          <div className="diet-card-row">
            <dt>Assistance Required</dt>
            <dd>{dietCard.assistanceRequired}</dd>
          </div>
          <div className="diet-card-row">
            <dt>Diet</dt>
            <dd>{dietCard.diet}</dd>
          </div>
          <div className="diet-card-row">
            <dt>Allergies</dt>
            <dd className={showNoAllergyStyle ? "font-bold tracking-wide" : undefined}>{allergyDisplay}</dd>
          </div>
          <div className="diet-card-row">
            <dt>Texture</dt>
            <dd>{dietCard.texture}</dd>
          </div>
          <div className="diet-card-row diet-card-row-notes">
            <dt>Notes</dt>
            <dd>{dietCard.notes}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
