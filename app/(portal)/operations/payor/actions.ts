"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth";
import { addMockRecord, getMockDb, removeMockRecord, updateMockRecord } from "@/lib/mock-repo";
import {
  CLOSURE_RULE_OBSERVED_WEEKEND_OPTIONS,
  CLOSURE_RULE_OCCURRENCE_OPTIONS,
  CLOSURE_RULE_TYPE_OPTIONS,
  CLOSURE_RULE_WEEKDAY_OPTIONS
} from "@/lib/services/closure-rules";
import {
  BILLING_ADJUSTMENT_TYPE_OPTIONS,
  BILLING_BATCH_TYPE_OPTIONS,
  BILLING_EXPORT_TYPES,
  BILLING_MODE_OPTIONS,
  CENTER_CLOSURE_TYPE_OPTIONS,
  MONTHLY_BILLING_BASIS_OPTIONS,
  ensureCenterClosuresForCurrentAndNextYear,
  createCustomInvoice,
  createEnrollmentProratedInvoice,
  createBillingExport,
  finalizeInvoice,
  finalizeBillingBatch,
  generateBillingBatch,
  reopenBillingBatch,
  setVariableChargeBillingStatus,
  validateCenterBillingSettingOverlap,
  validateMemberBillingSettingOverlap,
  validateScheduleTemplateOverlap
} from "@/lib/services/billing";
import { normalizeRoleKey } from "@/lib/permissions";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

type CustomInvoiceManualLineInput = NonNullable<Parameters<typeof createCustomInvoice>[0]["manualLineItems"]>[number];

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function asNullableString(formData: FormData, key: string) {
  const value = asString(formData, key);
  return value.length > 0 ? value : null;
}

function asNumber(formData: FormData, key: string, fallback = 0) {
  const parsed = Number(asString(formData, key));
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function asBoolean(formData: FormData, key: string, fallback = false) {
  const raw = asString(formData, key).toLowerCase();
  if (raw === "true" || raw === "on" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return fallback;
}

function asDateOnly(formData: FormData, key: string, fallback = toEasternDate()) {
  const value = asString(formData, key).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

async function requireBillingProfile() {
  const profile = await getCurrentProfile();
  const role = normalizeRoleKey(profile.role);
  if (role !== "admin" && role !== "manager" && role !== "director" && role !== "coordinator") {
    throw new Error("You do not have access to billing workflows.");
  }
  return profile;
}

async function requireFinalizeRole() {
  const profile = await requireBillingProfile();
  const role = normalizeRoleKey(profile.role);
  if (role !== "admin" && role !== "manager" && role !== "director") {
    return { ok: false as const, error: "Only admin/manager/director can finalize billing batches." };
  }
  return { ok: true as const, profile };
}

async function requireReopenRole() {
  const profile = await requireBillingProfile();
  const role = normalizeRoleKey(profile.role);
  if (role !== "admin" && role !== "manager") {
    return { ok: false as const, error: "Only admin/manager can reopen finalized billing batches." };
  }
  return { ok: true as const, profile };
}

function revalidateBillingPaths() {
  revalidatePath("/operations/payor");
  revalidatePath("/operations/payor/billing-agreements");
  revalidatePath("/operations/payor/center-closures");
  revalidatePath("/operations/payor/schedule-templates");
  revalidatePath("/operations/payor/variable-charges");
  revalidatePath("/operations/payor/billing-batches");
  revalidatePath("/operations/payor/custom-invoices");
  revalidatePath("/operations/payor/invoices/draft");
  revalidatePath("/operations/payor/invoices/finalized");
  revalidatePath("/operations/payor/exports");
  revalidatePath("/operations/payor/revenue-dashboard");
  revalidatePath("/operations/member-command-center/attendance-billing");
}

function redirectWithError(path: string, error: string, params?: Record<string, string>): never {
  const qs = new URLSearchParams(params);
  qs.set("error", error);
  redirect(`${path}?${qs.toString()}`);
}

export async function saveCenterBillingSettingAction(formData: FormData) {
  const profile = await requireBillingProfile();
  const id = asString(formData, "id");
  const now = toEasternISO();
  const effectiveStartDate = asDateOnly(formData, "effectiveStartDate");
  const effectiveEndDate = asNullableString(formData, "effectiveEndDate");
  const active = asBoolean(formData, "active", false);

  const overlap = validateCenterBillingSettingOverlap({
    effectiveStartDate,
    effectiveEndDate,
    active,
    excludeId: id || undefined
  });
  if (!overlap.ok) throw new Error(overlap.error);

  const payload = {
    default_daily_rate: asNumber(formData, "defaultDailyRate", 0),
    default_extra_day_rate: asNullableString(formData, "defaultExtraDayRate")
      ? asNumber(formData, "defaultExtraDayRate", 0)
      : null,
    default_transport_one_way_rate: asNumber(formData, "defaultTransportOneWayRate", 0),
    default_transport_round_trip_rate: asNumber(formData, "defaultTransportRoundTripRate", 0),
    billing_cutoff_day: Math.max(1, Math.min(31, Math.round(asNumber(formData, "billingCutoffDay", 25)))),
    default_billing_mode: asString(formData, "defaultBillingMode") === "Monthly" ? ("Monthly" as const) : ("Membership" as const),
    effective_start_date: effectiveStartDate,
    effective_end_date: effectiveEndDate,
    active,
    updated_at: now,
    updated_by_user_id: profile.id,
    updated_by_name: profile.full_name
  };

  if (id) {
    const updated = updateMockRecord("centerBillingSettings", id, payload);
    if (!updated) throw new Error("Center billing setting not found.");
  } else {
    addMockRecord("centerBillingSettings", {
      ...payload,
      created_at: now
    });
  }

  revalidateBillingPaths();
}

export async function saveCenterClosureAction(formData: FormData) {
  const profile = await requireBillingProfile();
  const id = asString(formData, "id");
  const now = toEasternISO();
  const closureTypeInput = asString(formData, "closureType");
  const closureType = CENTER_CLOSURE_TYPE_OPTIONS.includes(closureTypeInput as (typeof CENTER_CLOSURE_TYPE_OPTIONS)[number])
    ? (closureTypeInput as (typeof CENTER_CLOSURE_TYPE_OPTIONS)[number])
    : ("Holiday" as const);

  const payload = {
    closure_date: asDateOnly(formData, "closureDate"),
    closure_name: asString(formData, "closureName") || "Center Closure",
    closure_type: closureType,
    billable_override: asBoolean(formData, "billableOverride", false),
    notes: asNullableString(formData, "notes"),
    active: asBoolean(formData, "active", false),
    updated_at: now,
    updated_by_user_id: profile.id,
    updated_by_name: profile.full_name
  };

  if (id) {
    const updated = updateMockRecord("centerClosures", id, payload);
    if (!updated) throw new Error("Center closure not found.");
  } else {
    addMockRecord("centerClosures", {
      ...payload,
      created_at: now
    });
  }

  revalidateBillingPaths();
}

export async function saveClosureRuleAction(formData: FormData) {
  const profile = await requireBillingProfile();
  const id = asString(formData, "id");
  if (!id) throw new Error("Closure rule id is required.");

  const ruleTypeInput = asString(formData, "ruleType");
  const observedInput = asString(formData, "observedWhenWeekend");
  const weekdayInput = asString(formData, "weekday");
  const occurrenceInput = asString(formData, "occurrence");
  const ruleType = CLOSURE_RULE_TYPE_OPTIONS.includes(ruleTypeInput as (typeof CLOSURE_RULE_TYPE_OPTIONS)[number])
    ? (ruleTypeInput as (typeof CLOSURE_RULE_TYPE_OPTIONS)[number])
    : ("fixed" as const);
  const observedWhenWeekend = CLOSURE_RULE_OBSERVED_WEEKEND_OPTIONS.includes(
    observedInput as (typeof CLOSURE_RULE_OBSERVED_WEEKEND_OPTIONS)[number]
  )
    ? (observedInput as (typeof CLOSURE_RULE_OBSERVED_WEEKEND_OPTIONS)[number])
    : ("none" as const);
  const weekday = CLOSURE_RULE_WEEKDAY_OPTIONS.includes(
    weekdayInput as (typeof CLOSURE_RULE_WEEKDAY_OPTIONS)[number]
  )
    ? (weekdayInput as (typeof CLOSURE_RULE_WEEKDAY_OPTIONS)[number])
    : null;
  const occurrence = CLOSURE_RULE_OCCURRENCE_OPTIONS.includes(
    occurrenceInput as (typeof CLOSURE_RULE_OCCURRENCE_OPTIONS)[number]
  )
    ? (occurrenceInput as (typeof CLOSURE_RULE_OCCURRENCE_OPTIONS)[number])
    : null;

  const now = toEasternISO();
  const payload = {
    name: asString(formData, "name") || "Closure Rule",
    rule_type: ruleType,
    month: Math.min(12, Math.max(1, Math.round(asNumber(formData, "month", 1)))),
    day:
      ruleType === "fixed"
        ? Math.min(31, Math.max(1, Math.round(asNumber(formData, "day", 1))))
        : null,
    weekday,
    occurrence,
    observed_when_weekend: observedWhenWeekend,
    active: asBoolean(formData, "active", false),
    updated_at: now,
    updated_by_user_id: profile.id,
    updated_by_name: profile.full_name
  };
  const updated = updateMockRecord("closureRules", id, payload);
  if (!updated) throw new Error("Closure rule not found.");

  ensureCenterClosuresForCurrentAndNextYear({
    generatedByUserId: profile.id,
    generatedByName: profile.full_name
  });
  revalidateBillingPaths();
}

export async function deleteCenterClosureAction(formData: FormData) {
  const profile = await requireBillingProfile();
  const id = asString(formData, "id");
  if (!id) throw new Error("Center closure id is required.");
  const existing = getMockDb().centerClosures.find((row) => row.id === id) ?? null;
  if (existing?.auto_generated) {
    const updated = updateMockRecord("centerClosures", id, {
      active: false,
      notes: existing.notes ?? "Auto-generated closure manually removed.",
      updated_at: toEasternISO(),
      updated_by_user_id: profile.id,
      updated_by_name: profile.full_name
    });
    if (!updated) throw new Error("Center closure not found.");
    revalidateBillingPaths();
    return;
  }
  const removed = removeMockRecord("centerClosures", id);
  if (!removed) throw new Error("Center closure not found.");
  revalidateBillingPaths();
}

export async function ensureCenterClosuresAction(_formData: FormData) {
  const profile = await requireBillingProfile();
  ensureCenterClosuresForCurrentAndNextYear({
    generatedByUserId: profile.id,
    generatedByName: profile.full_name
  });
  revalidateBillingPaths();
}

export async function savePayorAction(formData: FormData) {
  const profile = await requireBillingProfile();
  const id = asString(formData, "id");
  const now = toEasternISO();
  const billingMethodRaw = asString(formData, "billingMethod");
  const status = asString(formData, "status") === "inactive" ? ("inactive" as const) : ("active" as const);
  const billingMethod: "InvoiceEmail" | "ACHDraft" | "CardOnFile" | "Manual" | "External" =
    billingMethodRaw === "ACHDraft" || billingMethodRaw === "CardOnFile" || billingMethodRaw === "Manual" || billingMethodRaw === "External"
      ? billingMethodRaw
      : ("InvoiceEmail" as const);
  const payload = {
    payor_name: asString(formData, "payorName"),
    payor_type: asString(formData, "payorType") || "Private",
    billing_contact_name: asNullableString(formData, "billingContactName"),
    billing_email: asNullableString(formData, "billingEmail"),
    billing_phone: asNullableString(formData, "billingPhone"),
    billing_method: billingMethod,
    auto_draft_enabled: asBoolean(formData, "autoDraftEnabled", false),
    quickbooks_customer_name: asNullableString(formData, "quickbooksCustomerName"),
    quickbooks_customer_ref: asNullableString(formData, "quickbooksCustomerRef"),
    status,
    notes: asNullableString(formData, "notes"),
    updated_at: now,
    updated_by_user_id: profile.id,
    updated_by_name: profile.full_name
  };

  if (id) {
    const updated = updateMockRecord("payors", id, payload);
    if (!updated) throw new Error("Payor not found.");
  } else {
    addMockRecord("payors", {
      ...payload,
      created_at: now
    });
  }

  revalidateBillingPaths();
}

export async function saveMemberBillingSettingAction(formData: FormData) {
  const profile = await requireBillingProfile();
  const id = asString(formData, "id");
  const now = toEasternISO();
  const effectiveStartDate = asDateOnly(formData, "effectiveStartDate");
  const effectiveEndDate = asNullableString(formData, "effectiveEndDate");
  const active = asBoolean(formData, "active", false);

  const overlap = validateMemberBillingSettingOverlap({
    memberId: asString(formData, "memberId"),
    effectiveStartDate,
    effectiveEndDate,
    active,
    excludeId: id || undefined
  });
  if (!overlap.ok) throw new Error(overlap.error);

  const transportStatus = asString(formData, "transportationBillingStatus");
  const transportationStatus: "BillNormally" | "Waived" | "IncludedInProgramRate" =
    transportStatus === "Waived" || transportStatus === "IncludedInProgramRate"
      ? transportStatus
      : ("BillNormally" as const);
  const payload = {
    member_id: asString(formData, "memberId"),
    payor_id: asNullableString(formData, "payorId"),
    use_center_default_billing_mode: asBoolean(formData, "useCenterDefaultBillingMode", false),
    billing_mode: BILLING_MODE_OPTIONS.includes(asString(formData, "billingMode") as (typeof BILLING_MODE_OPTIONS)[number])
      ? (asString(formData, "billingMode") as (typeof BILLING_MODE_OPTIONS)[number])
      : null,
    monthly_billing_basis: MONTHLY_BILLING_BASIS_OPTIONS.includes(asString(formData, "monthlyBillingBasis") as (typeof MONTHLY_BILLING_BASIS_OPTIONS)[number])
      ? (asString(formData, "monthlyBillingBasis") as (typeof MONTHLY_BILLING_BASIS_OPTIONS)[number])
      : ("ScheduledMonthBehind" as const),
    use_center_default_rate: asBoolean(formData, "useCenterDefaultRate", false),
    custom_daily_rate: asNullableString(formData, "customDailyRate") ? asNumber(formData, "customDailyRate", 0) : null,
    flat_monthly_rate: asNullableString(formData, "flatMonthlyRate") ? asNumber(formData, "flatMonthlyRate", 0) : null,
    bill_extra_days: asBoolean(formData, "billExtraDays", false),
    transportation_billing_status: transportationStatus,
    bill_ancillary_arrears: asBoolean(formData, "billAncillaryArrears", false),
    active,
    effective_start_date: effectiveStartDate,
    effective_end_date: effectiveEndDate,
    billing_notes: asNullableString(formData, "billingNotes"),
    updated_at: now,
    updated_by_user_id: profile.id,
    updated_by_name: profile.full_name
  };

  if (id) {
    const updated = updateMockRecord("memberBillingSettings", id, payload);
    if (!updated) throw new Error("Member billing setting not found.");
  } else {
    addMockRecord("memberBillingSettings", {
      ...payload,
      created_at: now
    });
  }

  revalidateBillingPaths();
}

export async function saveBillingScheduleTemplateAction(formData: FormData) {
  const profile = await requireBillingProfile();
  const id = asString(formData, "id");
  const now = toEasternISO();
  const effectiveStartDate = asDateOnly(formData, "effectiveStartDate");
  const effectiveEndDate = asNullableString(formData, "effectiveEndDate");
  const active = asBoolean(formData, "active", false);

  const overlap = validateScheduleTemplateOverlap({
    memberId: asString(formData, "memberId"),
    effectiveStartDate,
    effectiveEndDate,
    active,
    excludeId: id || undefined
  });
  if (!overlap.ok) throw new Error(overlap.error);

  const payload = {
    member_id: asString(formData, "memberId"),
    effective_start_date: effectiveStartDate,
    effective_end_date: effectiveEndDate,
    monday: asBoolean(formData, "monday", false),
    tuesday: asBoolean(formData, "tuesday", false),
    wednesday: asBoolean(formData, "wednesday", false),
    thursday: asBoolean(formData, "thursday", false),
    friday: asBoolean(formData, "friday", false),
    saturday: asBoolean(formData, "saturday", false),
    sunday: asBoolean(formData, "sunday", false),
    active,
    notes: asNullableString(formData, "notes"),
    updated_at: now,
    updated_by_user_id: profile.id,
    updated_by_name: profile.full_name
  };

  if (id) {
    const updated = updateMockRecord("billingScheduleTemplates", id, payload);
    if (!updated) throw new Error("Schedule template not found.");
  } else {
    addMockRecord("billingScheduleTemplates", {
      ...payload,
      created_at: now
    });
  }

  revalidateBillingPaths();
}

export async function saveBillingAdjustmentAction(formData: FormData) {
  const profile = await requireBillingProfile();
  const id = asString(formData, "id");
  const now = toEasternISO();
  const adjustmentType = asString(formData, "adjustmentType");
  const amountRaw = asNumber(formData, "amount", 0);
  const normalizedType = BILLING_ADJUSTMENT_TYPE_OPTIONS.includes(adjustmentType as (typeof BILLING_ADJUSTMENT_TYPE_OPTIONS)[number])
    ? (adjustmentType as (typeof BILLING_ADJUSTMENT_TYPE_OPTIONS)[number])
    : ("Other" as const);
  const amount =
    normalizedType === "Credit" ||
    normalizedType === "Discount" ||
    normalizedType === "Refund" ||
    normalizedType === "ManualCredit"
      ? -Math.abs(amountRaw)
      : amountRaw;

  const billingStatus = asString(formData, "billingStatus") === "Excluded" ? ("Excluded" as const) : ("Unbilled" as const);
  const payload = {
    member_id: asString(formData, "memberId"),
    payor_id: asNullableString(formData, "payorId"),
    adjustment_date: asDateOnly(formData, "adjustmentDate"),
    adjustment_type: normalizedType,
    description: asString(formData, "description") || "Manual adjustment",
    quantity: Math.max(1, asNumber(formData, "quantity", 1)),
    unit_rate: asNumber(formData, "unitRate", amount),
    amount,
    billing_status: billingStatus,
    invoice_id: null,
    created_by_system: false,
    source_table: asNullableString(formData, "sourceTable"),
    source_record_id: asNullableString(formData, "sourceRecordId"),
    updated_at: now,
    created_by_user_id: profile.id,
    created_by_name: profile.full_name
  };

  if (id) {
    const updated = updateMockRecord("billingAdjustments", id, payload);
    if (!updated) throw new Error("Billing adjustment not found.");
  } else {
    addMockRecord("billingAdjustments", {
      ...payload,
      created_at: now
    });
  }

  revalidateBillingPaths();
}

export async function generateBillingBatchAction(formData: FormData) {
  try {
    const profile = await requireBillingProfile();
    const batchTypeRaw = asString(formData, "batchType");
    const billingMonth = asDateOnly(formData, "billingMonth");
    const batchType = BILLING_BATCH_TYPE_OPTIONS.includes(batchTypeRaw as (typeof BILLING_BATCH_TYPE_OPTIONS)[number])
      ? (batchTypeRaw as (typeof BILLING_BATCH_TYPE_OPTIONS)[number])
      : ("Mixed" as const);
    const runDate = asDateOnly(formData, "runDate", toEasternDate());
    const result = generateBillingBatch({
      billingMonth,
      batchType,
      runDate,
      runByUser: profile.id,
      runByName: profile.full_name
    });
    if (!result.ok) {
      redirectWithError("/operations/payor/billing-batches", result.error, {
        billingMonth,
        batchType
      });
    }
    revalidateBillingPaths();
    const successParams = new URLSearchParams({
      billingMonth,
      batchType,
      status: "generated"
    });
    if (result.billingBatchId) {
      successParams.set("batchId", result.billingBatchId);
    }
    redirect(`/operations/payor/billing-batches?${successParams.toString()}`);
  } catch (error) {
    redirectWithError("/operations/payor/billing-batches", error instanceof Error ? error.message : "Unable to generate billing batch.");
  }
}

export async function finalizeBillingBatchAction(formData: FormData) {
  const returnPath = asString(formData, "returnPath") || "/operations/payor/billing-batches";
  try {
    const access = await requireFinalizeRole();
    if (!access.ok) {
      redirectWithError(returnPath, access.error);
    }
    const result = finalizeBillingBatch({
      billingBatchId: asString(formData, "billingBatchId"),
      finalizedBy: access.profile.full_name
    });
    if (!result.ok) {
      redirectWithError(returnPath, result.error);
    }
    revalidateBillingPaths();
  } catch (error) {
    redirectWithError(returnPath, error instanceof Error ? error.message : "Unable to finalize billing batch.");
  }
}

export async function reopenBillingBatchAction(formData: FormData) {
  const returnPath = asString(formData, "returnPath") || "/operations/payor/billing-batches";
  try {
    const access = await requireReopenRole();
    if (!access.ok) {
      redirectWithError(returnPath, access.error);
    }
    const result = reopenBillingBatch({
      billingBatchId: asString(formData, "billingBatchId"),
      reopenedBy: access.profile.full_name
    });
    if (!result.ok) {
      redirectWithError(returnPath, result.error);
    }
    revalidateBillingPaths();
  } catch (error) {
    redirectWithError(returnPath, error instanceof Error ? error.message : "Unable to reopen billing batch.");
  }
}

export async function finalizeInvoiceAction(formData: FormData) {
  const returnPath = asString(formData, "returnPath") || "/operations/payor/invoices/draft";
  try {
    const access = await requireFinalizeRole();
    if (!access.ok) {
      redirectWithError(returnPath, access.error);
    }
    const result = finalizeInvoice({
      invoiceId: asString(formData, "invoiceId"),
      finalizedBy: access.profile.full_name
    });
    if (!result.ok) {
      redirectWithError(returnPath, result.error);
    }
    revalidateBillingPaths();
  } catch (error) {
    redirectWithError(returnPath, error instanceof Error ? error.message : "Unable to finalize invoice.");
  }
}

export async function setVariableChargeStatusAction(formData: FormData) {
  await requireBillingProfile();
  const table = asString(formData, "table");
  const status = asString(formData, "billingStatus");
  const next = setVariableChargeBillingStatus({
    table:
      table === "transportationLogs" || table === "ancillaryLogs" || table === "billingAdjustments"
        ? table
        : "billingAdjustments",
    id: asString(formData, "id"),
    billingStatus: status === "Billed" || status === "Excluded" ? status : "Unbilled",
    exclusionReason: asNullableString(formData, "exclusionReason")
  });
  if (!next) throw new Error("Variable charge row not found.");
  revalidateBillingPaths();
}

export async function createBillingExportAction(formData: FormData) {
  const returnPath = asString(formData, "returnPath") || "/operations/payor/exports";
  try {
    const profile = await requireBillingProfile();
    const exportType = asString(formData, "exportType");
    const result = createBillingExport({
      billingBatchId: asString(formData, "billingBatchId"),
      exportType:
        exportType === "InternalReviewCSV" || exportType === "InvoiceSummaryCSV"
          ? exportType
          : ("QuickBooksCSV" as (typeof BILLING_EXPORT_TYPES)[number]),
      generatedBy: profile.full_name
    });
    if (!result.ok) {
      redirectWithError(returnPath, result.error);
    }
    revalidateBillingPaths();
  } catch (error) {
    redirectWithError(returnPath, error instanceof Error ? error.message : "Unable to create export.");
  }
}

function parseManualLineItems(raw: string): CustomInvoiceManualLineInput[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line): CustomInvoiceManualLineInput => {
      const [descriptionPart, quantityPart, unitRatePart, amountPart, lineTypePart] = line.split("|").map((part) => part?.trim() ?? "");
      const lineType: CustomInvoiceManualLineInput["lineType"] =
        lineTypePart === "BaseProgram" ||
        lineTypePart === "Transportation" ||
        lineTypePart === "Ancillary" ||
        lineTypePart === "Adjustment" ||
        lineTypePart === "Credit" ||
        lineTypePart === "PriorBalance"
          ? lineTypePart
          : "Adjustment";
      return {
        description: descriptionPart || "Manual line",
        quantity: Number.isFinite(Number(quantityPart)) ? Number(quantityPart) : 1,
        unitRate: Number.isFinite(Number(unitRatePart)) ? Number(unitRatePart) : 0,
        amount: Number.isFinite(Number(amountPart)) ? Number(amountPart) : undefined,
        lineType
      };
    });
}

export async function createCustomInvoiceAction(formData: FormData) {
  const returnPath = asString(formData, "returnPath") || "/operations/payor/custom-invoices";
  try {
    const profile = await requireBillingProfile();
    const includeDates = asString(formData, "manualIncludeDates")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const excludeDates = asString(formData, "manualExcludeDates")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const method = asString(formData, "calculationMethod");
    const calculationMethod =
      method === "FlatAmount" || method === "ManualLineItems" ? method : ("DailyRateTimesDates" as const);

    const result = createCustomInvoice({
      memberId: asString(formData, "memberId"),
      payorId: asNullableString(formData, "payorId"),
      invoiceDate: asDateOnly(formData, "invoiceDate", toEasternDate()),
      dueDate: asDateOnly(formData, "dueDate", toEasternDate()),
      periodStart: asDateOnly(formData, "periodStart"),
      periodEnd: asDateOnly(formData, "periodEnd"),
      calculationMethod,
      flatAmount: asNullableString(formData, "flatAmount") ? asNumber(formData, "flatAmount", 0) : null,
      useScheduleTemplate: asBoolean(formData, "useScheduleTemplate", false),
      includeTransportation: asBoolean(formData, "includeTransportation", false),
      includeAncillary: asBoolean(formData, "includeAncillary", false),
      includeAdjustments: asBoolean(formData, "includeAdjustments", false),
      manualIncludeDates: includeDates,
      manualExcludeDates: excludeDates,
      manualLineItems: parseManualLineItems(asString(formData, "manualLineItems")),
      notes: asNullableString(formData, "notes"),
      runByUser: profile.id,
      runByName: profile.full_name
    });
    if (!result.ok) {
      redirectWithError(returnPath, result.error);
    }
    revalidateBillingPaths();
  } catch (error) {
    redirectWithError(returnPath, error instanceof Error ? error.message : "Unable to create custom invoice.");
  }
}

export async function createEnrollmentInvoiceAction(formData: FormData) {
  const returnPath = asString(formData, "returnPath") || "/operations/payor/custom-invoices";
  try {
    const profile = await requireBillingProfile();
    const result = createEnrollmentProratedInvoice({
      memberId: asString(formData, "memberId"),
      payorId: asNullableString(formData, "payorId"),
      effectiveStartDate: asDateOnly(formData, "effectiveStartDate"),
      periodEndDate: asNullableString(formData, "periodEndDate"),
      includeTransportation: asBoolean(formData, "includeTransportation", false),
      includeAncillary: asBoolean(formData, "includeAncillary", false),
      includeAdjustments: asBoolean(formData, "includeAdjustments", false),
      notes: asNullableString(formData, "notes"),
      runByUser: profile.id,
      runByName: profile.full_name
    });
    if (!result.ok) {
      redirectWithError(returnPath, result.error);
    }
    revalidateBillingPaths();
  } catch (error) {
    redirectWithError(returnPath, error instanceof Error ? error.message : "Unable to create enrollment invoice.");
  }
}
