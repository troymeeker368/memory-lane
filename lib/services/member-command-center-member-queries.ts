import "server-only";

type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

type MccMemberRowShape = {
  id: string;
  display_name: string;
  preferred_name: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  name: string | null;
  status: "active" | "inactive";
  locker_number: string | null;
  enrollment_date: string | null;
  discharge_date: string | null;
  discharge_reason: string | null;
  discharge_disposition: string | null;
  dob: string | null;
  city: string | null;
  code_status: string | null;
  latest_assessment_track: string | null;
  updated_at: string | null;
};

type MemberLookupRowShape = {
  id: string;
  display_name: string;
  status: "active" | "inactive";
  enrollment_date: string | null;
  latest_assessment_track: string | null;
};

const MCC_MEMBER_BASE_SELECT =
  "id, display_name, status, locker_number, enrollment_date, discharge_date, discharge_reason, discharge_disposition, dob, city, code_status, latest_assessment_track, updated_at";
const MCC_MEMBER_CURRENT_SELECT = `${MCC_MEMBER_BASE_SELECT}, preferred_name, first_name:legal_first_name, last_name:legal_last_name`;
const MEMBER_LOOKUP_SELECT = "id, display_name, status, enrollment_date, latest_assessment_track";
const MCC_MEMBER_SCHEMA_MIGRATION = "0011_member_command_center_aux_schema.sql";

function buildMccMemberSchemaOutOfDateError(error: PostgrestErrorLike | null | undefined, fallbackMessage: string) {
  const original = String(error?.message ?? fallbackMessage);
  return new Error(
    `Database schema is out of date for members in Member Command Center. Apply Supabase migration ${MCC_MEMBER_SCHEMA_MIGRATION} (and any earlier unapplied migrations), then refresh Supabase schema cache. Original error: ${original}`
  );
}

export function mapMccMemberRow(row: Record<string, unknown>): MccMemberRowShape {
  const displayName = String(row.display_name ?? "");
  const fallbackName = displayName.length > 0 ? displayName : null;
  return {
    id: String(row.id ?? ""),
    display_name: displayName,
    preferred_name: typeof row.preferred_name === "string" ? row.preferred_name : null,
    first_name: typeof row.first_name === "string" ? row.first_name : null,
    last_name: typeof row.last_name === "string" ? row.last_name : null,
    full_name: typeof row.full_name === "string" ? row.full_name : fallbackName,
    name: typeof row.name === "string" ? row.name : fallbackName,
    status: row.status === "inactive" ? "inactive" : "active",
    locker_number: typeof row.locker_number === "string" ? row.locker_number : null,
    enrollment_date: typeof row.enrollment_date === "string" ? row.enrollment_date : null,
    discharge_date: typeof row.discharge_date === "string" ? row.discharge_date : null,
    discharge_reason: typeof row.discharge_reason === "string" ? row.discharge_reason : null,
    discharge_disposition: typeof row.discharge_disposition === "string" ? row.discharge_disposition : null,
    dob: typeof row.dob === "string" ? row.dob : null,
    city: typeof row.city === "string" ? row.city : null,
    code_status: typeof row.code_status === "string" ? row.code_status : null,
    latest_assessment_track: typeof row.latest_assessment_track === "string" ? row.latest_assessment_track : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null
  };
}

async function runMemberQueryWithSchemaFallback<T extends { error: PostgrestErrorLike | null }>(
  runQuery: (selectClause: string) => PromiseLike<T>,
  isMissingAnyColumnError: (error: PostgrestErrorLike | null | undefined, tableName: string) => boolean,
  errorMessage: string
) {
  const current = await runQuery(MCC_MEMBER_CURRENT_SELECT);
  if (!current.error) return current;
  if (isMissingAnyColumnError(current.error, "members")) {
    throw buildMccMemberSchemaOutOfDateError(current.error, errorMessage);
  }
  return current;
}

function mapMemberLookupRow(row: Record<string, unknown>): MemberLookupRowShape {
  return {
    id: String(row.id ?? ""),
    display_name: String(row.display_name ?? ""),
    status: row.status === "inactive" ? "inactive" : "active",
    enrollment_date: typeof row.enrollment_date === "string" ? row.enrollment_date : null,
    latest_assessment_track: typeof row.latest_assessment_track === "string" ? row.latest_assessment_track : null
  };
}

export async function selectMembersWithFallback(
  runQuery: (selectClause: string) => PromiseLike<{ data: unknown[] | null; error: PostgrestErrorLike | null }>,
  isMissingAnyColumnError: (error: PostgrestErrorLike | null | undefined, tableName: string) => boolean,
  errorMessage: string
) {
  const { data, error } = await runMemberQueryWithSchemaFallback(runQuery, isMissingAnyColumnError, errorMessage);
  if (error) {
    throw new Error(error.message ?? errorMessage);
  }
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map((row) => mapMccMemberRow(row));
}

export async function selectMembersPageWithFallback(
  runQuery: (selectClause: string) => PromiseLike<{ data: unknown[] | null; error: PostgrestErrorLike | null; count?: number | null }>,
  isMissingAnyColumnError: (error: PostgrestErrorLike | null | undefined, tableName: string) => boolean,
  errorMessage: string
) {
  const { data, error, count } = await runMemberQueryWithSchemaFallback(runQuery, isMissingAnyColumnError, errorMessage);
  if (error) {
    throw new Error(error.message ?? errorMessage);
  }

  const rows = ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map((row) => mapMccMemberRow(row));
  return {
    rows,
    totalRows: count ?? rows.length
  };
}

export async function selectMemberLookupRowsWithFallback(
  runQuery: (selectClause: string) => PromiseLike<{ data: unknown[] | null; error: PostgrestErrorLike | null }>,
  isMissingAnyColumnError: (error: PostgrestErrorLike | null | undefined, tableName: string) => boolean,
  errorMessage: string
) {
  const { data, error } = await runQuery(MEMBER_LOOKUP_SELECT);
  if (error) {
    if (isMissingAnyColumnError(error, "members")) {
      throw buildMccMemberSchemaOutOfDateError(error, errorMessage);
    }
    throw new Error(error.message ?? errorMessage);
  }

  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map((row) => mapMemberLookupRow(row));
}

export async function selectMemberWithFallback(
  runQuery: (selectClause: string) => PromiseLike<{ data: unknown | null; error: PostgrestErrorLike | null }>,
  isMissingAnyColumnError: (error: PostgrestErrorLike | null | undefined, tableName: string) => boolean,
  errorMessage: string
) {
  const { data, error } = await runMemberQueryWithSchemaFallback(runQuery, isMissingAnyColumnError, errorMessage);
  if (error) {
    throw new Error(error.message ?? errorMessage);
  }

  if (!data || Array.isArray(data)) return null;
  return mapMccMemberRow(data as Record<string, unknown>);
}
