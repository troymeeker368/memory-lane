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

export async function listMemberLookupSupabase(filters?: {
  q?: string;
  status?: "all" | "active" | "inactive";
}): Promise<MemberLookupRow[]> {
  const members = await listMemberNameLookupSupabase(filters);
  return members.map((row) => ({
    id: row.id,
    display_name: row.display_name,
    enrollment_date: row.enrollment_date ?? null,
    latest_assessment_track: row.latest_assessment_track ?? null
  }));
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

export async function listActiveMemberLookupSupabase(): Promise<MemberLookupRow[]> {
  return listMemberLookupSupabase({ status: "active" });
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
