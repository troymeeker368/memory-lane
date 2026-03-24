import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { MEMBER_CONTACT_SELECT_WITH_PAYOR } from "@/lib/services/member-contact-payor-schema";
import {
  backfillMissingMemberCommandCenterRowsSupabase,
  getAvailableLockerNumbersForMemberSupabase,
  getMemberCommandCenterDetailSupabase,
  getMemberCommandCenterIndexSupabase,
  getMemberSupabase,
  getTransportationAddRiderMemberOptionsSupabase,
  listBusStopDirectorySupabase,
  listMemberAllergiesSupabase,
  listMemberContactsSupabase,
  listMemberFilesSupabase,
  listMemberNameLookupSupabase,
  listMembersSupabase
} from "@/lib/services/member-command-center-runtime";
import type {
  BillingScheduleTemplateRow,
  BusStopDirectoryRow,
  CenterBillingSettingRow,
  MccMemberRow,
  MemberAllergyRow,
  MemberAttendanceScheduleRow,
  MemberBillingSettingRow,
  MemberCommandCenterRow,
  MemberContactRow,
  PayorRow
} from "@/lib/services/member-command-center-types";
import {
  coerceMemberContactWriteError,
  defaultAttendanceSchedule,
  defaultCommandCenter,
  getMccClient,
  isMissingTableError,
  isUniqueConstraintError,
  mapMemberContactRow,
  missingMccStorageError,
  normalizeBusStopName,
  resolveMccMemberId,
  slugify,
  toId,
  type EnsureCanonicalMemberOptions
} from "@/lib/services/member-command-center-core";
export type {
  BillingScheduleTemplateRow,
  BusStopDirectoryRow,
  CenterBillingSettingRow,
  MemberAllergyRow,
  MemberAttendanceScheduleRow,
  MemberBillingSettingRow,
  MemberCommandCenterRow,
  MemberContactRow,
  PayorRow
} from "@/lib/services/member-command-center-types";

export async function listActivePayorsSupabase() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payors")
    .select("id, payor_name, status")
    .eq("status", "active")
    .order("payor_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PayorRow[];
}

export async function listCenterBillingSettingsSupabase() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("center_billing_settings")
    .select("*")
    .order("effective_start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CenterBillingSettingRow[];
}

export async function upsertCenterBillingSettingSupabase(
  id: string | null,
  payload: Omit<CenterBillingSettingRow, "id" | "created_at" | "updated_at">
) {
  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase
      .from("center_billing_settings")
      .update(payload)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as CenterBillingSettingRow | null) ?? null;
  }
  const { data, error } = await supabase
    .from("center_billing_settings")
    .insert({ id: toId("center-billing"), ...payload })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as CenterBillingSettingRow;
}

export async function listMemberBillingSettingsSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listMemberBillingSettingsSupabase", options);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_billing_settings")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .order("effective_start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberBillingSettingRow[];
}

export async function listBillingScheduleTemplatesSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listBillingScheduleTemplatesSupabase", options);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("billing_schedule_templates")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .order("effective_start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BillingScheduleTemplateRow[];
}

export async function upsertMemberBillingSettingSupabase(
  id: string | null,
  payload: Omit<MemberBillingSettingRow, "id" | "created_at" | "updated_at">
) {
  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase.from("member_billing_settings").update(payload).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return (data as MemberBillingSettingRow | null) ?? null;
  }
  const { data, error } = await supabase
    .from("member_billing_settings")
    .insert({ id: toId("member-billing"), ...payload })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as MemberBillingSettingRow;
}

export async function upsertBillingScheduleTemplateSupabase(
  id: string | null,
  payload: Omit<BillingScheduleTemplateRow, "id" | "created_at" | "updated_at">
) {
  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase
      .from("billing_schedule_templates")
      .update(payload)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as BillingScheduleTemplateRow | null) ?? null;
  }
  const { data, error } = await supabase
    .from("billing_schedule_templates")
    .insert({ id: toId("schedule-template"), ...payload })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as BillingScheduleTemplateRow;
}

export async function updateMemberSupabase(memberId: string, patch: Record<string, unknown>) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "updateMemberSupabase");
  const supabase = await createClient();
  const { data, error } = await supabase.from("members").update(patch).eq("id", canonicalMemberId).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MccMemberRow | null) ?? null;
}

export async function ensureMemberCommandCenterProfileSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "ensureMemberCommandCenterProfileSupabase");
  const supabase = await getMccClient(options);
  const { data, error } = await supabase
    .from("member_command_centers")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .limit(1);
  if (error) {
    if (isMissingTableError(error, "member_command_centers")) {
      throw missingMccStorageError({
        objectName: "member_command_centers",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(error.message);
  }
  const existing = Array.isArray(data) ? data[0] : null;
  if (existing) return existing as MemberCommandCenterRow;

  const created = {
    ...defaultCommandCenter(canonicalMemberId),
    updated_by_user_id: options?.actor?.userId ?? null,
    updated_by_name: options?.actor?.name ?? null
  };
  const { data: inserted, error: insertError } = await supabase
    .from("member_command_centers")
    .insert(created)
    .select("*")
    .single();
  if (insertError) {
    if (isMissingTableError(insertError, "member_command_centers")) {
      throw missingMccStorageError({
        objectName: "member_command_centers",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    if (isUniqueConstraintError(insertError)) {
      const { data: recovered, error: recoverError } = await supabase
        .from("member_command_centers")
        .select("*")
        .eq("member_id", canonicalMemberId)
        .limit(1);
      if (recoverError) {
        if (isMissingTableError(recoverError, "member_command_centers")) {
          throw missingMccStorageError({
            objectName: "member_command_centers",
            migration: "0011_member_command_center_aux_schema.sql"
          });
        }
        throw new Error(recoverError.message);
      }
      const recoveredRow = Array.isArray(recovered) ? recovered[0] : null;
      if (recoveredRow) return recoveredRow as MemberCommandCenterRow;

      const { data: recoveredById, error: recoverByIdError } = await supabase
        .from("member_command_centers")
        .select("*")
        .eq("id", created.id)
        .limit(1);
      if (recoverByIdError) {
        if (isMissingTableError(recoverByIdError, "member_command_centers")) {
          throw missingMccStorageError({
            objectName: "member_command_centers",
            migration: "0011_member_command_center_aux_schema.sql"
          });
        }
        throw new Error(recoverByIdError.message);
      }
      const recoveredByIdRow = Array.isArray(recoveredById) ? recoveredById[0] : null;
      if (recoveredByIdRow) return recoveredByIdRow as MemberCommandCenterRow;
    }
    throw new Error(insertError.message);
  }
  return inserted as MemberCommandCenterRow;
}

export async function ensureMemberAttendanceScheduleSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "ensureMemberAttendanceScheduleSupabase");
  const supabase = await getMccClient(options);
  const member = await getMemberSupabase(canonicalMemberId, options);
  if (!member) {
    throw new Error(`ensureMemberAttendanceScheduleSupabase could not find member ${canonicalMemberId}.`);
  }
  const { data, error } = await supabase
    .from("member_attendance_schedules")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .limit(1);
  if (error) {
    if (isMissingTableError(error, "member_attendance_schedules")) {
      throw missingMccStorageError({
        objectName: "member_attendance_schedules",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(error.message);
  }
  const existing = Array.isArray(data) ? data[0] : null;
  if (existing) return existing as MemberAttendanceScheduleRow;

  const created = {
    ...defaultAttendanceSchedule(member),
    updated_by_user_id: options?.actor?.userId ?? null,
    updated_by_name: options?.actor?.name ?? null
  };
  const { data: inserted, error: insertError } = await supabase
    .from("member_attendance_schedules")
    .insert(created)
    .select("*")
    .single();
  if (insertError) {
    if (isMissingTableError(insertError, "member_attendance_schedules")) {
      throw missingMccStorageError({
        objectName: "member_attendance_schedules",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    if (isUniqueConstraintError(insertError)) {
      const { data: recovered, error: recoverError } = await supabase
        .from("member_attendance_schedules")
        .select("*")
        .eq("member_id", canonicalMemberId)
        .limit(1);
      if (recoverError) {
        if (isMissingTableError(recoverError, "member_attendance_schedules")) {
          throw missingMccStorageError({
            objectName: "member_attendance_schedules",
            migration: "0011_member_command_center_aux_schema.sql"
          });
        }
        throw new Error(recoverError.message);
      }
      const recoveredRow = Array.isArray(recovered) ? recovered[0] : null;
      if (recoveredRow) return recoveredRow as MemberAttendanceScheduleRow;

      const { data: recoveredById, error: recoverByIdError } = await supabase
        .from("member_attendance_schedules")
        .select("*")
        .eq("id", created.id)
        .limit(1);
      if (recoverByIdError) {
        if (isMissingTableError(recoverByIdError, "member_attendance_schedules")) {
          throw missingMccStorageError({
            objectName: "member_attendance_schedules",
            migration: "0011_member_command_center_aux_schema.sql"
          });
        }
        throw new Error(recoverByIdError.message);
      }
      const recoveredByIdRow = Array.isArray(recoveredById) ? recoveredById[0] : null;
      if (recoveredByIdRow) return recoveredByIdRow as MemberAttendanceScheduleRow;
    }
    throw new Error(insertError.message);
  }
  return inserted as MemberAttendanceScheduleRow;
}

export async function updateMemberCommandCenterProfileSupabase(id: string, patch: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_command_centers")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MemberCommandCenterRow | null) ?? null;
}

export async function updateMemberAttendanceScheduleSupabase(id: string, patch: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_attendance_schedules")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MemberAttendanceScheduleRow | null) ?? null;
}

export async function listMemberAttendanceSchedulesForMemberIdsSupabase(
  memberIds: Array<string | null | undefined>
) {
  const normalizedMemberIds = Array.from(
    new Set(
      memberIds
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
  if (normalizedMemberIds.length === 0) return [] as MemberAttendanceScheduleRow[];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_attendance_schedules")
    .select("*")
    .in("member_id", normalizedMemberIds);

  const schedules = (() => {
    if (!error) return (data ?? []) as MemberAttendanceScheduleRow[];
    if (isMissingTableError(error, "member_attendance_schedules")) {
      throw missingMccStorageError({
        objectName: "member_attendance_schedules",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(error.message);
  })();

  const scheduleByMember = new Map(schedules.map((row) => [row.member_id, row] as const));
  const missingMemberIds = normalizedMemberIds.filter((memberId) => !scheduleByMember.has(memberId));
  if (missingMemberIds.length === 0) return schedules;

  const ensuredSchedules = await Promise.all(
    missingMemberIds.map((memberId) => ensureMemberAttendanceScheduleSupabase(memberId))
  );
  ensuredSchedules.forEach((schedule, index) => {
    if (!schedule) {
      throw new Error(`Unable to ensure attendance schedule for member ${missingMemberIds[index]}.`);
    }
    scheduleByMember.set(schedule.member_id, schedule);
  });

  return Array.from(scheduleByMember.values());
}

export async function upsertMemberContactSupabase(input: {
  id?: string;
  member_id: string;
  contact_name: string;
  relationship_to_member: string | null;
  category: string;
  category_other: string | null;
  email: string | null;
  cellular_number: string | null;
  work_number: string | null;
  home_number: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  is_payor: boolean;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}) {
  const canonicalMemberId = await resolveMccMemberId(input.member_id, "upsertMemberContactSupabase");
  const supabase = await createClient();
  const persistAndMaybeAssignPayor = async (data: MemberContactRow | null) => {
    if (!data) return null;
    if (input.is_payor) {
      const { setBillingPayorContact } = await import("@/lib/services/billing-payor-contacts");
      await setBillingPayorContact({
        memberId: canonicalMemberId,
        contactId: data.id,
        actorUserId: input.created_by_user_id,
        actorName: input.created_by_name,
        source: "upsertMemberContactSupabase",
        reason: "Member contact saved with Is Payor selected."
      });
      const { data: refreshed, error: refreshError } = await supabase
        .from("member_contacts")
        .select(MEMBER_CONTACT_SELECT_WITH_PAYOR)
        .eq("id", data.id)
        .maybeSingle();
      if (refreshError) throw coerceMemberContactWriteError(refreshError);
      return refreshed ? mapMemberContactRow(refreshed as unknown as Record<string, unknown>) : null;
    }
    return data;
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("member_contacts")
      .update({
        member_id: canonicalMemberId,
        contact_name: input.contact_name,
        relationship_to_member: input.relationship_to_member,
        category: input.category,
        category_other: input.category_other,
        email: input.email,
        cellular_number: input.cellular_number,
        work_number: input.work_number,
        home_number: input.home_number,
        street_address: input.street_address,
        city: input.city,
        state: input.state,
        zip: input.zip,
        is_payor: false,
        updated_at: input.updated_at
      })
      .eq("id", input.id)
      .select(MEMBER_CONTACT_SELECT_WITH_PAYOR)
      .maybeSingle();
    if (error) throw coerceMemberContactWriteError(error);
    return persistAndMaybeAssignPayor(data ? mapMemberContactRow(data as unknown as Record<string, unknown>) : null);
  }
  const { data, error } = await supabase
    .from("member_contacts")
    .insert({ ...input, member_id: canonicalMemberId, id: toId("contact"), is_payor: false })
    .select(MEMBER_CONTACT_SELECT_WITH_PAYOR)
    .single();
  if (error) throw coerceMemberContactWriteError(error);
  return (await persistAndMaybeAssignPayor(mapMemberContactRow(data as unknown as Record<string, unknown>))) as MemberContactRow;
}

export async function deleteMemberContactSupabase(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("member_contacts").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return true;
}

export async function addMemberAllergySupabase(input: Omit<MemberAllergyRow, "id">) {
  const canonicalMemberId = await resolveMccMemberId(input.member_id, "addMemberAllergySupabase");
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase
    .from("member_allergies")
    .insert({ ...input, member_id: canonicalMemberId, id: toId("allergy") })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as MemberAllergyRow;
}

export async function updateMemberAllergySupabase(id: string, patch: Partial<MemberAllergyRow>) {
  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase.from("member_allergies").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MemberAllergyRow | null) ?? null;
}

export async function deleteMemberAllergySupabase(id: string) {
  const supabase = await createClient({ serviceRole: true });
  const { error } = await supabase.from("member_allergies").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return true;
}

export async function upsertBusStopDirectoryFromValuesSupabase(input: {
  busStopNames: Array<string | null | undefined>;
  actor: { id: string; full_name: string };
  now: string;
}) {
  const supabase = await createClient();
  const names = Array.from(
    new Set(
      input.busStopNames
        .map((value) => normalizeBusStopName(value))
        .filter((value): value is string => Boolean(value))
    )
  );
  if (names.length === 0) return;
  const { data: existing, error } = await supabase.from("bus_stop_directory").select("*");
  if (error) throw new Error(error.message);
  const existingByName = new Map(
    ((existing ?? []) as BusStopDirectoryRow[]).map((row) => [row.bus_stop_name.trim().toLowerCase(), row] as const)
  );
  for (const name of names) {
    const key = name.toLowerCase();
    const matched = existingByName.get(key);
    if (matched) {
      const { error: updateError } = await supabase
        .from("bus_stop_directory")
        .update({ bus_stop_name: name, updated_at: input.now })
        .eq("id", matched.id);
      if (updateError) throw new Error(updateError.message);
      continue;
    }
    const id = `bus-stop-${slugify(name) || randomUUID()}`;
    const { error: insertError } = await supabase.from("bus_stop_directory").insert({
      id,
      bus_stop_name: name,
      created_by_user_id: input.actor.id,
      created_by_name: input.actor.full_name,
      created_at: input.now,
      updated_at: input.now
    });
    if (insertError && !insertError.message.toLowerCase().includes("duplicate")) {
      throw new Error(insertError.message);
    }
  }
}

export {
  backfillMissingMemberCommandCenterRowsSupabase,
  getAvailableLockerNumbersForMemberSupabase,
  getMemberCommandCenterDetailSupabase,
  getMemberCommandCenterIndexSupabase,
  getMemberSupabase,
  getTransportationAddRiderMemberOptionsSupabase,
  listBusStopDirectorySupabase,
  listMemberAllergiesSupabase,
  listMemberContactsSupabase,
  listMemberFilesSupabase,
  listMemberNameLookupSupabase,
  listMembersSupabase
};
