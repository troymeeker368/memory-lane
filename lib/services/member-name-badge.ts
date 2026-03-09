import { toEasternISO } from "@/lib/timezone";
import { getMemberCommandCenterDetail } from "@/lib/services/member-command-center";
import { getMemberHealthProfileDetail } from "@/lib/services/member-health-profiles";

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function includesWord(value: string | null | undefined, pattern: RegExp) {
  const normalized = clean(value);
  if (!normalized) return false;
  return pattern.test(normalized.toLowerCase());
}

function asInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export interface MemberBadgeIndicator {
  key:
    | "nut_allergy"
    | "shellfish_allergy"
    | "fish_allergy"
    | "diabetic_restricted_sweets"
    | "oxygen_requirement"
    | "dnr"
    | "no_photos"
    | "bathroom_assistance";
  label: string;
  shortLabel: string;
  enabled: boolean;
  iconSrc: string | null;
}

export interface MemberNameBadgeDetail {
  generatedAt: string;
  member: {
    id: string;
    name: string;
    initials: string;
    lockerNumber: string | null;
  };
  logoSrc: string;
  indicators: MemberBadgeIndicator[];
}

export function getMemberNameBadgeDetail(memberId: string): MemberNameBadgeDetail | null {
  const mcc = getMemberCommandCenterDetail(memberId);
  const mhp = getMemberHealthProfileDetail(memberId);
  if (!mcc || !mhp) return null;

  const memberName = mcc.member.display_name;
  const allergies = mhp.allergies;
  const foodAllergyNames = allergies
    .filter((row) => row.allergy_group === "food")
    .map((row) => row.allergy_name.toLowerCase());
  const dietaryRestrictions = `${mcc.profile.dietary_preferences_restrictions ?? ""} ${mhp.profile.dietary_restrictions ?? ""}`.toLowerCase();
  const dietType = `${mcc.profile.diet_type ?? ""} ${mhp.profile.diet_type ?? ""}`.toLowerCase();
  const toileting = `${mhp.profile.toileting ?? ""} ${mhp.profile.toileting_needs ?? ""}`.toLowerCase();

  const hasNutAllergy =
    foodAllergyNames.some((value) => /nut|peanut|tree nut/.test(value)) ||
    includesWord(mcc.profile.food_allergies, /nut|peanut|tree nut/);
  const hasShellfishAllergy =
    foodAllergyNames.some((value) => /shellfish|shrimp|lobster|crab/.test(value)) ||
    includesWord(mcc.profile.food_allergies, /shellfish|shrimp|lobster|crab/);
  const hasFishAllergy =
    foodAllergyNames.some((value) => /(^|\b)(fish|salmon|tuna|cod)(\b|$)/.test(value) && !/shellfish/.test(value)) ||
    includesWord(mcc.profile.food_allergies, /(^|\b)(fish|salmon|tuna|cod)(\b|$)/);
  const hasDiabeticRestriction = /diabetic/.test(dietType) || /restricted sweets|no sugar|sugar/i.test(dietaryRestrictions);
  const hasOxygenRequirement = mhp.equipment.some((row) => {
    const equipmentType = clean(row.equipment_type)?.toLowerCase() ?? "";
    const status = clean(row.status)?.toLowerCase();
    const isActive = !status || status === "active";
    return isActive && equipmentType.includes("oxygen");
  });
  const codeStatus = clean(mcc.profile.code_status) ?? clean(mhp.profile.code_status) ?? clean(mcc.member.code_status);
  const hasDnr = mcc.profile.dnr === true || mhp.profile.dnr === true || codeStatus === "DNR";
  const noPhotos = mcc.profile.photo_consent === false || mhp.profile.photo_consent === false;
  const bathroomAssistance = /needs help|cue|assist|yes/.test(toileting);

  const indicators: MemberBadgeIndicator[] = [
    {
      key: "nut_allergy",
      label: "Nut Allergy",
      shortLabel: "NUT",
      enabled: hasNutAllergy,
      iconSrc: "/badge-assets/nut_allergy.png"
    },
    {
      key: "shellfish_allergy",
      label: "Shellfish Allergy",
      shortLabel: "SHELL",
      enabled: hasShellfishAllergy,
      iconSrc: "/badge-assets/shellfish_allergy.png"
    },
    {
      key: "fish_allergy",
      label: "Fish Allergy",
      shortLabel: "FISH",
      enabled: hasFishAllergy,
      iconSrc: "/badge-assets/fish_allergy.png"
    },
    {
      key: "diabetic_restricted_sweets",
      label: "Diabetic / Restricted Sweets",
      shortLabel: "DIET",
      enabled: hasDiabeticRestriction,
      iconSrc: "/badge-assets/diabetic.png"
    },
    {
      key: "oxygen_requirement",
      label: "Oxygen Requirement",
      shortLabel: "O2",
      enabled: hasOxygenRequirement,
      iconSrc: "/badge-assets/oxygen_required.png"
    },
    {
      key: "dnr",
      label: "DNR",
      shortLabel: "DNR",
      enabled: hasDnr,
      iconSrc: "/badge-assets/dnr.png"
    },
    {
      key: "no_photos",
      label: "No Photos",
      shortLabel: "PHOTO",
      enabled: noPhotos,
      iconSrc: "/badge-assets/no_photos.png"
    },
    {
      key: "bathroom_assistance",
      label: "Bathroom Assistance",
      shortLabel: "BATH",
      enabled: bathroomAssistance,
      iconSrc: "/badge-assets/bathroom_assistance.png"
    }
  ];

  return {
    generatedAt: toEasternISO(),
    member: {
      id: mcc.member.id,
      name: memberName,
      initials: asInitials(memberName),
      lockerNumber: clean(mcc.member.locker_number)
    },
    logoSrc: "/badge-assets/town-square-logo.png",
    indicators
  };
}
