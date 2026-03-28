import "server-only";

import { createClient } from "@/lib/supabase/server";
import { buildPreferredContactByMember } from "@/lib/services/member-contact-priority";
import type { MemberContactRow } from "@/lib/services/member-command-center-read";

export type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const MEMBER_CONTACT_MANIFEST_SELECT =
  "id, member_id, contact_name, category, cellular_number, work_number, home_number, street_address, city, state, zip, updated_at";

export async function listPreferredContactsByMemberSupabase(input: {
  memberIds: string[];
  onQueryError?: (error: PostgrestErrorLike) => never;
}) {
  if (input.memberIds.length === 0) {
    return new Map<string, MemberContactRow>();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_contacts")
    .select(MEMBER_CONTACT_MANIFEST_SELECT)
    .in("member_id", input.memberIds);

  if (error) {
    if (input.onQueryError) {
      return input.onQueryError(error);
    }
    throw new Error(error.message ?? "Unable to load preferred member contacts.");
  }

  return buildPreferredContactByMember((data ?? []) as MemberContactRow[]);
}

