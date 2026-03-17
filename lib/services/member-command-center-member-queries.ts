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

const MCC_MEMBER_SELECT_VARIANTS = [
  "id, display_name, preferred_name, first_name, last_name, full_name, name, status, locker_number, enrollment_date, dob, city, code_status, latest_assessment_track",
  "id, display_name, preferred_name, first_name, last_name, full_name, name, status, enrollment_date, dob, city, code_status, latest_assessment_track",
  "id, display_name, preferred_name, first_name, last_name, full_name, name, status, enrollment_date, dob, code_status, latest_assessment_track",
  "id, display_name, preferred_name, first_name, last_name, full_name, name, status, enrollment_date, dob",
  "id, display_name, preferred_name, first_name, last_name, full_name, name, status",
  "id, display_name, status, locker_number, enrollment_date, dob, city, code_status, latest_assessment_track",
  "id, display_name, status, enrollment_date, dob, city, code_status, latest_assessment_track",
  "id, display_name, status, enrollment_date, dob, code_status, latest_assessment_track",
  "id, display_name, status, enrollment_date, dob",
  "id, display_name, status"
] as const;

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
  let lastError: PostgrestErrorLike | null = null;

  for (const selectClause of MCC_MEMBER_SELECT_VARIANTS) {
    const { data, error } = await runQuery(selectClause);
    if (!error) {
      return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map((row) => mapMccMemberRow(row));
    }

    lastError = error;
    if (!isMissingAnyColumnError(error, "members")) {
      throw new Error(error.message ?? errorMessage);
    }
  }

  throw new Error(lastError?.message ?? errorMessage);
}

export async function selectMembersPageWithFallback(
  runQuery: (selectClause: string) => PromiseLike<{ data: unknown[] | null; error: PostgrestErrorLike | null; count?: number | null }>,
  isMissingAnyColumnError: (error: PostgrestErrorLike | null | undefined, tableName: string) => boolean,
  errorMessage: string
) {
  let lastError: PostgrestErrorLike | null = null;

  for (const selectClause of MCC_MEMBER_SELECT_VARIANTS) {
    const { data, error, count } = await runQuery(selectClause);
    if (!error) {
      const rows = ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map((row) => mapMccMemberRow(row));
      return {
        rows,
        totalRows: count ?? rows.length
      };
    }

    lastError = error;
    if (!isMissingAnyColumnError(error, "members")) {
      throw new Error(error.message ?? errorMessage);
    }
  }

  throw new Error(lastError?.message ?? errorMessage);
}

export async function selectMemberWithFallback(
  runQuery: (selectClause: string) => PromiseLike<{ data: unknown | null; error: PostgrestErrorLike | null }>,
  isMissingAnyColumnError: (error: PostgrestErrorLike | null | undefined, tableName: string) => boolean,
  errorMessage: string
) {
  let lastError: PostgrestErrorLike | null = null;

  for (const selectClause of MCC_MEMBER_SELECT_VARIANTS) {
    const { data, error } = await runQuery(selectClause);
    if (!error) {
      if (!data || Array.isArray(data)) return null;
      return mapMccMemberRow(data as Record<string, unknown>);
    }

    lastError = error;
    if (!isMissingAnyColumnError(error, "members")) {
      throw new Error(error.message ?? errorMessage);
    }
  }

  throw new Error(lastError?.message ?? errorMessage);
}
