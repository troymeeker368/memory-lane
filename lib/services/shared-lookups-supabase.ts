import { listMemberNameLookupSupabase } from "@/lib/services/member-command-center-read";
import { createClient } from "@/lib/supabase/server";

export type StaffLookupRow = {
  id: string;
  full_name: string;
  role: string;
};

export type MemberLookupRow = {
  id: string;
  display_name: string;
  enrollment_date?: string | null;
  latest_assessment_track?: string | null;
};

const DEFAULT_MEMBER_LOOKUP_LIMIT = 200;

function normalizeMemberLookupLimit(input?: {
  limit?: number;
  allowUnbounded?: boolean;
}): number | undefined {
  const requestedLimit = input?.limit;
  const explicitLimit =
    Number.isFinite(requestedLimit) && Number(requestedLimit) > 0 ? Math.floor(Number(requestedLimit)) : undefined;
  if (input?.allowUnbounded) {
    return explicitLimit;
  }
  return explicitLimit ?? DEFAULT_MEMBER_LOOKUP_LIMIT;
}

export async function listMemberLookupSupabase(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
  limit?: number;
  requireQuery?: boolean;
  allowUnbounded?: boolean;
}): Promise<MemberLookupRow[]> {
  const safeLimit = normalizeMemberLookupLimit({
    limit: filters?.limit,
    allowUnbounded: filters?.allowUnbounded
  });
  const members = await listMemberNameLookupSupabase({
    ...filters,
    limit: safeLimit
  });
  return members.map((row) => ({
    id: row.id,
    display_name: row.display_name,
    enrollment_date: row.enrollment_date ?? null,
    latest_assessment_track: row.latest_assessment_track ?? null
  }));
}

export async function listAllMemberLookupSupabase(filters?: {
  status?: "all" | "active" | "inactive";
  limit?: number;
  allowUnbounded?: boolean;
}): Promise<MemberLookupRow[]> {
  return listMemberLookupSupabase({
    status: filters?.status ?? "all",
    limit: filters?.limit,
    allowUnbounded: filters?.allowUnbounded
  });
}

export async function listMemberSearchLookupSupabase(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
  limit?: number;
  minQueryLength?: number;
  allowUnbounded?: boolean;
}): Promise<MemberLookupRow[]> {
  const q = String(filters?.q ?? "").trim();
  const minQueryLength =
    Number.isFinite(filters?.minQueryLength) && Number(filters?.minQueryLength) > 0
      ? Math.floor(Number(filters?.minQueryLength))
      : 2;
  if (q.length < minQueryLength) {
    return [];
  }
  const safeLimit = normalizeMemberLookupLimit({
    limit: filters?.limit,
    allowUnbounded: filters?.allowUnbounded
  });

  return listMemberLookupSupabase({
    q,
    status: filters?.status ?? "active",
    limit: safeLimit,
    allowUnbounded: filters?.allowUnbounded,
    requireQuery: true
  });
}

export async function listStaffLookupSupabase(): Promise<StaffLookupRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, full_name, role").order("full_name");
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    full_name: String(row.full_name ?? ""),
    role: String(row.role ?? "")
  }));
}

export async function listMemberLookupByIdsSupabase(memberIds: string[]): Promise<MemberLookupRow[]> {
  const normalizedIds = Array.from(new Set(memberIds.map((value) => String(value ?? "").trim()).filter(Boolean)));
  if (normalizedIds.length === 0) {
    return [];
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .select("id, display_name, enrollment_date, latest_assessment_track")
    .in("id", normalizedIds)
    .order("display_name", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as Array<{
    id: string;
    display_name: string | null;
    enrollment_date?: string | null;
    latest_assessment_track?: string | null;
  }>).map((row) => ({
    id: String(row.id),
    display_name: String(row.display_name ?? ""),
    enrollment_date: row.enrollment_date ?? null,
    latest_assessment_track: row.latest_assessment_track ?? null
  }));
}

export async function listActiveMemberLookupSupabase(): Promise<MemberLookupRow[]> {
  return listMemberLookupSupabase({ status: "active" });
}

export async function listAllActiveMemberLookupSupabase(): Promise<MemberLookupRow[]> {
  return listAllMemberLookupSupabase({ status: "active" });
}

export async function getStaffNameByIdSupabase(staffId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("full_name").eq("id", staffId).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  const name = String(data?.full_name ?? "").trim();
  return name || null;
}
