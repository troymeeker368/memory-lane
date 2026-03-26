import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentProfile, requireRoles } from "@/lib/auth";
import { insertAuditLogEntry } from "@/lib/services/audit-log-service";
import { saveGeneratedMemberPdfToFiles } from "@/lib/services/member-files";
import { MAR_MONTHLY_REPORT_TYPES } from "@/lib/services/mar-monthly-report";
import { buildMarMonthlyReportPdfDataUrl } from "@/lib/services/mar-monthly-report-pdf";
import { refreshMarWorkflowData } from "@/lib/services/mar-workflow-read";
import {
  createPrnOrderAndAdministration,
  documentPrnMarAdministration,
  documentPrnOutcomeAssessment,
  documentScheduledMarAdministration,
} from "@/lib/services/mar-workflow";
import {
  MAR_NOT_GIVEN_REASON_OPTIONS,
  MAR_PRN_OUTCOME_OPTIONS,
  MAR_PRN_STATUS_OPTIONS,
  type MarPrnOutcome
} from "@/lib/services/mar-shared";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";

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
  medicationOrderId: z.string().uuid(),
  indication: z.string().min(1).max(500),
  status: z.enum(MAR_PRN_STATUS_OPTIONS),
  doseGiven: z.string().max(200).optional().nullable(),
  routeGiven: z.string().max(120).optional().nullable(),
  symptomScoreBefore: z.number().int().min(0).max(10).optional().nullable(),
  followupDueAtIso: z.string().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  administeredAtIso: z.string().optional().nullable(),
  submissionId: z.string().min(1).max(200).optional().nullable()
});

const createPrnOrderAndAdministrationSchema = z.object({
  memberId: z.string().uuid(),
  physicianOrderId: z.string().uuid().optional().nullable(),
  medicationName: z.string().min(1).max(200),
  strength: z.string().max(120).optional().nullable(),
  form: z.string().max(120).optional().nullable(),
  route: z.string().max(120).optional().nullable(),
  directions: z.string().min(1).max(1000),
  prnReason: z.string().max(500).optional().nullable(),
  frequencyText: z.string().max(250).optional().nullable(),
  minIntervalMinutes: z.number().int().min(0).optional().nullable(),
  maxDosesPer24h: z.number().int().min(1).optional().nullable(),
  maxDailyDose: z.string().max(120).optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  providerName: z.string().min(1).max(200),
  requiresReview: z.boolean().optional(),
  requiresEffectivenessFollowup: z.boolean().optional(),
  indication: z.string().min(1).max(500),
  status: z.enum(MAR_PRN_STATUS_OPTIONS),
  doseGiven: z.string().max(200).optional().nullable(),
  routeGiven: z.string().max(120).optional().nullable(),
  symptomScoreBefore: z.number().int().min(0).max(10).optional().nullable(),
  followupDueAtIso: z.string().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  administeredAtIso: z.string().optional().nullable(),
  submissionId: z.string().min(1).max(200).optional().nullable()
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

const monthlyMarReportSchema = z.object({
  memberId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  reportType: z.enum(MAR_MONTHLY_REPORT_TYPES),
  saveToMemberFiles: z.boolean().optional().default(true)
});

async function insertAudit(action: string, entityType: string, entityId: string | null, details: Record<string, unknown>) {
  let actorUserId: string | null = null;
  let actorRole: string | null = null;
  try {
    const profile = await getCurrentProfile();
    actorUserId = profile.id;
    actorRole = profile.role;
    await insertAuditLogEntry({
      actorUserId,
      actorRole,
      action,
      entityType,
      entityId,
      details,
      serviceRole: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown audit log error.";
    console.error("[mar-actions] audit log insert failed after committed write", {
      action,
      entityType,
      entityId,
      message
    });
    try {
      await recordImmediateSystemAlert({
        entityType,
        entityId,
        actorUserId,
        severity: "medium",
        alertKey: "audit_log_insert_failed",
        metadata: {
          audit_action: action,
          actor_role: actorRole,
          error: message
        }
      });
    } catch (alertError) {
      const alertMessage = alertError instanceof Error ? alertError.message : "Unknown system alert error.";
      console.error("[mar-actions] system alert insert failed after audit log failure", {
        action,
        entityType,
        entityId,
        message: alertMessage
      });
    }
  }
}

function revalidateMarRoutes(memberId: string) {
  revalidatePath("/health");
  revalidatePath("/health/mar");
  revalidatePath(`/health/member-health-profiles/${memberId}`);
  revalidatePath(`/members/${memberId}`);
}

export async function refreshMarWorkflowAction() {
  await requireRoles(["admin", "manager", "director", "nurse"]);
  await refreshMarWorkflowData({ serviceRole: true });
  revalidatePath("/health");
  revalidatePath("/health/mar");
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

    if (!result.duplicateSafe) {
      await insertAudit("create_log", "mar_administration", result.administrationId, {
        source: "scheduled",
        status: payload.data.status,
        marScheduleId: payload.data.marScheduleId,
        memberId: result.memberId,
        notGivenReason: payload.data.notGivenReason ?? null
      });
    }

    revalidateMarRoutes(result.memberId);
    return {
      ok: true,
      administrationId: result.administrationId,
      memberId: result.memberId,
      administeredAt: result.administeredAt,
      administeredBy: profile.full_name,
      status: payload.data.status,
      notGivenReason: payload.data.notGivenReason ?? null,
      notes: payload.data.notes ?? null,
      duplicateSafe: result.duplicateSafe
    };
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
      medicationOrderId: payload.data.medicationOrderId,
      indication: payload.data.indication,
      status: payload.data.status,
      doseGiven: payload.data.doseGiven ?? null,
      routeGiven: payload.data.routeGiven ?? null,
      symptomScoreBefore: payload.data.symptomScoreBefore ?? null,
      followupDueAtIso: payload.data.followupDueAtIso ?? null,
      notes: payload.data.notes ?? null,
      administeredAtIso: payload.data.administeredAtIso ?? null,
      submissionId: payload.data.submissionId ?? null,
      serviceRole: true,
      actor: {
        userId: profile.id,
        fullName: profile.full_name
      }
    });

    if (!result.duplicateSafe) {
      await insertAudit("create_log", "mar_administration", result.administrationId, {
        source: "prn",
        medicationOrderId: payload.data.medicationOrderId,
        indication: payload.data.indication,
        status: payload.data.status,
        memberId: result.memberId
      });
    }

    revalidateMarRoutes(result.memberId);
    return {
      ok: true,
      administrationId: result.administrationId,
      memberId: result.memberId,
      medicationOrderId: result.medicationOrderId,
      administeredAt: result.administeredAt,
      administeredBy: profile.full_name,
      indication: payload.data.indication,
      status: payload.data.status,
      doseGiven: payload.data.doseGiven ?? null,
      routeGiven: payload.data.routeGiven ?? null,
      followupDueAt: result.followupDueAt ?? null,
      followupStatus: result.followupStatus,
      orderOption: result.orderOption,
      notes: payload.data.notes ?? null,
      duplicateSafe: result.duplicateSafe
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save PRN MAR administration." };
  }
}

export async function createPrnOrderAndAdministrationAction(raw: z.infer<typeof createPrnOrderAndAdministrationSchema>) {
  const payload = createPrnOrderAndAdministrationSchema.safeParse(raw);
  if (!payload.success) return { error: "Invalid PRN order input." };

  const profile = await requireRoles(["admin", "manager", "director", "nurse"]);

  try {
    const result = await createPrnOrderAndAdministration({
      memberId: payload.data.memberId,
      order: {
        physicianOrderId: payload.data.physicianOrderId ?? null,
        medicationName: payload.data.medicationName,
        strength: payload.data.strength ?? null,
        form: payload.data.form ?? null,
        route: payload.data.route ?? null,
        directions: payload.data.directions,
        prnReason: payload.data.prnReason ?? null,
        frequencyText: payload.data.frequencyText ?? null,
        minIntervalMinutes: payload.data.minIntervalMinutes ?? null,
        maxDosesPer24h: payload.data.maxDosesPer24h ?? null,
        maxDailyDose: payload.data.maxDailyDose ?? null,
        startDate: payload.data.startDate ?? null,
        endDate: payload.data.endDate ?? null,
        providerName: payload.data.providerName,
        requiresReview: payload.data.requiresReview ?? true,
        requiresEffectivenessFollowup: payload.data.requiresEffectivenessFollowup ?? true
      },
      administration: {
        administeredAtIso: payload.data.administeredAtIso ?? null,
        doseGiven: payload.data.doseGiven ?? null,
        routeGiven: payload.data.routeGiven ?? null,
        indication: payload.data.indication,
        symptomScoreBefore: payload.data.symptomScoreBefore ?? null,
        followupDueAtIso: payload.data.followupDueAtIso ?? null,
        status: payload.data.status,
        notes: payload.data.notes ?? null,
        submissionId: payload.data.submissionId ?? null
      },
      actor: {
        userId: profile.id,
        fullName: profile.full_name
      },
      serviceRole: true
    });

    await insertAudit("create_log", "medication_order", result.medicationOrderId, {
      source: "prn-create-and-administer",
      memberId: result.memberId,
      medicationName: payload.data.medicationName,
      providerName: payload.data.providerName,
      administrationId: result.administrationId
    });

    revalidateMarRoutes(result.memberId);
    return {
      ok: true,
      medicationOrderId: result.medicationOrderId,
      administrationId: result.administrationId,
      memberId: result.memberId,
      administeredAt: result.administeredAt,
      administeredBy: profile.full_name,
      indication: payload.data.indication,
      status: payload.data.status,
      followupDueAt: result.followupDueAt ?? null,
      followupStatus: result.followupStatus,
      orderOption: result.orderOption,
      notes: payload.data.notes ?? null,
      duplicateSafe: result.duplicateSafe
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create PRN order." };
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
    return {
      ok: true,
      administrationId: result.administrationId,
      memberId: result.memberId,
      prnOutcome: payload.data.prnOutcome,
      prnFollowupNote: payload.data.prnFollowupNote ?? null,
      outcomeAssessedAt: result.outcomeAssessedAt
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save PRN outcome." };
  }
}

function marReportTypeLabel(reportType: z.infer<typeof monthlyMarReportSchema>["reportType"]) {
  if (reportType === "detail") return "Detail";
  if (reportType === "exceptions") return "Exceptions";
  return "Summary";
}

export async function generateMonthlyMarReportPdfAction(raw: z.infer<typeof monthlyMarReportSchema>) {
  const payload = monthlyMarReportSchema.safeParse(raw);
  if (!payload.success) return { ok: false, error: "Invalid MAR monthly report input." } as const;

  const profile = await requireRoles(["admin", "manager", "director", "nurse"]);
  const generatedAtIso = toEasternISO();

  try {
    const generated = await buildMarMonthlyReportPdfDataUrl({
      memberId: payload.data.memberId,
      month: payload.data.month,
      reportType: payload.data.reportType,
      generatedAtIso,
      serviceRole: true,
      generatedBy: {
        name: profile.full_name,
        role: profile.role
      }
    });

    try {
      await saveGeneratedMemberPdfToFiles({
        memberId: generated.report.member.id,
        memberName: generated.report.member.fullName,
        documentLabel: `MAR ${marReportTypeLabel(payload.data.reportType)} ${payload.data.month}`,
        fileNameOverride: generated.fileName,
        documentSource: `MAR Monthly Report:${generated.report.member.id}:${payload.data.month}:${payload.data.reportType}`,
        category: "Health Unit",
        dataUrl: generated.dataUrl,
        uploadedBy: {
          id: profile.id,
          name: profile.full_name
        },
        generatedAtIso,
        replaceExistingByDocumentSource: true
      });
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? `MAR report generation succeeded, but saving to member files failed: ${error.message}`
            : "MAR report generation succeeded, but saving to member files failed."
      } as const;
    }

    await insertAudit("create_log", "mar_monthly_report", generated.report.member.id, {
      memberId: generated.report.member.id,
      month: payload.data.month,
      reportType: payload.data.reportType,
      generatedAtIso,
      savedToMemberFiles: true,
      partialRecordsDetected: generated.report.dataQuality.partialRecordsDetected
    });

    revalidateMarRoutes(generated.report.member.id);
    return {
      ok: true,
      fileName: generated.fileName,
      dataUrl: generated.dataUrl,
      reportMeta: {
        hasMedicationRecords: generated.report.dataQuality.hasMedicationRecords,
        hasMarDataForMonth: generated.report.dataQuality.hasMarDataForMonth,
        partialRecordsDetected: generated.report.dataQuality.partialRecordsDetected,
        warnings: generated.report.dataQuality.warnings
      }
    } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to generate monthly MAR report."
    } as const;
  }
}
