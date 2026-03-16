"use server";

import {
  getStaffNameByIdSupabase,
  listActiveMemberLookupSupabase,
  listStaffLookupSupabase
} from "@/lib/services/shared-lookups-supabase";

export async function getStaffLookup() {
  return listStaffLookupSupabase();
}

export async function getMemberLookup() {
  return listActiveMemberLookupSupabase();
}

export async function resolveStaffName(staffId: string) {
  return getStaffNameByIdSupabase(staffId);
}
