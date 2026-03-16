"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import { createTimePunchSupabase } from "@/lib/services/time-punches";
import { toEasternISO } from "@/lib/timezone";

import { insertAudit } from "@/app/action-helpers";

const timePunchSchema = z.object({
  punchType: z.enum(["in", "out"]),
  lat: z.number().optional(),
  lng: z.number().optional(),
  note: z.string().max(500).optional()
});

export async function timePunchAction(raw: z.infer<typeof timePunchSchema>) {
  const payload = timePunchSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid time punch." };
  }

  const profile = await getCurrentProfile();
  if (normalizeRoleKey(profile.role) !== "program-assistant") {
    return { error: "Clock in/out is only available for Program Assistant users." };
  }

  let created;
  try {
    created = await createTimePunchSupabase({
      staffUserId: profile.id,
      punchType: payload.data.punchType,
      punchAtIso: toEasternISO(),
      lat: payload.data.lat ?? null,
      lng: payload.data.lng ?? null,
      note: payload.data.note ?? null
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save time punch." };
  }

  await insertAudit(payload.data.punchType === "in" ? "clock_in" : "clock_out", "time_punch", created.id, payload.data);
  revalidatePath("/time-card");
  revalidatePath("/time-card/punch-history");
  revalidatePath("/");
  return { ok: true };
}
