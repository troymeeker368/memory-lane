"use server";

import { requireMemberHealthProfilesAccess } from "@/lib/auth";
import {
  searchHospitalPreferenceDirectoryOptionsSupabase,
  searchProviderDirectoryOptionsSupabase
} from "@/lib/services/member-health-profiles-supabase";

type DirectoryLookupRequest = {
  q?: string;
  limit?: number;
};

export async function searchMhpProviderDirectoryAction(input: DirectoryLookupRequest) {
  await requireMemberHealthProfilesAccess();
  return searchProviderDirectoryOptionsSupabase({
    q: input.q,
    limit: input.limit ?? 8
  });
}

export async function searchMhpHospitalPreferenceDirectoryAction(input: DirectoryLookupRequest) {
  await requireMemberHealthProfilesAccess();
  return searchHospitalPreferenceDirectoryOptionsSupabase({
    q: input.q,
    limit: input.limit ?? 8
  });
}
