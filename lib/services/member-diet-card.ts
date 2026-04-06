import { toEasternISO } from "@/lib/timezone";
import { getMemberCommandCenterDetail } from "@/lib/services/member-command-center";
import { getMemberHealthProfileDetail } from "@/lib/services/member-health-profiles";

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function deriveAssistanceRequired(input: { eating: string | null }) {
  const eating = clean(input.eating);
  if (eating) return eating;
  return "Not recorded";
}

function buildAllergySummary(input: {
  noKnownAllergies: boolean | null;
  foodAllergies: string | null;
  allergyRows: Array<{
    allergy_group: "food" | "medication" | "environmental";
    allergy_name: string;
    severity: string | null;
  }>;
}) {
  const entries: string[] = [];

  input.allergyRows.forEach((row) => {
    const name = clean(row.allergy_name);
    if (!name) return;
    const severity = clean(row.severity);
    entries.push(severity ? `${name} (${severity})` : name);
  });

  [input.foodAllergies].forEach((value) => {
    const cleaned = clean(value);
    if (!cleaned) return;
    cleaned
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => {
        if (!entries.some((entry) => entry.toLowerCase() === item.toLowerCase())) {
          entries.push(item);
        }
      });
  });

  if (entries.length === 0 && input.noKnownAllergies) return "NONE";
  if (entries.length === 0) return "NONE";
  return entries.join(", ");
}

export async function getMemberDietCard(memberId: string) {
  const [mcc, mhp] = await Promise.all([
    getMemberCommandCenterDetail(memberId),
    getMemberHealthProfileDetail(memberId, {
      includeProviderDirectory: false,
      includeHospitalPreferenceDirectory: false,
      includeAssessments: false,
      includeDiagnoses: false,
      includeMedications: false,
      includeProviders: false,
      includeEquipment: false,
      includeNotes: false
    })
  ]);
  if (!mcc || !mhp) return null;

  const profile = mcc.profile;
  const mhpProfile = mhp.profile;

  const dietType = clean(profile.diet_type) ?? clean(mhpProfile.diet_type) ?? "Not recorded";
  const texture = clean(profile.diet_texture) ?? clean(mhpProfile.diet_texture) ?? "Not recorded";
  const assistanceRequired = deriveAssistanceRequired({
    eating: mhpProfile.eating
  });

  const notes = clean(profile.command_center_notes) ?? "Not recorded";

  const allergies = buildAllergySummary({
    noKnownAllergies: profile.no_known_allergies,
    foodAllergies: profile.food_allergies,
    allergyRows: mhp.allergies.map((row) => ({
      allergy_group: row.allergy_group,
      allergy_name: row.allergy_name,
      severity: row.severity
    }))
  });

  return {
    generatedAt: toEasternISO(),
    member: {
      id: mcc.member.id,
      name: mcc.member.display_name
    },
    assistanceRequired,
    diet: dietType,
    allergies,
    texture,
    notes
  };
}
