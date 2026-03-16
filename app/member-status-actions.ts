"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { MEMBER_DISCHARGE_REASON_OPTIONS, MEMBER_DISPOSITION_OPTIONS } from "@/lib/canonical";
import { updateMemberStatusSupabase } from "@/lib/services/member-status-supabase";

import { type ActionErrorResult, type ActionSuccessResult, insertAudit, requireManagerAdminEditor } from "@/app/action-helpers";

export async function setMemberStatusAction(raw: {
  memberId: string;
  status: "active" | "inactive";
  dischargeReason?: string;
  dischargeDisposition?: string;
}): Promise<ActionErrorResult | ActionSuccessResult> {
  const payload = z
    .object({
      memberId: z.string().min(1),
      status: z.enum(["active", "inactive"]),
      dischargeReason: z.string().trim().optional(),
      dischargeDisposition: z.string().trim().optional()
    })
    .superRefine((val, ctx) => {
      if (val.status !== "inactive") return;
      if (
        !val.dischargeReason ||
        !MEMBER_DISCHARGE_REASON_OPTIONS.includes(
          val.dischargeReason as (typeof MEMBER_DISCHARGE_REASON_OPTIONS)[number]
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dischargeReason"],
          message: "Discharge reason is required."
        });
      }
      if (
        !val.dischargeDisposition ||
        !MEMBER_DISPOSITION_OPTIONS.includes(
          val.dischargeDisposition as (typeof MEMBER_DISPOSITION_OPTIONS)[number]
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dischargeDisposition"],
          message: "Discharge disposition is required."
        });
      }
    })
    .safeParse(raw);
  if (!payload.success) return { error: "Invalid member status update." };

  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;

  try {
    await updateMemberStatusSupabase({
      memberId: payload.data.memberId,
      status: payload.data.status,
      dischargeReason: payload.data.dischargeReason ?? null,
      dischargeDisposition: payload.data.dischargeDisposition ?? null
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to update member status." };
  }

  await insertAudit("manager_review", "member", payload.data.memberId, {
    status: payload.data.status,
    dischargeReason: payload.data.dischargeReason ?? null,
    dischargeDisposition: payload.data.dischargeDisposition ?? null
  });

  revalidatePath("/members");
  revalidatePath(`/members/${payload.data.memberId}`);
  revalidatePath("/reports/member-summary");
  revalidatePath("/operations/member-command-center");
  revalidatePath(`/operations/member-command-center/${payload.data.memberId}`);
  revalidatePath("/operations/holds");
  revalidatePath("/operations/attendance");
  revalidatePath("/operations/transportation-station");
  revalidatePath("/operations/transportation-station/print");
  revalidatePath("/operations/locker-assignments");
  revalidatePath("/health/member-health-profiles");
  revalidatePath(`/health/member-health-profiles/${payload.data.memberId}`);
  return { ok: true };
}
