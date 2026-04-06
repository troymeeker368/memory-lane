import { createClient } from "@/lib/supabase/server";
import type {
  BusStopDirectoryRow,
  MakeupLedgerRow,
  MemberAllergyRow,
  MemberAttendanceScheduleRow,
  MemberCommandCenterIndexProfileRow,
  MemberCommandCenterIndexResult,
  MemberCommandCenterIndexScheduleRow,
  MemberCommandCenterRow,
  MemberFileRow
} from "@/lib/services/member-command-center-types";
import {
  calculateAgeYears,
  calculateMonthsEnrolled,
  getMccClient,
  isMissingAnyColumnError,
  isMissingTableError,
  missingMccStorageError,
  normalizeLocker,
  resolveMccMemberId,
  selectMemberContactsRows,
  sortByLastName,
  sortLockerValues,
  type EnsureCanonicalMemberOptions
} from "@/lib/services/member-command-center-core";
import {
  selectMemberLookupRowsWithFallback,
  selectMembersPageWithFallback,
  selectMembersWithFallback,
  selectMemberWithFallback
} from "@/lib/services/member-command-center-member-queries";
import {
  BUS_STOP_DIRECTORY_SELECT,
  LEGACY_INLINE_MEMBER_FILE_SENTINEL,
  MEMBER_ALLERGY_LIST_SELECT,
  MEMBER_ATTENDANCE_SCHEDULE_DETAIL_SELECT,
  MEMBER_COMMAND_CENTER_ADD_RIDER_ADDRESS_SELECT,
  MEMBER_COMMAND_CENTER_DETAIL_SELECT,
  MEMBER_COMMAND_CENTER_INDEX_PROFILE_SELECT,
  MEMBER_COMMAND_CENTER_INDEX_SCHEDULE_SELECT,
  toMemberCommandCenterIndexProfileRow,
  toMemberCommandCenterIndexScheduleRow
} from "@/lib/services/member-command-center-selects";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { buildSupabaseIlikePattern } from "@/lib/services/supabase-ilike";
const MEMBER_FILE_LIST_RPC = "rpc_list_member_files";
const MEMBER_FILE_LIST_MIGRATION = "0145_reports_and_member_files_read_rpcs.sql";
const DEFAULT_MEMBER_LOOKUP_LIMIT = 200;

export function buildMissingCanonicalMemberShellError(input: {
  memberId: string;
  table: "member_command_centers" | "member_attendance_schedules";
}) {
  const shellLabel =
    input.table === "member_command_centers" ? "Member Command Center shell" : "member attendance schedule";
  return new Error(
    `Missing canonical ${input.table} row for member ${input.memberId}. ${shellLabel} must be provisioned by canonical lead conversion or an explicit repair workflow before Member Command Center reads can succeed. Run \`npm run repair:historical-drift -- --apply\` or another explicit repair workflow for historical drift instead of relying on read-time backfill.`
  );
}

type MemberFileRpcRow = {
  id: string;
  member_id: string;
  file_name: string;
  file_type: string;
  storage_object_path: string | null;
  category: string;
  category_other: string | null;
  document_source: string | null;
  pof_request_id: string | null;
  uploaded_by_user_id: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
  updated_at: string;
  has_legacy_inline_data: boolean | null;
};

export async function listMembersSupabase(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
  limit?: number;
  allowUnbounded?: boolean;
}) {
  const supabase = await createClient();
  const q = (filters?.q ?? "").trim();
  const requestedLimit = filters?.limit;
  const normalizedLimit =
    Number.isFinite(requestedLimit) && Number(requestedLimit) > 0 ? Math.floor(Number(requestedLimit)) : null;
  const effectiveLimit = filters?.allowUnbounded ? normalizedLimit : normalizedLimit ?? DEFAULT_MEMBER_LOOKUP_LIMIT;

  return selectMembersWithFallback(
    async (selectClause) => {
      let query = supabase.from("members").select(selectClause);
      if (filters?.status && filters.status !== "all") {
        query = query.eq("status", filters.status);
      }
      if (q) {
        const pattern = buildSupabaseIlikePattern(q);
        query = query.or(`display_name.ilike.${pattern},locker_number.ilike.${pattern}`);
      }
      if (effectiveLimit !== null) {
        query = query.limit(effectiveLimit);
      }
      return query.order("display_name", { ascending: true });
    },
    isMissingAnyColumnError,
    "Unable to query members."
  );
}

export async function listMemberNameLookupSupabase(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
  limit?: number;
  requireQuery?: boolean;
}) {
  const supabase = await createClient();
  const q = (filters?.q ?? "").trim();
  const requireQuery = Boolean(filters?.requireQuery);
  if (requireQuery && !q) {
    return [];
  }
  return selectMemberLookupRowsWithFallback(
    async (selectClause) => {
      let query = supabase.from("members").select(selectClause);
      if (filters?.status && filters.status !== "all") {
        query = query.eq("status", filters.status);
      }
      if (q) {
        query = query.ilike("display_name", buildSupabaseIlikePattern(q));
      }
      query = query.order("display_name", { ascending: true });
      if (Number.isFinite(filters?.limit) && Number(filters?.limit) > 0) {
        query = query.limit(Math.floor(Number(filters?.limit)));
      }
      return query;
    },
    isMissingAnyColumnError,
    "Unable to query member lookup rows."
  );
}

export async function listMembersPageSupabase(filters?: {
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
      let query = supabase
        .from("members")
        .select(selectClause, { count: "exact" })
        .order("display_name", { ascending: true })
        .range((page - 1) * pageSize, page * pageSize - 1);
      if (filters?.status && filters.status !== "all") {
        query = query.eq("status", filters.status);
      }
      if (q) {
        const pattern = buildSupabaseIlikePattern(q);
        query = query.or(`display_name.ilike.${pattern},locker_number.ilike.${pattern}`);
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

export async function findActiveMemberByLockerNumberSupabase(
  lockerNumber: string,
  options?: { excludeMemberId?: string | null }
) {
  const normalizedLocker = normalizeLocker(lockerNumber);
  if (!normalizedLocker) return null;

  const excludeMemberId = String(options?.excludeMemberId ?? "").trim();
  const supabase = await createClient();
  let query = supabase
    .from("members")
    .select("id, display_name, locker_number")
    .eq("status", "active")
    .eq("locker_number", normalizedLocker)
    .order("display_name", { ascending: true })
    .limit(1);

  if (excludeMemberId) {
    query = query.neq("id", excludeMemberId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const row = ((data ?? []) as Array<{ id: string; display_name: string; locker_number: string | null }>)[0] ?? null;
  if (!row) return null;

  return {
    id: row.id,
    display_name: row.display_name,
    locker_number: normalizeLocker(row.locker_number)
  };
}

export async function getMemberSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "getMemberSupabase", options);
  const supabase = await getMccClient(options);
  return selectMemberWithFallback(
    (selectClause) => supabase.from("members").select(selectClause).eq("id", canonicalMemberId).maybeSingle(),
    isMissingAnyColumnError,
    "Unable to fetch member."
  );
}

async function getMemberCommandCenterProfileReadOnlySupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "getMemberCommandCenterProfileReadOnlySupabase", options);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_command_centers")
    .select(MEMBER_COMMAND_CENTER_DETAIL_SELECT)
    .eq("member_id", canonicalMemberId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error, "member_command_centers")) {
      throw missingMccStorageError({
        objectName: "member_command_centers",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(error.message);
  }
  return (data as MemberCommandCenterRow | null) ?? null;
}

async function getMemberAttendanceScheduleReadOnlySupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "getMemberAttendanceScheduleReadOnlySupabase", options);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_attendance_schedules")
    .select(MEMBER_ATTENDANCE_SCHEDULE_DETAIL_SELECT)
    .eq("member_id", canonicalMemberId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error, "member_attendance_schedules")) {
      throw missingMccStorageError({
        objectName: "member_attendance_schedules",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(error.message);
  }
  return (data as MemberAttendanceScheduleRow | null) ?? null;
}

export async function listMemberContactsSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listMemberContactsSupabase", options);
  const supabase = await createClient();
  return selectMemberContactsRows((selectClause) =>
    supabase
      .from("member_contacts")
      .select(selectClause)
      .eq("member_id", canonicalMemberId)
      .order("updated_at", { ascending: false })
  );
}

export async function listMemberFilesSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listMemberFilesSupabase", options);
  const supabase = await createClient();
  let rows: MemberFileRpcRow[];
  try {
    rows = await invokeSupabaseRpcOrThrow<MemberFileRpcRow[]>(supabase, MEMBER_FILE_LIST_RPC, {
      p_member_id: canonicalMemberId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to query member files.";
    if (message.includes(MEMBER_FILE_LIST_RPC)) {
      throw new Error(
        `Member files list RPC is not available. Apply Supabase migration ${MEMBER_FILE_LIST_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }

  return rows.map((row) => ({
    ...row,
    storage_object_path: row.storage_object_path ?? null,
    pof_request_id: row.pof_request_id ?? null,
    file_data_url: row.has_legacy_inline_data ? LEGACY_INLINE_MEMBER_FILE_SENTINEL : null
  })) as MemberFileRow[];
}

export async function listMemberAllergiesSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listMemberAllergiesSupabase", options);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_allergies")
    .select(MEMBER_ALLERGY_LIST_SELECT)
    .eq("member_id", canonicalMemberId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberAllergyRow[];
}

export async function listBusStopDirectorySupabase() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bus_stop_directory")
    .select(BUS_STOP_DIRECTORY_SELECT)
    .order("bus_stop_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BusStopDirectoryRow[];
}

export async function getAvailableLockerNumbersForMemberSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "getAvailableLockerNumbersForMemberSupabase", options);
  const supabase = await createClient();
  const [{ data: memberData, error: memberError }, { data: activeLockerData, error: activeLockerError }] = await Promise.all([
    supabase
      .from("members")
      .select("id, locker_number")
      .eq("id", canonicalMemberId)
      .maybeSingle(),
    supabase
      .from("members")
      .select("locker_number")
      .eq("status", "active")
      .neq("id", canonicalMemberId)
      .not("locker_number", "is", null)
  ]);
  if (memberError) throw new Error(memberError.message);
  if (activeLockerError) throw new Error(activeLockerError.message);
  const member = (memberData as { id: string; locker_number: string | null } | null) ?? null;
  const currentLocker = normalizeLocker(member?.locker_number ?? null);
  const usedByOtherActive = new Set(
    ((activeLockerData ?? []) as Array<{ locker_number: string | null }>)
      .map((row) => normalizeLocker(row.locker_number))
      .filter((value): value is string => Boolean(value))
  );
  const pool = new Set<string>();
  for (let locker = 1; locker <= 72; locker += 1) pool.add(String(locker));
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
  const memberIds = members.map((row) => row.id);
  const supabase = await createClient();
  const [{ data: profilesData, error: profilesError }, { data: schedulesData, error: schedulesError }] = await Promise.all([
    supabase.from("member_command_centers").select(MEMBER_COMMAND_CENTER_INDEX_PROFILE_SELECT).in("member_id", memberIds),
    supabase.from("member_attendance_schedules").select(MEMBER_COMMAND_CENTER_INDEX_SCHEDULE_SELECT).in("member_id", memberIds)
  ]);
  const profiles = (() => {
    if (!profilesError) {
      return ((profilesData ?? []) as Array<Pick<MemberCommandCenterRow, "member_id" | "profile_image_url">>).map(
        toMemberCommandCenterIndexProfileRow
      );
    }
    if (isMissingTableError(profilesError, "member_command_centers")) {
      throw missingMccStorageError({
        objectName: "member_command_centers",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(profilesError.message);
  })();
  const schedules = (() => {
    if (!schedulesError) {
      return ((schedulesData ?? []) as Array<
        Pick<
          MemberAttendanceScheduleRow,
          "member_id" | "enrollment_date" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "make_up_days_available"
        >
      >).map(toMemberCommandCenterIndexScheduleRow);
    }
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

  const rows = members
    .map((member) => {
      const profile = profileByMember.get(member.id);
      const schedule = scheduleByMember.get(member.id);
      if (!profile) {
        throw buildMissingCanonicalMemberShellError({
          memberId: member.id,
          table: "member_command_centers"
        });
      }
      if (!schedule) {
        throw buildMissingCanonicalMemberShellError({
          memberId: member.id,
          table: "member_attendance_schedules"
        });
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

export async function getMemberCommandCenterDetailSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "getMemberCommandCenterDetailSupabase", options);
  const canonicalOptions = { ...options, canonicalInput: true } satisfies EnsureCanonicalMemberOptions;
  const member = await getMemberSupabase(canonicalMemberId, canonicalOptions);
  if (!member) return null;
  const [{ getMemberCarePlanOverview }, { getLatestEnrollmentPacketPofStagingSummary }] =
    await Promise.all([
      import("@/lib/services/care-plans-read"),
      import("@/lib/services/enrollment-packet-intake-staging")
    ]);
  const [storedProfile, storedSchedule, contacts, files, mhpAllergies, carePlanOverview, enrollmentPacketIntakeAlert] = await Promise.all([
    getMemberCommandCenterProfileReadOnlySupabase(canonicalMemberId, canonicalOptions),
    getMemberAttendanceScheduleReadOnlySupabase(canonicalMemberId, canonicalOptions),
    listMemberContactsSupabase(canonicalMemberId, canonicalOptions),
    listMemberFilesSupabase(canonicalMemberId, canonicalOptions),
    listMemberAllergiesSupabase(canonicalMemberId, canonicalOptions),
    getMemberCarePlanOverview(canonicalMemberId, { canonicalInput: true }),
    getLatestEnrollmentPacketPofStagingSummary(canonicalMemberId, { canonicalInput: true })
  ]);
  if (!storedProfile) {
    throw buildMissingCanonicalMemberShellError({
      memberId: canonicalMemberId,
      table: "member_command_centers"
    });
  }
  if (!storedSchedule) {
    throw buildMissingCanonicalMemberShellError({
      memberId: canonicalMemberId,
      table: "member_attendance_schedules"
    });
  }
  const profile = storedProfile;
  const schedule = {
    ...storedSchedule,
    make_up_days_available: storedSchedule.make_up_days_available ?? 0
  };
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
    schedule,
    contacts,
    files,
    mhpAllergies,
    makeupBalance: schedule.make_up_days_available ?? 0,
    makeupLedger: [] as MakeupLedgerRow[],
    assessmentsCount: safeAssessmentsCount,
    carePlansCount: carePlanOverview.carePlanCount,
    carePlanSummary: carePlanOverview.carePlanSummary,
    enrollmentPacketIntakeAlert,
    age: calculateAgeYears(member.dob),
    monthsEnrolled: calculateMonthsEnrolled(schedule.enrollment_date ?? member.enrollment_date)
  };
}

export async function getTransportationAddRiderMemberOptionsSupabase(filters?: {
  q?: string;
  selectedId?: string | null;
  limit?: number;
}) {
  const supabase = await createClient();
  const q = (filters?.q ?? "").trim();
  const selectedId = String(filters?.selectedId ?? "").trim();
  const limit =
    Number.isFinite(filters?.limit) && Number(filters?.limit) > 0 ? Math.min(50, Math.floor(Number(filters?.limit))) : 25;
  if (q.length < 2 && !selectedId) {
    return [];
  }
  const [selectedMemberResult, searchMembersResult] = await Promise.all([
    selectedId
      ? supabase
          .from("members")
          .select("id, display_name, status")
          .eq("status", "active")
          .eq("id", selectedId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    q.length >= 2
      ? supabase
          .from("members")
          .select("id, display_name, status")
          .eq("status", "active")
          .ilike("display_name", buildSupabaseIlikePattern(q))
          .order("display_name", { ascending: true })
          .range(0, limit - 1)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (selectedMemberResult.error) throw new Error(selectedMemberResult.error.message);
  if (searchMembersResult.error) throw new Error(searchMembersResult.error.message);
  const memberMap = new Map<string, { id: string; display_name: string; status: "active" | "inactive" }>();
  const selectedMember = selectedMemberResult.data as { id: string; display_name: string; status: "active" | "inactive" } | null;
  if (selectedMember?.id) {
    memberMap.set(selectedMember.id, selectedMember);
  }
  for (const member of (searchMembersResult.data ?? []) as Array<{ id: string; display_name: string; status: "active" | "inactive" }>) {
    memberMap.set(member.id, member);
  }
  const members = Array.from(memberMap.values()).sort((left, right) => left.display_name.localeCompare(right.display_name));
  if (members.length === 0) return [];
  const memberIds = members.map((row) => row.id);
  const [commandCentersResult, contactsResult] = await Promise.all([
    supabase.from("member_command_centers").select(MEMBER_COMMAND_CENTER_ADD_RIDER_ADDRESS_SELECT).in("member_id", memberIds),
    selectMemberContactsRows((selectClause) => supabase.from("member_contacts").select(selectClause).in("member_id", memberIds))
  ]);

  const commandCenters = (() => {
    if (!commandCentersResult.error) {
      return (commandCentersResult.data ?? []) as Array<
        Pick<MemberCommandCenterRow, "member_id" | "street_address" | "city" | "state" | "zip">
      >;
    }
    if (isMissingTableError(commandCentersResult.error, "member_command_centers")) {
      throw missingMccStorageError({
        objectName: "member_command_centers",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(commandCentersResult.error.message);
  })();

  const commandCenterByMember = new Map(commandCenters.map((row) => [row.member_id, row] as const));
  const { buildPreferredContactByMember } = await import("@/lib/services/member-contact-priority");
  const preferredContactByMember = buildPreferredContactByMember(contactsResult);

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
