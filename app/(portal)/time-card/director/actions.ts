"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import {
  addDirectorCorrectionPunch,
  addPtoEntry,
  approveDailyTimecard,
  decideForgottenPunchRequest,
  decidePtoEntry,
  markDailyTimecardNeedsReview,
  setPayPeriodClosed,
  submitForgottenPunchRequest,
  updatePendingPtoEntry
} from "@/lib/services/director-timecards";
import { createClient } from "@/lib/supabase/server";

const DIRECTOR_BASE_PATH = "/time-card/director";
const FORGOTTEN_BASE_PATH = "/time-card/forgotten-punch";

function asText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function asNumber(formData: FormData, key: string) {
  const parsed = Number(asText(formData, key));
  return Number.isFinite(parsed) ? parsed : 0;
}

function asBoolean(formData: FormData, key: string) {
  const raw = asText(formData, key).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function toErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Invalid form submission.";
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "Action failed. Please try again.";
}

function resolveReturnPath(formData: FormData, fallbackPath: string) {
  const candidate = asText(formData, "returnPath");
  return candidate.startsWith("/") ? candidate : fallbackPath;
}

function buildPathWithStatus(
  basePath: string,
  status: { key: "success" | "error"; message: string }
) {
  const [pathAndQuery, hashPart] = basePath.split("#", 2);
  const [pathname, queryString] = pathAndQuery.split("?", 2);
  const params = new URLSearchParams(queryString ?? "");
  params.set(status.key, status.message);
  params.delete(status.key === "success" ? "error" : "success");
  const next = params.toString() ? `${pathname}?${params.toString()}` : pathname;
  return hashPart ? `${next}#${hashPart}` : next;
}

function redirectWithStatus(path: string, status: { key: "success" | "error"; message: string }) {
  redirect(buildPathWithStatus(path, status));
}

async function requireDirectorRole() {
  const profile = await getCurrentProfile();
  const role = normalizeRoleKey(profile.role);
  if (role !== "admin" && role !== "director" && role !== "manager") {
    throw new Error("Director timecard actions require manager/director/admin access.");
  }
  return profile;
}

function revalidateTimecardRoutes() {
  revalidatePath("/time-card");
  revalidatePath("/time-card/punch-history");
  revalidatePath("/time-card/forgotten-punch");
  revalidatePath("/time-card/director");
}

async function resolveEmployeeName(employeeId: string, fallback?: string) {
  if (fallback) return fallback;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", employeeId)
    .maybeSingle();
  if (error) throw new Error(`Unable to resolve employee profile: ${error.message}`);
  const fullName = String(data?.full_name ?? "").trim();
  if (!fullName) {
    throw new Error("Unable to resolve employee profile name.");
  }
  return fullName;
}

type ActionOptions = {
  formData: FormData;
  fallbackPath: string;
  successMessage: string;
  requireDirector?: boolean;
  run: (profile: Awaited<ReturnType<typeof getCurrentProfile>>) => Promise<void>;
};

async function runAction(options: ActionOptions) {
  const returnPath = resolveReturnPath(options.formData, options.fallbackPath);
  try {
    const profile = options.requireDirector === false ? await getCurrentProfile() : await requireDirectorRole();
    await options.run(profile);
    revalidateTimecardRoutes();
  } catch (error) {
    console.error("[DirectorTimecards] action failed", error);
    redirectWithStatus(returnPath, { key: "error", message: toErrorMessage(error) });
    return;
  }

  redirectWithStatus(returnPath, { key: "success", message: options.successMessage });
}

const timecardIdSchema = z.object({
  timecardId: z.string().min(1),
  note: z.string().max(1000).optional()
});

async function handleApproveDailyTimecard(formData: FormData) {
  await runAction({
    formData,
    fallbackPath: DIRECTOR_BASE_PATH,
    successMessage: "Timecard approved.",
    run: async (profile) => {
      const parsed = timecardIdSchema.parse({
        timecardId: asText(formData, "timecardId"),
        note: asText(formData, "note") || undefined
      });
      await approveDailyTimecard({
        timecardId: parsed.timecardId,
        approverName: profile.full_name,
        role: profile.role,
        note: parsed.note ?? null
      });
    }
  });
}

async function handleMarkNeedsReviewTimecard(formData: FormData) {
  await runAction({
    formData,
    fallbackPath: DIRECTOR_BASE_PATH,
    successMessage: "Timecard marked as needs review.",
    run: async (profile) => {
      const parsed = timecardIdSchema.parse({
        timecardId: asText(formData, "timecardId"),
        note: asText(formData, "note") || undefined
      });
      await markDailyTimecardNeedsReview({
        timecardId: parsed.timecardId,
        role: profile.role,
        note: parsed.note ?? null
      });
    }
  });
}

const correctionSchema = z.object({
  employeeId: z.string().min(1),
  employeeName: z.string().optional(),
  workDate: z.string().min(10),
  type: z.enum(["in", "out"]),
  time: z.string().min(4),
  note: z.string().max(1000).optional()
});

async function handleAddDirectorCorrectionPunch(formData: FormData) {
  await runAction({
    formData,
    fallbackPath: DIRECTOR_BASE_PATH,
    successMessage: "Correction punch added.",
    run: async (profile) => {
      const parsed = correctionSchema.parse({
        employeeId: asText(formData, "employeeId"),
        employeeName: asText(formData, "employeeName") || undefined,
        workDate: asText(formData, "workDate"),
        type: asText(formData, "type"),
        time: asText(formData, "time"),
        note: asText(formData, "note") || undefined
      });
      const employeeName = await resolveEmployeeName(parsed.employeeId, parsed.employeeName);
      await addDirectorCorrectionPunch({
        employeeId: parsed.employeeId,
        employeeName,
        workDate: parsed.workDate,
        type: parsed.type,
        time: parsed.time,
        note: parsed.note ?? null,
        createdBy: profile.full_name,
        role: profile.role
      });
    }
  });
}

const forgotDecisionSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["approved", "denied"]),
  decisionNote: z.string().max(1000).optional()
});

async function handleDecideForgottenPunchRequest(formData: FormData) {
  await runAction({
    formData,
    fallbackPath: DIRECTOR_BASE_PATH,
    successMessage: "Forgotten punch decision saved.",
    run: async (profile) => {
      const parsed = forgotDecisionSchema.parse({
        requestId: asText(formData, "requestId"),
        decision: asText(formData, "decision"),
        decisionNote: asText(formData, "decisionNote") || undefined
      });
      await decideForgottenPunchRequest({
        requestId: parsed.requestId,
        decision: parsed.decision,
        decisionNote: parsed.decisionNote ?? null,
        approverName: profile.full_name,
        role: profile.role
      });
    }
  });
}

const ptoSchema = z.object({
  employeeId: z.string().min(1),
  employeeName: z.string().optional(),
  workDate: z.string().min(10),
  hours: z.number().min(0).max(24),
  type: z.enum(["vacation", "sick", "holiday", "personal"]),
  note: z.string().max(1000).optional()
});

async function handleAddPtoEntry(formData: FormData) {
  await runAction({
    formData,
    fallbackPath: DIRECTOR_BASE_PATH,
    successMessage: "PTO entry added.",
    run: async (profile) => {
      const parsed = ptoSchema.parse({
        employeeId: asText(formData, "employeeId"),
        employeeName: asText(formData, "employeeName") || undefined,
        workDate: asText(formData, "workDate"),
        hours: asNumber(formData, "hours"),
        type: asText(formData, "type"),
        note: asText(formData, "note") || undefined
      });
      const employeeName = await resolveEmployeeName(parsed.employeeId, parsed.employeeName);
      await addPtoEntry({
        employeeId: parsed.employeeId,
        employeeName,
        workDate: parsed.workDate,
        hours: parsed.hours,
        type: parsed.type,
        note: parsed.note ?? null,
        role: profile.role
      });
    }
  });
}

const updatePtoSchema = z.object({
  entryId: z.string().min(1),
  hours: z.number().min(0).max(24),
  type: z.enum(["vacation", "sick", "holiday", "personal"]),
  note: z.string().max(1000).optional()
});

async function handleUpdatePendingPtoEntry(formData: FormData) {
  await runAction({
    formData,
    fallbackPath: DIRECTOR_BASE_PATH,
    successMessage: "PTO entry updated.",
    run: async (profile) => {
      const parsed = updatePtoSchema.parse({
        entryId: asText(formData, "entryId"),
        hours: asNumber(formData, "hours"),
        type: asText(formData, "type"),
        note: asText(formData, "note") || undefined
      });
      await updatePendingPtoEntry({
        entryId: parsed.entryId,
        hours: parsed.hours,
        type: parsed.type,
        note: parsed.note ?? null,
        role: profile.role
      });
    }
  });
}

const decidePtoSchema = z.object({
  entryId: z.string().min(1),
  decision: z.enum(["approved", "denied"]),
  decisionNote: z.string().max(1000).optional()
});

async function handleDecidePtoEntry(formData: FormData) {
  await runAction({
    formData,
    fallbackPath: DIRECTOR_BASE_PATH,
    successMessage: "PTO decision saved.",
    run: async (profile) => {
      const parsed = decidePtoSchema.parse({
        entryId: asText(formData, "entryId"),
        decision: asText(formData, "decision"),
        decisionNote: asText(formData, "decisionNote") || undefined
      });
      await decidePtoEntry({
        entryId: parsed.entryId,
        decision: parsed.decision,
        approverName: profile.full_name,
        decisionNote: parsed.decisionNote ?? null,
        role: profile.role
      });
    }
  });
}

async function handleSetPayPeriodClosed(formData: FormData) {
  await runAction({
    formData,
    fallbackPath: DIRECTOR_BASE_PATH,
    successMessage: "Pay period status updated.",
    run: async (profile) => {
      await setPayPeriodClosed({
        payPeriodId: asText(formData, "payPeriodId"),
        isClosed: asBoolean(formData, "isClosed"),
        role: profile.role
      });
    }
  });
}

const submitForgottenSchema = z.object({
  workDate: z.string().min(10),
  requestType: z.enum(["missing_in", "missing_out", "full_shift", "edit_shift"]),
  requestedIn: z.string().optional(),
  requestedOut: z.string().optional(),
  reason: z.string().min(2).max(500),
  employeeNote: z.string().max(1000).optional()
});

async function handleSubmitForgottenPunchRequest(formData: FormData) {
  await runAction({
    formData,
    fallbackPath: FORGOTTEN_BASE_PATH,
    successMessage: "Forgotten punch request submitted.",
    requireDirector: false,
    run: async (profile) => {
      const parsed = submitForgottenSchema.parse({
        workDate: asText(formData, "workDate"),
        requestType: asText(formData, "requestType"),
        requestedIn: asText(formData, "requestedIn") || undefined,
        requestedOut: asText(formData, "requestedOut") || undefined,
        reason: asText(formData, "reason"),
        employeeNote: asText(formData, "employeeNote") || undefined
      });
      await submitForgottenPunchRequest({
        employeeId: profile.id,
        employeeName: profile.full_name,
        workDate: parsed.workDate,
        requestType: parsed.requestType,
        requestedIn: parsed.requestedIn ?? null,
        requestedOut: parsed.requestedOut ?? null,
        reason: parsed.reason,
        employeeNote: parsed.employeeNote ?? null
      });
    }
  });
}

const directorActionIntentSchema = z.enum([
  "approveDailyTimecard",
  "markNeedsReviewTimecard",
  "addDirectorCorrectionPunch",
  "decideForgottenPunchRequest",
  "addPtoEntry",
  "updatePendingPtoEntry",
  "decidePtoEntry",
  "setPayPeriodClosed",
  "submitForgottenPunchRequest"
]);

export async function submitDirectorTimecardAction(formData: FormData) {
  const intent = directorActionIntentSchema.safeParse(asText(formData, "intent"));
  if (!intent.success) {
    redirectWithStatus(resolveReturnPath(formData, DIRECTOR_BASE_PATH), {
      key: "error",
      message: "Unknown timecard action."
    });
  }

  switch (intent.data) {
    case "approveDailyTimecard":
      return handleApproveDailyTimecard(formData);
    case "markNeedsReviewTimecard":
      return handleMarkNeedsReviewTimecard(formData);
    case "addDirectorCorrectionPunch":
      return handleAddDirectorCorrectionPunch(formData);
    case "decideForgottenPunchRequest":
      return handleDecideForgottenPunchRequest(formData);
    case "addPtoEntry":
      return handleAddPtoEntry(formData);
    case "updatePendingPtoEntry":
      return handleUpdatePendingPtoEntry(formData);
    case "decidePtoEntry":
      return handleDecidePtoEntry(formData);
    case "setPayPeriodClosed":
      return handleSetPayPeriodClosed(formData);
    case "submitForgottenPunchRequest":
      return handleSubmitForgottenPunchRequest(formData);
  }
}
