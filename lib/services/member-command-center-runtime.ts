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
import { listMemberPickerOptionsSupabase } from "@/lib/services/shared-lookups-supabase";
import { buildSupabaseIlikePattern } from "@/lib/services/supabase-ilike";
import {
  listSharedMemberIndexPageSupabase,
  listSharedMemberRowsSupabase
} from "@/lib/services/member-list-read";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
const DEFAULT_MEMBER_LOOKUP_LIMIT = 200;
const DEFAULT_MEMBER_FILE_PAGE_SIZE = 50;
const MAX_MEMBER_FILE_PAGE_SIZE = 100;
const CLINICAL_MEMBER_FILE_CATEGORIES = ["Assessment", "Care Plan", "Orders / POF", "Health Unit"] as const;

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

export interface MemberFileListPageResult {
  rows: MemberFileRow[];
  hasNextPage: boolean;
}

function normalizeMemberFilePageSize(rawPageSize?: number | null) {
  if (!Number.isFinite(rawPageSize) || !rawPageSize || rawPageSize < 1) {
    return DEFAULT_MEMBER_FILE_PAGE_SIZE;
  }
  return Math.min(MAX_MEMBER_FILE_PAGE_SIZE, Math.floor(Number(rawPageSize)));
}

function buildSupabaseQuotedInList(values: readonly string[]) {
  const encoded = values.map((value) => `"${value.replace(/"/g, '\\"')}"`);
  return `(${encoded.join(",")})`;
}

export async function listMembersSupabase(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
  limit?: number;
  allowUnbounded?: boolean;
}) {
  const q = (filters?.q ?? "").trim();
  const requestedLimit = filters?.limit;
  const normalizedLimit =
    Number.isFinite(requestedLimit) && Number(requestedLimit) > 0 ? Math.floor(Number(requestedLimit)) : null;
  const effectiveLimit = filters?.allowUnbounded ? normalizedLimit : normalizedLimit ?? DEFAULT_MEMBER_LOOKUP_LIMIT;

  return listSharedMemberRowsSupabase({
    q,
    status: filters?.status,
    limit: effectiveLimit,
    includeLockerSearch: true
  });
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
  return listSharedMemberIndexPageSupabase({
    ...filters,
    includeLockerSearch: true
  });
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
  const supabase = await getMccClient(options);
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
  const supabase = await getMccClient(options);
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
  const supabase = await getMccClient(options);
  return selectMemberContactsRows((selectClause) =>
    supabase
      .from("member_contacts")
      .select(selectClause)
      .eq("member_id", canonicalMemberId)
      .order("updated_at", { ascending: false })
  );
}

export async function listMemberFilesPageSupabase(
  memberId: string,
  input?: {
    offset?: number;
    pageSize?: number;
    includeClinicalCategories?: boolean;
    options?: EnsureCanonicalMemberOptions;
  }
): Promise<MemberFileListPageResult> {
  const canonicalMemberId = await resolveMccMemberId(
    memberId,
    "listMemberFilesPageSupabase",
    input?.options
  );
  const offset =
    Number.isFinite(input?.offset) && Number(input?.offset) > 0 ? Math.floor(Number(input?.offset)) : 0;
  const pageSize = normalizeMemberFilePageSize(input?.pageSize);
  const includeClinicalCategories = input?.includeClinicalCategories !== false;
  const supabase = createServiceRoleClient("member_file_list_read");
  let query = supabase
    .from("member_files")
    .select(
      "id, member_id, file_name, file_type, storage_object_path, category, category_other, document_source, pof_request_id, uploaded_by_user_id, uploaded_by_name, uploaded_at, updated_at"
    )
    .eq("member_id", canonicalMemberId)
    .order("uploaded_at", { ascending: false });

  if (!includeClinicalCategories) {
    query = query.not("category", "in", buildSupabaseQuotedInList(CLINICAL_MEMBER_FILE_CATEGORIES));
  }

  const { data, error } = await query.range(offset, offset + pageSize);

  if (error) {
    if (isMissingTableError(error, "member_files")) {
      throw missingMccStorageError({
        objectName: "member_files",
        migration: "0011_member_command_center_aux_schema.sql"
      });
    }
    throw new Error(error.message);
  }

  const fetchedRows = (data ?? []) as Array<Omit<MemberFileRpcRow, "has_legacy_inline_data">>;
  const pageRows = fetchedRows.slice(0, pageSize);
  const hasNextPage = fetchedRows.length > pageSize;
  const missingStorageIds = pageRows
    .filter((row) => !row.storage_object_path)
    .map((row) => row.id);

  const legacyInlineIds = new Set<string>();
  if (missingStorageIds.length > 0) {
    const { data: inlineData, error: inlineError } = await supabase
      .from("member_files")
      .select("id, file_data_url")
      .in("id", missingStorageIds);
    if (inlineError) {
      throw new Error(inlineError.message);
    }
    ((inlineData ?? []) as Array<{ id: string; file_data_url: string | null }>).forEach((row) => {
      if (row.file_data_url) {
        legacyInlineIds.add(String(row.id));
      }
    });
  }

  const rows = pageRows.map((row) => ({
    ...row,
    storage_object_path: row.storage_object_path ?? null,
    pof_request_id: row.pof_request_id ?? null,
    file_data_url: legacyInlineIds.has(row.id) ? LEGACY_INLINE_MEMBER_FILE_SENTINEL : null
  })) as MemberFileRow[];

  return {
    rows,
    hasNextPage
  };
}

export async function listMemberFilesSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const page = await listMemberFilesPageSupabase(memberId, {
    pageSize: MAX_MEMBER_FILE_PAGE_SIZE,
    options
  });
  return page.rows;
}

export async function listMemberAllergiesSupabase(memberId: string, options?: EnsureCanonicalMemberOptions) {
  const canonicalMemberId = await resolveMccMemberId(memberId, "listMemberAllergiesSupabase", options);
  const supabase = await getMccClient(options);
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
  const supabase = await getMccClient(options);
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
  const [storedProfile, storedSchedule, contacts, filesPage, mhpAllergies, carePlanOverview, enrollmentPacketIntakeAlert] = await Promise.all([
    getMemberCommandCenterProfileReadOnlySupabase(canonicalMemberId, canonicalOptions),
    getMemberAttendanceScheduleReadOnlySupabase(canonicalMemberId, canonicalOptions),
    listMemberContactsSupabase(canonicalMemberId, canonicalOptions),
    listMemberFilesPageSupabase(canonicalMemberId, { options: canonicalOptions }),
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
  const supabase = await getMccClient(canonicalOptions);
  const { data: assessmentRows, error } = await supabase
    .from("intake_assessments")
    .select("id")
    .eq("member_id", canonicalMemberId)
    .limit(1);
  if (error) {
    if (isMissingTableError(error, "intake_assessments")) {
      throw missingMccStorageError({
        objectName: "intake_assessments",
        migration: "0006_intake_pof_mhp_supabase.sql"
      });
    }
    throw new Error(error.message);
  }
  const safeAssessmentsCount = (assessmentRows ?? []).length > 0 ? 1 : 0;

  return {
    member,
    profile,
    schedule,
    contacts,
    files: filesPage.rows,
    filesHasNextPage: filesPage.hasNextPage,
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
  const q = (filters?.q ?? "").trim();
  const selectedId = String(filters?.selectedId ?? "").trim();
  const limit =
    Number.isFinite(filters?.limit) && Number(filters?.limit) > 0 ? Math.min(50, Math.floor(Number(filters?.limit))) : 25;
  const members = await listMemberPickerOptionsSupabase({
    q,
    selectedId,
    status: "active",
    limit,
    minQueryLength: 2
  });
  if (members.length === 0) return [];

  const supabase = await createClient();
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
