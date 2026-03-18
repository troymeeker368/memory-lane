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
  dob: string | null;
  city: string | null;
  code_status: string | null;
  latest_assessment_track: string | null;
};

const MCC_MEMBER_SELECT =
  "id, display_name, preferred_name, first_name, last_name, full_name, name, status, locker_number, enrollment_date, dob, city, code_status, latest_assessment_track";
const MCC_MEMBER_SCHEMA_MIGRATION = "0011_member_command_center_aux_schema.sql";

function buildMccMemberSchemaOutOfDateError(error: PostgrestErrorLike | null | undefined, fallbackMessage: string) {
  const original = String(error?.message ?? fallbackMessage);
  return new Error(
    `Database schema is out of date for members in Member Command Center. Apply Supabase migration ${MCC_MEMBER_SCHEMA_MIGRATION} (and any earlier unapplied migrations), then refresh Supabase schema cache. Original error: ${original}`
  );
}

export function mapMccMemberRow(row: Record<string, unknown>): MccMemberRowShape {
  return {
    id: String(row.id ?? ""),
    display_name: String(row.display_name ?? ""),
    preferred_name: typeof row.preferred_name === "string" ? row.preferred_name : null,
    first_name: typeof row.first_name === "string" ? row.first_name : null,
    last_name: typeof row.last_name === "string" ? row.last_name : null,
    full_name: typeof row.full_name === "string" ? row.full_name : null,
    name: typeof row.name === "string" ? row.name : null,
    status: row.status === "inactive" ? "inactive" : "active",
    locker_number: typeof row.locker_number === "string" ? row.locker_number : null,
    enrollment_date: typeof row.enrollment_date === "string" ? row.enrollment_date : null,
    dob: typeof row.dob === "string" ? row.dob : null,
    city: typeof row.city === "string" ? row.city : null,
    code_status: typeof row.code_status === "string" ? row.code_status : null,
    latest_assessment_track: typeof row.latest_assessment_track === "string" ? row.latest_assessment_track : null
  };
}

export async function selectMembersWithFallback(
  runQuery: (selectClause: string) => PromiseLike<{ data: unknown[] | null; error: PostgrestErrorLike | null }>,
  isMissingAnyColumnError: (error: PostgrestErrorLike | null | undefined, tableName: string) => boolean,
  errorMessage: string
) {
  const { data, error } = await runQuery(MCC_MEMBER_SELECT);
  if (error) {
    if (isMissingAnyColumnError(error, "members")) {
      throw buildMccMemberSchemaOutOfDateError(error, errorMessage);
    }
    throw new Error(error.message ?? errorMessage);
  }
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map((row) => mapMccMemberRow(row));
}

export async function selectMembersPageWithFallback(
  runQuery: (selectClause: string) => PromiseLike<{ data: unknown[] | null; error: PostgrestErrorLike | null; count?: number | null }>,
  isMissingAnyColumnError: (error: PostgrestErrorLike | null | undefined, tableName: string) => boolean,
  errorMessage: string
) {
  const { data, error, count } = await runQuery(MCC_MEMBER_SELECT);
  if (error) {
    if (isMissingAnyColumnError(error, "members")) {
      throw buildMccMemberSchemaOutOfDateError(error, errorMessage);
    }
    throw new Error(error.message ?? errorMessage);
  }

  const rows = ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map((row) => mapMccMemberRow(row));
  return {
    rows,
    totalRows: count ?? rows.length
  };
}

export async function selectMemberWithFallback(
  runQuery: (selectClause: string) => PromiseLike<{ data: unknown | null; error: PostgrestErrorLike | null }>,
  isMissingAnyColumnError: (error: PostgrestErrorLike | null | undefined, tableName: string) => boolean,
  errorMessage: string
) {
  const { data, error } = await runQuery(MCC_MEMBER_SELECT);
  if (error) {
    if (isMissingAnyColumnError(error, "members")) {
      throw buildMccMemberSchemaOutOfDateError(error, errorMessage);
    }
    throw new Error(error.message ?? errorMessage);
  }

  if (!data || Array.isArray(data)) return null;
  return mapMccMemberRow(data as Record<string, unknown>);
}
