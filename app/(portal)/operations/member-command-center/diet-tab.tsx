import { Card } from "@/components/ui/card";
import { MccAllergiesSection } from "@/components/forms/mcc-allergies-section";
import { MccDietForm } from "@/components/forms/mcc-diet-form";
import type { MemberCommandCenterDetail } from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import { SectionHeading } from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";

export default function MemberCommandCenterDietTab({
  canEdit,
  detail,
  profileUpdatedAt,
  profileUpdatedBy,
  dietTypeDefault,
  dietTypeOtherDefault,
  dietTextureDefault,
  allergiesUpdatedAt,
  allergiesUpdatedBy
}: {
  canEdit: boolean;
  detail: MemberCommandCenterDetail;
  profileUpdatedAt: string | null;
  profileUpdatedBy: string | null;
  dietTypeDefault: string;
  dietTypeOtherDefault: string;
  dietTextureDefault: string;
  allergiesUpdatedAt: string | null;
  allergiesUpdatedBy: string | null;
}) {
  const dietTypeOptions = ["Regular", "Diabetic", "Low Sodium", "Pureed", "Renal", "Heart Healthy", "Other"] as const;
  const dietTextureOptions = ["Regular", "Mechanical Soft", "Chopped", "Ground", "Pureed", "Nectar Thick", "Honey Thick"] as const;

  return (
    <Card id="diet-allergies">
      <SectionHeading title="Diet / Allergies" lastUpdatedAt={profileUpdatedAt} lastUpdatedBy={profileUpdatedBy} />
      {canEdit ? (
        <MccDietForm
          key={`mcc-diet-${detail.member.id}-${profileUpdatedAt ?? "na"}`}
          memberId={detail.member.id}
          dietCardHref={`/members/${detail.member.id}/diet-card?from=mcc`}
          dietTypeDefault={dietTypeDefault}
          dietTypeOtherDefault={dietTypeOtherDefault}
          textureDefault={dietTextureDefault}
          dietTypeOptions={dietTypeOptions}
          dietTextureOptions={dietTextureOptions}
          swallowingDifficulty={detail.profile.swallowing_difficulty ?? ""}
          supplements={detail.profile.supplements ?? ""}
          dietaryPreferencesRestrictions={detail.profile.dietary_preferences_restrictions ?? ""}
          foodDislikes={detail.profile.food_dislikes ?? ""}
          foodsToOmit={detail.profile.foods_to_omit ?? ""}
          commandCenterNotes={detail.profile.command_center_notes ?? ""}
        />
      ) : (
        <>
          <div className="mt-3 flex justify-end">
            <a
              href={`/members/${detail.member.id}/diet-card?from=mcc`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            >
              Print Diet Card
            </a>
          </div>
          <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
            <p>Diet: {detail.profile.diet_type ?? "-"}</p>
            <p>Texture: {detail.profile.diet_texture ?? "-"}</p>
            <p>Restrictions: {detail.profile.dietary_preferences_restrictions ?? "-"}</p>
            <p>Swallowing Difficulty: {detail.profile.swallowing_difficulty ?? "-"}</p>
            <p>Supplements: {detail.profile.supplements ?? "-"}</p>
            <p>Food Dislikes: {detail.profile.food_dislikes ?? "-"}</p>
            <p>Foods to Omit: {detail.profile.foods_to_omit ?? "-"}</p>
            <p className="md:col-span-2">Notes: {detail.profile.command_center_notes ?? "-"}</p>
          </div>
        </>
      )}
      <div className="mt-4">
        <SectionHeading title="Allergies" lastUpdatedAt={allergiesUpdatedAt} lastUpdatedBy={allergiesUpdatedBy} />
      </div>
      <MccAllergiesSection
        key={`mcc-allergies-${detail.member.id}-${allergiesUpdatedAt ?? "na"}`}
        memberId={detail.member.id}
        canEdit={canEdit}
        initialRows={detail.mhpAllergies.map((row) => ({
          id: row.id,
          allergy_group: row.allergy_group,
          allergy_name: row.allergy_name,
          severity: row.severity,
          comments: row.comments,
          updated_at: row.updated_at
        }))}
      />
    </Card>
  );
}
