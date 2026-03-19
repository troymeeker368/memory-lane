import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { MEMBER_CONTACT_SELECT_WITH_PAYOR } from "@/lib/services/member-contact-payor-schema";
import type {
  BillingScheduleTemplateRow,
  BusStopDirectoryRow,
  CenterBillingSettingRow,
  MakeupLedgerRow,
  MccMemberRow,
  MemberAllergyRow,
  MemberAttendanceScheduleRow,
  MemberBillingSettingRow,
  MemberCommandCenterIndexResult,
  MemberCommandCenterRow,
  MemberContactRow,
  MemberFileRow,
  PayorRow
} from "@/lib/services/member-command-center-types";
import {
  calculateAgeYears,
  calculateMonthsEnrolled,
  coerceMemberContactWriteError,
  defaultAttendanceSchedule,
  defaultCommandCenter,
  getMccClient,
  isMissingAnyColumnError,
  isMissingTableError,
  isUniqueConstraintError,
  mapMemberContactRow,
  missingMccStorageError,
  normalizeBusStopName,
  normalizeLocker,
  resolveMccMemberId,
  selectMemberContactsRows,
  slugify,
  sortByLastName,
  sortLockerValues,
  toId,
  type EnsureCanonicalMemberOptions
} from "@/lib/services/member-command-center-core";
import {
  selectMemberWithFallback,
  selectMemberLookupRowsWithFallback,
  selectMembersPageWithFallback,
  selectMembersWithFallback
} from "@/lib/services/member-command-center-member-queries";
export type {
  BillingScheduleTemplateRow,
  BusStopDirectoryRow,
  CenterBillingSettingRow,
  MakeupLedgerRow,
  MccMemberRow,
  MemberAllergyRow,
  MemberAttendanceScheduleRow,
  MemberBillingSettingRow,
  MemberCommandCenterIndexResult,
  MemberCommandCenterRow,
  MemberContactRow,
  MemberFileRow,
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

export async function listMemberBillingSettingsSupabase(memberId: string) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listMemberBillingSettingsSupabase");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_billing_settings")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .order("effective_start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberBillingSettingRow[];
}

export async function listBillingScheduleTemplatesSupabase(memberId: string) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listBillingScheduleTemplatesSupabase");
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

export async function listMembersSupabase(filters?: { q?: string; status?: "all" | "active" | "inactive" }) {
  const supabase = await createClient();
  const rows = await selectMembersWithFallback(
    async (selectClause) => {
      let query = supabase.from("members").select(selectClause);
      if (filters?.status && filters.status !== "all") {
        query = query.eq("status", filters.status);
      }
      return query.order("display_name", { ascending: true });
    },
    isMissingAnyColumnError,
    "Unable to query members."
  );

  const q = (filters?.q ?? "").trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (row) =>
      row.display_name.toLowerCase().includes(q) ||
      String(row.locker_number ?? "").toLowerCase().includes(q)
  );
}

export async function listMemberNameLookupSupabase(filters?: { status?: "all" | "active" | "inactive" }) {
  const supabase = await createClient();
  return selectMemberLookupRowsWithFallback(
    async (selectClause) => {
      let query = supabase.from("members").select(selectClause);
      if (filters?.status && filters.status !== "all") {
        query = query.eq("status", filters.status);
      }
      return query.order("display_name", { ascending: true });
    },
    isMissingAnyColumnError,
    "Unable to query member lookup rows."
  );
}

async function listMembersPageSupabase(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
  page?: number;
  pageSize?: number;
}) {
  const supabase = await createClient();
  const page = Number.isFinite(filters?.page) && Number(filters?.page) > 0 ? Math.floor(Number(filters?.page)) : 1;
  const pageSize =
    Number.isFinite(filters?.pageSize) && Number(filters?.pageSize) > 0 ? Math.floor(Number(filters?.pageSize)) : 25;
  const q = (filters?.q ?? "").trim();
  const { rows, totalRows } = await selectMembersPageWithFallback(
    async (selectClause) => {
      let query: any = supabase
        .from("members")
        .select(selectClause, { count: "exact" })
        .order("display_name", { ascending: true })
        .range((page - 1) * pageSize, page * pageSize - 1);
      if (filters?.status && filters.status !== "all") {
        query = query.eq("status", filters.status);
      }
      if (q) {
        query = query.ilike("display_name", `%${q.replace(/[%,_]/g, (match) => `\\${match}`)}%`);
      }
      return query;
    },
    isMissingAnyColumnError,
    "Unable to query members."
  );

  return {
    rows,
    page,
    pageSize,
    totalRows,
    totalPages: Math.max(1, Math.ceil(totalRows / pageSize))
  };
}

export async function getMemberSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "getMemberSupabase");
  const supabase = await getMccClient(options);
  return selectMemberWithFallback(
    (selectClause) => supabase.from("members").select(selectClause).eq("id", canonicalMemberId).maybeSingle(),
    isMissingAnyColumnError,
    "Unable to fetch member."
  );
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

export async function listMemberContactsSupabase(memberId: string) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listMemberContactsSupabase");
  const supabase = await createClient();
  return selectMemberContactsRows((selectClause) =>
    supabase
      .from("member_contacts")
      .select(selectClause)
      .eq("member_id", canonicalMemberId)
      .order("updated_at", { ascending: false })
  );
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

export async function listMemberFilesSupabase(memberId: string) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listMemberFilesSupabase");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_files")
    .select(
      "id, member_id, file_name, file_type, file_data_url, storage_object_path, category, category_other, document_source, pof_request_id, uploaded_by_user_id, uploaded_by_name, uploaded_at, updated_at"
    )
    .eq("member_id", canonicalMemberId)
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberFileRow[];
}

export async function listMemberAllergiesSupabase(memberId: string) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listMemberAllergiesSupabase");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_allergies")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberAllergyRow[];
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

export async function listBusStopDirectorySupabase() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("bus_stop_directory").select("*").order("bus_stop_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BusStopDirectoryRow[];
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

export async function getAvailableLockerNumbersForMemberSupabase(memberId: string) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "getAvailableLockerNumbersForMemberSupabase");
  const members = await listMembersSupabase({ status: "all" });
  const member = members.find((row) => row.id === canonicalMemberId) ?? null;
  const currentLocker = normalizeLocker(member?.locker_number ?? null);
  const usedByOtherActive = new Set(
    members
      .filter((row) => row.status === "active" && row.id !== canonicalMemberId)
      .map((row) => normalizeLocker(row.locker_number))
      .filter((value): value is string => Boolean(value))
  );
  const pool = new Set<string>();
  for (let locker = 1; locker <= 72; locker += 1) pool.add(String(locker));
  members.forEach((row) => {
    const locker = normalizeLocker(row.locker_number);
    if (locker) pool.add(locker);
  });
  if (currentLocker) pool.add(currentLocker);
  return [...pool]
    .filter((locker) => !usedByOtherActive.has(locker) || locker === currentLocker)
    .sort(sortLockerValues);
}

export async function getMemberCommandCenterIndexSupabase(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
  page?: number;
  pageSize?: number;
}): Promise<MemberCommandCenterIndexResult> {
  const membersPage = await listMembersPageSupabase(filters);
  const members = membersPage.rows;
  if (members.length === 0) {
    return {
      rows: [],
      page: membersPage.page,
      pageSize: membersPage.pageSize,
      totalRows: membersPage.totalRows,
      totalPages: membersPage.totalPages
    };
  }
  const supabase = await createClient();
  const memberIds = members.map((row) => row.id);
  const [{ data: profilesData, error: profilesError }, { data: schedulesData, error: schedulesError }] = await Promise.all([
    supabase.from("member_command_centers").select("*").in("member_id", memberIds),
    supabase.from("member_attendance_schedules").select("*").in("member_id", memberIds)
  ]);
  const profiles = (() => {
    if (!profilesError) return (profilesData ?? []) as MemberCommandCenterRow[];
    if (isMissingTableError(profilesError, "member_command_centers")) {
      throw missingMccStorageError({
        objectName: "member_command_centers",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(profilesError.message);
  })();
  const schedules = (() => {
    if (!schedulesError) return (schedulesData ?? []) as MemberAttendanceScheduleRow[];
    if (isMissingTableError(schedulesError, "member_attendance_schedules")) {
      throw missingMccStorageError({
        objectName: "member_attendance_schedules",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(schedulesError.message);
  })();

  const profileByMember = new Map(profiles.map((row) => [row.member_id, row] as const));
  const scheduleByMember = new Map(schedules.map((row) => [row.member_id, row] as const));

  const missingProfileMemberIds = members
    .map((member) => member.id)
    .filter((memberId) => !profileByMember.has(memberId));
  if (missingProfileMemberIds.length > 0) {
    const ensuredProfiles = await Promise.all(
      missingProfileMemberIds.map((memberId) => ensureMemberCommandCenterProfileSupabase(memberId))
    );
    ensuredProfiles.forEach((profile) => {
      if (!profile) return;
      profileByMember.set(profile.member_id, profile);
    });
  }

  const missingScheduleMemberIds = members
    .map((member) => member.id)
    .filter((memberId) => !scheduleByMember.has(memberId));
  if (missingScheduleMemberIds.length > 0) {
    const ensuredSchedules = await Promise.all(
      missingScheduleMemberIds.map((memberId) => ensureMemberAttendanceScheduleSupabase(memberId))
    );
    ensuredSchedules.forEach((schedule, index) => {
      if (!schedule) {
        throw new Error(
          `Unable to ensure attendance schedule for member ${missingScheduleMemberIds[index]}.`
        );
      }
      scheduleByMember.set(schedule.member_id, schedule);
    });
  }

  const rows = members
    .map((member) => {
      const profile = profileByMember.get(member.id);
      if (!profile) {
        throw new Error(`Missing member command center profile for member ${member.id}.`);
      }
      const schedule = scheduleByMember.get(member.id);
      if (!schedule) {
        throw new Error(`Missing member attendance schedule for member ${member.id}.`);
      }
      return {
        member,
        profile,
        schedule,
        makeupBalance: schedule.make_up_days_available ?? 0,
        age: calculateAgeYears(member.dob),
        monthsEnrolled: calculateMonthsEnrolled(schedule.enrollment_date ?? member.enrollment_date)
      };
    })
    .sort((a, b) => sortByLastName(a.member.display_name, b.member.display_name));
  return {
    rows,
    page: membersPage.page,
    pageSize: membersPage.pageSize,
    totalRows: membersPage.totalRows,
    totalPages: membersPage.totalPages
  };
}

export async function getMemberCommandCenterDetailSupabase(memberId: string) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "getMemberCommandCenterDetailSupabase");
  const member = await getMemberSupabase(canonicalMemberId);
  if (!member) return null;
  const [
    { getMemberCarePlanSummary, getCarePlansForMember },
    { getLatestEnrollmentPacketPofStagingSummary }
  ] = await Promise.all([
    import("@/lib/services/care-plans-supabase"),
    import("@/lib/services/enrollment-packet-intake-staging")
  ]);
  const [profile, schedule, contacts, files, busStopDirectory, mhpAllergies, carePlanSummary, carePlans, enrollmentPacketIntakeAlert] = await Promise.all([
    ensureMemberCommandCenterProfileSupabase(canonicalMemberId),
    ensureMemberAttendanceScheduleSupabase(canonicalMemberId),
    listMemberContactsSupabase(canonicalMemberId),
    listMemberFilesSupabase(canonicalMemberId),
    listBusStopDirectorySupabase(),
    listMemberAllergiesSupabase(canonicalMemberId),
    getMemberCarePlanSummary(canonicalMemberId),
    getCarePlansForMember(canonicalMemberId),
    getLatestEnrollmentPacketPofStagingSummary(canonicalMemberId)
  ]);
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("intake_assessments")
    .select("id", { count: "exact", head: true })
    .eq("member_id", canonicalMemberId);
  if (error) {
    if (isMissingTableError(error, "intake_assessments")) {
      throw missingMccStorageError({
        objectName: "intake_assessments",
        migration: "0006_intake_pof_mhp_supabase.sql"
      });
    }
    throw new Error(error.message);
  }
  const safeAssessmentsCount = count ?? 0;

  return {
    member,
    profile,
    schedule: schedule
      ? {
          ...schedule,
          make_up_days_available: schedule.make_up_days_available ?? 0
        }
      : null,
    contacts,
    files,
    busStopDirectory,
    mhpAllergies,
    makeupBalance: schedule?.make_up_days_available ?? 0,
    makeupLedger: [] as MakeupLedgerRow[],
    assessmentsCount: safeAssessmentsCount,
    carePlansCount: carePlans.length,
    carePlanSummary,
    enrollmentPacketIntakeAlert,
    age: calculateAgeYears(member.dob),
    monthsEnrolled: calculateMonthsEnrolled(schedule?.enrollment_date ?? member.enrollment_date)
  };
}

export async function getTransportationAddRiderMemberOptionsSupabase() {
  const supabase = await createClient();
  const { data: membersData, error: membersError } = await supabase
    .from("members")
    .select("id, display_name, status")
    .eq("status", "active")
    .order("display_name", { ascending: true });
  if (membersError) throw new Error(membersError.message);
  const members = (membersData ?? []) as Array<{ id: string; display_name: string; status: "active" | "inactive" }>;
  if (members.length === 0) return [];
  const memberIds = members.map((row) => row.id);
  const [commandCentersResult, contactsResult] = await Promise.all([
    supabase.from("member_command_centers").select("*").in("member_id", memberIds),
    selectMemberContactsRows((selectClause) => supabase.from("member_contacts").select(selectClause).in("member_id", memberIds))
  ]);

  const commandCenters = (() => {
    if (!commandCentersResult.error) return (commandCentersResult.data ?? []) as MemberCommandCenterRow[];
    if (isMissingTableError(commandCentersResult.error, "member_command_centers")) {
      throw missingMccStorageError({
        objectName: "member_command_centers",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(commandCentersResult.error.message);
  })();

  const contacts = contactsResult;

  const commandCenterByMember = new Map(
    commandCenters.map((row) => [row.member_id, row] as const)
  );
  const { buildPreferredContactByMember } = await import("@/lib/services/member-contact-priority");
  const preferredContactByMember = buildPreferredContactByMember(contacts);

  const joinAddress = (parts: Array<string | null | undefined>) =>
    parts.map((value) => (value ?? "").trim()).filter(Boolean).join(", ") || null;

  return members.map((member) => {
    const commandCenter = commandCenterByMember.get(member.id);
    const preferredContact = preferredContactByMember.get(member.id);
    return {
      id: member.id,
      displayName: member.display_name,
      defaultDoorToDoorAddress: joinAddress([
        commandCenter?.street_address ?? null,
        commandCenter?.city ?? null,
        commandCenter?.state ?? null,
        commandCenter?.zip ?? null
      ]),
      defaultContactId: preferredContact?.id ?? null,
      defaultContactName: preferredContact?.contact_name ?? null,
      defaultContactPhone:
        preferredContact?.cellular_number ?? preferredContact?.home_number ?? preferredContact?.work_number ?? null,
      defaultContactAddress: joinAddress([
        preferredContact?.street_address ?? null,
        preferredContact?.city ?? null,
        preferredContact?.state ?? null,
        preferredContact?.zip ?? null
      ])
    };
  });
}
