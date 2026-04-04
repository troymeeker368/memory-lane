import "server-only";

import { revalidatePath } from "next/cache";

import { requireMemberHealthProfilesManagement } from "@/lib/auth";

export function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export function asNullableString(formData: FormData, key: string) {
  const value = asString(formData, key);
  return value.length > 0 ? value : null;
}

export function asNullableBool(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "true" || value === "yes" || value === "1") return true;
  if (value === "false" || value === "no" || value === "0") return false;
  return null;
}

const TIME_24H_PATTERN = /^(\d{1,2}):(\d{2})$/;
const OPHTHALMIC_LATERALITY = new Set(["OD", "OS", "OU"]);
const OTIC_LATERALITY = new Set(["AD", "AS", "AU"]);
const ALLERGY_GROUP_OPTIONS = ["medication", "food", "environmental"] as const;

export type AllergyGroup = (typeof ALLERGY_GROUP_OPTIONS)[number];
export type MhpActionActor = Awaited<ReturnType<typeof requireMemberHealthProfilesManagement>>;

export function normalizeTime24h(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  if (!normalized) return null;
  const match = TIME_24H_PATTERN.exec(normalized);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseScheduledTimesInput(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  if (!raw) return { ok: true as const, times: [] as string[] };
  const times = Array.from(
    new Set(
      raw
        .split(/[;,]/g)
        .map((entry) => normalizeTime24h(entry))
        .filter((entry): entry is string => Boolean(entry))
    )
  );
  if (times.length === 0) {
    return { ok: false as const, error: "Scheduled times must use 24-hour HH:MM format (example: 09:00, 13:30)." };
  }
  return { ok: true as const, times };
}

export function parseMedicationMarInput(formData: FormData) {
  const givenAtCenter = asNullableBool(formData, "givenAtCenter") ?? true;
  const prn = asNullableBool(formData, "prn") ?? false;
  const prnInstructions = asNullableString(formData, "prnInstructions");
  const scheduledTimesResult = parseScheduledTimesInput(asNullableString(formData, "scheduledTimes"));
  if (!scheduledTimesResult.ok) return scheduledTimesResult;
  if (givenAtCenter && !prn && scheduledTimesResult.times.length === 0) {
    return {
      ok: false as const,
      error: "Center-administered non-PRN medications require at least one scheduled time."
    };
  }
  return {
    ok: true as const,
    givenAtCenter,
    prn,
    prnInstructions,
    scheduledTimes: scheduledTimesResult.times
  };
}

export function parseRouteLaterality(route: string | null | undefined, formData: FormData) {
  const normalizedRoute = (route ?? "").trim().toLowerCase();
  const laterality = asNullableString(formData, "routeLaterality");

  if (normalizedRoute === "ophthalmic") {
    if (!laterality || !OPHTHALMIC_LATERALITY.has(laterality)) {
      return { ok: false as const, error: "Ophthalmic route requires OD, OS, or OU." };
    }
    return { ok: true as const, value: laterality };
  }

  if (normalizedRoute === "otic") {
    if (!laterality || !OTIC_LATERALITY.has(laterality)) {
      return { ok: false as const, error: "Otic route requires AD, AS, or AU." };
    }
    return { ok: true as const, value: laterality };
  }

  return { ok: true as const, value: null };
}

export function parseAllergyGroup(formData: FormData, key: string): AllergyGroup {
  const value = asString(formData, key);
  return ALLERGY_GROUP_OPTIONS.includes(value as AllergyGroup) ? (value as AllergyGroup) : "medication";
}

export function resolveProviderSpecialty(formData: FormData) {
  const specialtyChoice = asString(formData, "providerSpecialty");
  const specialtyOther = asNullableString(formData, "providerSpecialtyOther");
  if (specialtyChoice === "Other") {
    const cleanedOther = specialtyOther?.trim() ?? "";
    return {
      specialty: cleanedOther.length > 0 ? cleanedOther : "Other",
      specialty_other: cleanedOther.length > 0 ? cleanedOther : null
    };
  }
  return {
    specialty: specialtyChoice || null,
    specialty_other: null
  };
}

export function isUuid(value: string | null | undefined) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

export function toNullableUuid(value: string | null | undefined) {
  return isUuid(value) ? String(value) : null;
}

export async function requireNurseAdmin() {
  return requireMemberHealthProfilesManagement();
}

export function toServiceActor(actor: Pick<MhpActionActor, "id" | "full_name">) {
  return {
    id: actor.id,
    fullName: actor.full_name
  };
}

export function buildMhpUpdatedByPatch(actor: Pick<MhpActionActor, "id" | "full_name">, now: string) {
  return {
    updated_at: now,
    updated_by_user_id: toNullableUuid(actor.id),
    updated_by_name: actor.full_name
  };
}

export function revalidateMhp(memberId: string, options?: { mar?: boolean }) {
  revalidatePath("/health/member-health-profiles");
  revalidatePath(`/health/member-health-profiles/${memberId}`);
  revalidatePath("/operations/member-command-center");
  revalidatePath(`/operations/member-command-center/${memberId}`);
  revalidatePath(`/members/${memberId}`);
  revalidatePath("/health");
  if (options?.mar) {
    revalidatePath("/health/mar");
  }
}

export function addDaysDateOnly(dateValue: string, days: number) {
  const [yearRaw, monthRaw, dayRaw] = dateValue.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const seed = new Date(Date.UTC(year, month - 1, day));
  seed.setUTCDate(seed.getUTCDate() + days);
  return `${seed.getUTCFullYear()}-${String(seed.getUTCMonth() + 1).padStart(2, "0")}-${String(seed.getUTCDate()).padStart(2, "0")}`;
}
