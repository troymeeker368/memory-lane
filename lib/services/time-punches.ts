import "server-only";

import { createClient } from "@/lib/supabase/server";

type CreateTimePunchInput = {
  staffUserId: string;
  punchType: "in" | "out";
  punchAtIso: string;
  lat?: number | null;
  lng?: number | null;
  note?: string | null;
};

export async function createTimePunchSupabase(input: CreateTimePunchInput) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_punches")
    .insert({
      staff_user_id: input.staffUserId,
      punch_type: input.punchType,
      punch_at: input.punchAtIso,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      note: input.note ?? null
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Unable to create time punch: ${error.message}`);
  }

  return { id: String(data.id) };
}
