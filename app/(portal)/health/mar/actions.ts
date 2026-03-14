"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentProfile, requireRoles } from "@/lib/auth";
import {
  documentPrnMarAdministration,
  documentPrnOutcomeAssessment,
  documentScheduledMarAdministration,
} from "@/lib/services/mar-workflow";
import { MAR_NOT_GIVEN_REASON_OPTIONS, MAR_PRN_OUTCOME_OPTIONS, type MarPrnOutcome } from "@/lib/services/mar-shared";
import { createClient } from "@/lib/supabase/server";

const scheduledAdministrationSchema = z
  .object({
    marScheduleId: z.string().uuid(),
    status: z.enum(["Given", "Not Given"]),
    notGivenReason: z.enum(MAR_NOT_GIVEN_REASON_OPTIONS).optional().nullable(),
    notes: z.string().max(1000).optional().nullable()
  })
  .superRefine((value, ctx) => {
    if (value.status !== "Not Given") return;
    if (!value.notGivenReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notGivenReason"],
        message: "Not Given reason is required."
      });
      return;
    }
    if (value.notGivenReason === "Other" && !String(value.notes ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notes"],
        message: "A note is required when reason is Other."
      });
    }
  });

const prnAdministrationSchema = z.object({
  pofMedicationId: z.string().uuid(),
  prnReason: z.string().min(1).max(500),
  notes: z.string().max(1000).optional().nullable(),
  administeredAtIso: z.string().optional().nullable()
});

const prnOutcomeSchema = z
  .object({
    administrationId: z.string().uuid(),
    prnOutcome: z.enum(MAR_PRN_OUTCOME_OPTIONS),
    prnFollowupNote: z.string().max(1000).optional().nullable(),
    outcomeAssessedAtIso: z.string().optional().nullable()
  })
  .superRefine((value, ctx) => {
    if (value.prnOutcome !== "Ineffective") return;
    if (!String(value.prnFollowupNote ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prnFollowupNote"],
        message: "Follow-up note is required when PRN outcome is Ineffective."
      });
    }
  });

async function insertAudit(action: string, entityType: string, entityId: string | null, details: Record<string, unknown>) {
  const profile = await getCurrentProfile();
  const supabase = await createClient({ serviceRole: true });
  await supabase.from("audit_logs").insert({
    actor_user_id: profile.id,
    actor_role: profile.role,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details
  });
}

function revalidateMarRoutes(memberId: string) {
  revalidatePath("/health");
  revalidatePath("/health/mar");
  revalidatePath(`/health/member-health-profiles/${memberId}`);
  revalidatePath(`/members/${memberId}`);
}

export async function recordScheduledMarAdministrationAction(raw: z.infer<typeof scheduledAdministrationSchema>) {
  const payload = scheduledAdministrationSchema.safeParse(raw);
  if (!payload.success) return { error: "Invalid MAR administration input." };

  const profile = await requireRoles(["admin", "manager", "director", "nurse"]);

  try {
    const result = await documentScheduledMarAdministration({
      marScheduleId: payload.data.marScheduleId,
      status: payload.data.status,
      notGivenReason: payload.data.notGivenReason ?? null,
      notes: payload.data.notes ?? null,
      serviceRole: true,
      actor: {
        userId: profile.id,
        fullName: profile.full_name
      }
    });

    await insertAudit("create_log", "mar_administration", result.administrationId, {
      source: "scheduled",
      status: payload.data.status,
      marScheduleId: payload.data.marScheduleId,
      memberId: result.memberId,
      notGivenReason: payload.data.notGivenReason ?? null
    });

    revalidateMarRoutes(result.memberId);
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save scheduled MAR administration." };
  }
}

export async function recordPrnMarAdministrationAction(raw: z.infer<typeof prnAdministrationSchema>) {
  const payload = prnAdministrationSchema.safeParse(raw);
  if (!payload.success) return { error: "Invalid PRN administration input." };

  const profile = await requireRoles(["admin", "manager", "director", "nurse"]);

  try {
    const result = await documentPrnMarAdministration({
      pofMedicationId: payload.data.pofMedicationId,
      prnReason: payload.data.prnReason,
      notes: payload.data.notes ?? null,
      administeredAtIso: payload.data.administeredAtIso ?? null,
      serviceRole: true,
      actor: {
        userId: profile.id,
        fullName: profile.full_name
      }
    });

    await insertAudit("create_log", "mar_administration", result.administrationId, {
      source: "prn",
      pofMedicationId: payload.data.pofMedicationId,
      prnReason: payload.data.prnReason,
      memberId: result.memberId
    });

    revalidateMarRoutes(result.memberId);
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save PRN MAR administration." };
  }
}

export async function recordPrnOutcomeAction(raw: z.infer<typeof prnOutcomeSchema>) {
  const payload = prnOutcomeSchema.safeParse(raw);
  if (!payload.success) return { error: "Invalid PRN outcome input." };

  const profile = await requireRoles(["admin", "manager", "director", "nurse"]);

  try {
    const result = await documentPrnOutcomeAssessment({
      administrationId: payload.data.administrationId,
      prnOutcome: payload.data.prnOutcome as MarPrnOutcome,
      prnFollowupNote: payload.data.prnFollowupNote ?? null,
      outcomeAssessedAtIso: payload.data.outcomeAssessedAtIso ?? null,
      serviceRole: true,
      actor: {
        userId: profile.id,
        fullName: profile.full_name
      }
    });

    await insertAudit("create_log", "mar_administration", result.administrationId, {
      source: "prn-outcome",
      prnOutcome: payload.data.prnOutcome,
      outcomeAssessedAtIso: payload.data.outcomeAssessedAtIso ?? null,
      memberId: result.memberId
    });

    revalidateMarRoutes(result.memberId);
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save PRN outcome." };
  }
}
