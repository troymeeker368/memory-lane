import { ensureMemberHealthProfileSupabase } from "@/lib/services/member-health-profiles-supabase";
import { createClient } from "@/lib/supabase/server";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";

type DbRow = Record<string, unknown>;
const PROVIDER_DIRECTORY_UPSERT_SELECT =
  "id, specialty, specialty_other, practice_name, provider_phone, updated_at";
const HOSPITAL_DIRECTORY_UPSERT_SELECT = "id, updated_at";

export type MhpWriteActor = {
  actorUserId?: string | null;
  actorName?: string | null;
};

function isUuid(value: string | null | undefined) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

function toNullableUuid(value: string | null | undefined) {
  return isUuid(value) ? String(value) : null;
}

async function recordMhpWriteEvent(input: {
  eventType: string;
  entityType: string;
  entityId: string;
  memberId: string;
  actor?: MhpWriteActor;
  status: "created" | "updated" | "deleted";
}) {
  await recordWorkflowEvent({
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    actorType: "user",
    actorUserId: toNullableUuid(input.actor?.actorUserId),
    status: input.status,
    severity: "low",
    metadata: {
      member_id: input.memberId
    }
  });
}

export async function updateMemberHealthProfileByMemberIdSupabase(input: {
  memberId: string;
  patch: Record<string, unknown>;
  actor?: MhpWriteActor;
}) {
  const profile = await ensureMemberHealthProfileSupabase(input.memberId, { serviceRole: true });
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase
    .from("member_health_profiles")
    .update(input.patch)
    .eq("id", profile.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await recordMhpWriteEvent({
    eventType: "member_health_profile_updated",
    entityType: "member_health_profile",
    entityId: String(data.id ?? profile.id),
    memberId: input.memberId,
    actor: input.actor,
    status: "updated"
  });
  return data as DbRow;
}

export async function touchMemberHealthProfileSupabase(input: {
  memberId: string;
  actor: MhpWriteActor;
  atIso?: string | null;
}) {
  const now = input.atIso ?? toEasternISO();
  return updateMemberHealthProfileByMemberIdSupabase({
    memberId: input.memberId,
    patch: {
      updated_at: now,
      updated_by_user_id: toNullableUuid(input.actor.actorUserId),
      updated_by_name: input.actor.actorName ?? null
    },
    actor: input.actor
  });
}

export async function updateMemberFromMhpSupabase(input: {
  memberId: string;
  patch: Record<string, unknown>;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .update(input.patch)
    .eq("id", input.memberId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DbRow | null) ?? null;
}

export async function getMemberTrackForMhpSupabase(memberId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .select("id, latest_assessment_track")
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: String(data.id ?? ""),
    latest_assessment_track:
      typeof data.latest_assessment_track === "string" ? data.latest_assessment_track : null
  };
}

export async function countMemberDiagnosesSupabase(memberId: string) {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("member_diagnoses")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function createMemberDiagnosisSupabase(record: Record<string, unknown>) {
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase.from("member_diagnoses").insert(record).select("*").single();
  if (error) throw new Error(error.message);
  await recordMhpWriteEvent({
    eventType: "member_diagnosis_created",
    entityType: "member_diagnosis",
    entityId: String(data.id),
    memberId: String(record.member_id ?? ""),
    status: "created"
  });
  return data as DbRow;
}

export async function updateMemberDiagnosisSupabase(id: string, patch: Record<string, unknown>) {
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase
    .from("member_diagnoses")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.id && data?.member_id) {
    await recordMhpWriteEvent({
      eventType: "member_diagnosis_updated",
      entityType: "member_diagnosis",
      entityId: String(data.id),
      memberId: String(data.member_id),
      status: "updated"
    });
  }
  return (data as DbRow | null) ?? null;
}

export async function deleteMemberDiagnosisSupabase(id: string) {
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase.from("member_diagnoses").delete().eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.id && data?.member_id) {
    await recordMhpWriteEvent({
      eventType: "member_diagnosis_deleted",
      entityType: "member_diagnosis",
      entityId: String(data.id),
      memberId: String(data.member_id),
      status: "deleted"
    });
  }
  return (data as DbRow | null) ?? null;
}

export async function createMemberMedicationSupabase(record: Record<string, unknown>) {
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase.from("member_medications").insert(record).select("*").single();
  if (error) throw new Error(error.message);
  await recordMhpWriteEvent({
    eventType: "member_medication_created",
    entityType: "member_medication",
    entityId: String(data.id),
    memberId: String(record.member_id ?? ""),
    status: "created"
  });
  return data as DbRow;
}

export async function updateMemberMedicationSupabase(id: string, patch: Record<string, unknown>) {
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase
    .from("member_medications")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.id && data?.member_id) {
    await recordMhpWriteEvent({
      eventType: "member_medication_updated",
      entityType: "member_medication",
      entityId: String(data.id),
      memberId: String(data.member_id),
      status: "updated"
    });
  }
  return (data as DbRow | null) ?? null;
}

export async function deleteMemberMedicationSupabase(id: string) {
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase.from("member_medications").delete().eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.id && data?.member_id) {
    await recordMhpWriteEvent({
      eventType: "member_medication_deleted",
      entityType: "member_medication",
      entityId: String(data.id),
      memberId: String(data.member_id),
      status: "deleted"
    });
  }
  return (data as DbRow | null) ?? null;
}

export async function createMemberAllergySupabase(record: Record<string, unknown>) {
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase.from("member_allergies").insert(record).select("*").single();
  if (error) throw new Error(error.message);
  await recordMhpWriteEvent({
    eventType: "member_allergy_created",
    entityType: "member_allergy",
    entityId: String(data.id),
    memberId: String(record.member_id ?? ""),
    status: "created"
  });
  return data as DbRow;
}

export async function updateMemberAllergySupabase(id: string, patch: Record<string, unknown>) {
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase
    .from("member_allergies")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.id && data?.member_id) {
    await recordMhpWriteEvent({
      eventType: "member_allergy_updated",
      entityType: "member_allergy",
      entityId: String(data.id),
      memberId: String(data.member_id),
      status: "updated"
    });
  }
  return (data as DbRow | null) ?? null;
}

export async function deleteMemberAllergySupabase(id: string) {
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase.from("member_allergies").delete().eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.id && data?.member_id) {
    await recordMhpWriteEvent({
      eventType: "member_allergy_deleted",
      entityType: "member_allergy",
      entityId: String(data.id),
      memberId: String(data.member_id),
      status: "deleted"
    });
  }
  return (data as DbRow | null) ?? null;
}

export async function createMemberProviderSupabase(record: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("member_providers").insert(record).select("*").single();
  if (error) throw new Error(error.message);
  return data as DbRow;
}

export async function updateMemberProviderSupabase(id: string, patch: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_providers")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DbRow | null) ?? null;
}

export async function deleteMemberProviderSupabase(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("member_providers").delete().eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DbRow | null) ?? null;
}

export async function createMemberEquipmentSupabase(record: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("member_equipment").insert(record).select("*").single();
  if (error) throw new Error(error.message);
  return data as DbRow;
}

export async function updateMemberEquipmentSupabase(id: string, patch: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_equipment")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DbRow | null) ?? null;
}

export async function deleteMemberEquipmentSupabase(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("member_equipment").delete().eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DbRow | null) ?? null;
}

export async function createMemberNoteSupabase(record: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("member_notes").insert(record).select("*").single();
  if (error) throw new Error(error.message);
  return data as DbRow;
}

export async function updateMemberNoteSupabase(id: string, patch: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_notes")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DbRow | null) ?? null;
}

export async function deleteMemberNoteSupabase(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("member_notes").delete().eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DbRow | null) ?? null;
}

export async function upsertProviderDirectoryFromMhpSupabase(input: {
  providerName: string;
  specialty: string | null;
  specialtyOther: string | null;
  practiceName: string | null;
  providerPhone: string | null;
  actor: MhpWriteActor;
  atIso?: string | null;
}) {
  const normalizedProviderName = input.providerName.trim();
  if (!normalizedProviderName) return;

  const now = input.atIso ?? toEasternISO();
  const supabase = await createClient();
  const { data: existing, error: providerError } = await supabase
    .from("provider_directory")
    .select(PROVIDER_DIRECTORY_UPSERT_SELECT)
    .ilike("provider_name", normalizedProviderName)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (providerError) throw new Error(providerError.message);

  if (existing?.id) {
    const { error } = await supabase
      .from("provider_directory")
      .update({
        provider_name: normalizedProviderName,
        specialty: input.specialty ?? (existing.specialty as string | null) ?? null,
        specialty_other: input.specialtyOther ?? (existing.specialty_other as string | null) ?? null,
        practice_name: input.practiceName ?? (existing.practice_name as string | null) ?? null,
        provider_phone: input.providerPhone ?? (existing.provider_phone as string | null) ?? null,
        updated_at: now
      })
      .eq("id", String(existing.id));
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from("provider_directory").insert({
    provider_name: normalizedProviderName,
    specialty: input.specialty,
    specialty_other: input.specialtyOther,
    practice_name: input.practiceName,
    provider_phone: input.providerPhone,
    created_by_user_id: toNullableUuid(input.actor.actorUserId),
    created_by_name: input.actor.actorName ?? null,
    created_at: now,
    updated_at: now
  });
  if (error) throw new Error(error.message);
}

export async function upsertHospitalPreferenceDirectoryFromMhpSupabase(input: {
  hospitalName: string | null;
  actor: MhpWriteActor;
  atIso?: string | null;
}) {
  const normalizedHospitalName = (input.hospitalName ?? "").trim();
  if (!normalizedHospitalName) return;

  const now = input.atIso ?? toEasternISO();
  const supabase = await createClient();
  const { data: existing, error: hospitalError } = await supabase
    .from("hospital_preference_directory")
    .select(HOSPITAL_DIRECTORY_UPSERT_SELECT)
    .ilike("hospital_name", normalizedHospitalName)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (hospitalError) throw new Error(hospitalError.message);

  if (existing?.id) {
    const { error } = await supabase
      .from("hospital_preference_directory")
      .update({
        hospital_name: normalizedHospitalName,
        updated_at: now
      })
      .eq("id", String(existing.id));
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from("hospital_preference_directory").insert({
    hospital_name: normalizedHospitalName,
    created_by_user_id: toNullableUuid(input.actor.actorUserId),
    created_by_name: input.actor.actorName ?? null,
    created_at: now,
    updated_at: now
  });
  if (error) throw new Error(error.message);
}
