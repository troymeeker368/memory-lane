import { createClient } from "@/lib/supabase/server";
import { buildSupabaseIlikePattern } from "@/lib/services/supabase-ilike";
import { isMissingAnyColumnError } from "@/lib/services/member-command-center-core";
import {
  selectMembersPageWithFallback,
  selectMembersWithFallback
} from "@/lib/services/member-command-center-member-queries";
import type { MccMemberRow } from "@/lib/services/member-command-center-types";

export type SharedMemberIndexRow = MccMemberRow;
export type SharedMemberListRow = MccMemberRow;

export async function listSharedMemberRowsSupabase(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
  limit?: number | null;
  includeLockerSearch?: boolean;
}) {
  const supabase = await createClient();
  const requestedLimit =
    Number.isFinite(filters?.limit) && Number(filters?.limit) > 0 ? Math.floor(Number(filters?.limit)) : null;
  const q = (filters?.q ?? "").trim();
  const includeLockerSearch = filters?.includeLockerSearch === true;

  return selectMembersWithFallback(
    async (selectClause) => {
      let query = supabase.from("members").select(selectClause);
      if (filters?.status && filters.status !== "all") {
        query = query.eq("status", filters.status);
      }
      if (q) {
        const pattern = buildSupabaseIlikePattern(q);
        query = includeLockerSearch
          ? query.or(`display_name.ilike.${pattern},locker_number.ilike.${pattern}`)
          : query.ilike("display_name", pattern);
      }
      if (requestedLimit !== null) {
        query = query.limit(requestedLimit);
      }
      return query.order("display_name", { ascending: true });
    },
    isMissingAnyColumnError,
    "Unable to query members."
  );
}

export async function listSharedMemberIndexPageSupabase(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
  page?: number;
  pageSize?: number;
  includeLockerSearch?: boolean;
}) {
  const supabase = await createClient();
  const page = Number.isFinite(filters?.page) && Number(filters?.page) > 0 ? Math.floor(Number(filters?.page)) : 1;
  const pageSize =
    Number.isFinite(filters?.pageSize) && Number(filters?.pageSize) > 0 ? Math.floor(Number(filters?.pageSize)) : 25;
  const q = (filters?.q ?? "").trim();
  const includeLockerSearch = filters?.includeLockerSearch === true;

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
        query = includeLockerSearch
          ? query.or(`display_name.ilike.${pattern},locker_number.ilike.${pattern}`)
          : query.ilike("display_name", pattern);
      }
      return query;
    },
    isMissingAnyColumnError,
    "Unable to query members."
  );

  return {
    rows: rows as unknown as SharedMemberIndexRow[],
    page,
    pageSize,
    totalRows,
    totalPages: Math.max(1, Math.ceil(totalRows / pageSize))
  };
}
