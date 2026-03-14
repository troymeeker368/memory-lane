import { updateMemberSupabase } from "@/lib/services/member-command-center-supabase";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export async function updateMemberStatusSupabase(input: {
  memberId: string;
  status: "active" | "inactive";
  dischargeReason?: string | null;
  dischargeDisposition?: string | null;
}) {
  const updated = await updateMemberSupabase(input.memberId, {
    status: input.status,
    discharge_reason: input.dischargeReason ?? null,
    discharge_disposition: input.dischargeDisposition ?? null,
    discharge_date: input.status === "inactive" ? toEasternDate() : null,
    updated_at: toEasternISO()
  });
  if (!updated) {
    throw new Error("Member not found.");
  }
  return updated;
}
