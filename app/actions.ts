"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth";
import {
  LEAD_ACTIVITY_OUTCOMES,
  LEAD_ACTIVITY_TYPES,
  LEAD_FOLLOW_UP_TYPES,
  LEAD_LIKELIHOOD_OPTIONS,
  LEAD_LOST_REASON_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STAGE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  MEMBER_DISCHARGE_REASON_OPTIONS,
  MEMBER_DISPOSITION_OPTIONS,
  PARTICIPATION_MISSING_REASONS,
  TOILET_USE_TYPE_OPTIONS,
  TRANSPORT_PERIOD_OPTIONS,
  TRANSPORT_TYPE_OPTIONS,
  canonicalLeadStage,
  canonicalLeadStatus
} from "@/lib/canonical";
import { calculateAssessmentTotal, getAssessmentTrack } from "@/lib/assessment";
import {
  addAuditLogEvent,
  addLeadStageHistoryEntry,
  addMockRecord,
  ensureIntakeMemberFromLead,
  getMemberName,
  getMockDb,
  getStaffName,
  removeMockRecord,
  setDocumentationReview,
  setMockMemberStatus,
  setTimeReview,
  updateMockRecord,
  upsertMemberFromLead
} from "@/lib/mock-repo";
import { prefillMemberHealthProfileFromAssessment } from "@/lib/services/member-health-profiles";
import { prefillMemberCommandCenterFromAssessment } from "@/lib/services/member-command-center";
import { syncCommandCenterToMhp, syncMhpToCommandCenter } from "@/lib/services/member-profile-sync";
import { calculateLatePickupFee, getOperationalSettings, parseBusNumbersInput, updateOperationalSettings } from "@/lib/services/operations-settings";
import { getActiveCenterBillingSetting, getActiveMemberBillingSetting, getMemberAttendanceBillingSetting } from "@/lib/services/billing";
import { getManagedUserSignatureName } from "@/lib/services/user-management";
import { normalizeRoleKey } from "@/lib/permissions";
import { isMockMode } from "@/lib/runtime";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import type { AuditAction } from "@/types/app";

async function insertAudit(action: AuditAction, entityType: string, entityId: string | null, details: Record<string, unknown>) {
  if (isMockMode()) {
    const profile = await getCurrentProfile();
    addAuditLogEvent({
      actorUserId: profile.id,
      actorName: profile.full_name,
      actorRole: profile.role,
      action,
      entityType,
      entityId,
      details
    });
    return;
  }

  const profile = await getCurrentProfile();
  const supabase = await createClient();

  await supabase.from("audit_logs").insert({
    actor_user_id: profile.id,
    actor_role: profile.role,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details
  });
}

async function requireManagerAdminEditor() {
  const profile = await getCurrentProfile();
  const role = normalizeRoleKey(profile.role);
  if (role !== "admin" && role !== "manager" && role !== "director") {
    return { error: "Only manager/director/admin can edit submitted entries." } as const;
  }
  return profile;
}

async function requireAdminEditor() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin") {
    return { error: "Only admin can manage ancillary pricing." } as const;
  }
  return profile;
}

function syncLeadToMemberList(lead: {
  id?: string;
  member_name: string;
  member_start_date: string | null;
  stage: string;
  status: string;
  closed_date: string | null;
}) {
  const member = upsertMemberFromLead(lead.member_name, {
    enrollmentDate: lead.member_start_date ?? lead.closed_date ?? toEasternDate(),
    stage: lead.stage,
    status: lead.status,
    leadId: lead.id ?? null
  });

  if (member) {
    revalidatePath("/members");
    revalidatePath(`/members/${member.id}`);
  }
}

function leadProgressRank(stage: string, status: string) {
  const normalizedStage = canonicalLeadStage(stage);
  const normalizedStatus = canonicalLeadStatus(status, normalizedStage);

  if (normalizedStatus === "Won" || normalizedStatus === "Lost") return 5;
  if (normalizedStage === "Enrollment in Progress") return 4;
  if (normalizedStage === "Nurture") return 3;
  if (normalizedStage === "Tour") return 2;
  return 1;
}

function buildAssessmentResponseRows(input: {
  assessmentId: string;
  memberId: string;
  createdAt: string;
  values: Record<string, unknown>;
}) {
  const definition: Array<{ key: string; label: string; section: string; valueType?: "string" | "boolean" | "number" | "date" }> = [
    { key: "leadId", label: "Linked Lead ID", section: "Lead Intake Context" },
    { key: "leadStage", label: "Lead Stage at Assessment", section: "Lead Intake Context" },
    { key: "leadStatus", label: "Lead Status at Assessment", section: "Lead Intake Context" },
    { key: "feelingToday", label: "How Member Is Feeling Today", section: "Orientation & General Health" },
    { key: "healthLately", label: "Health Lately", section: "Orientation & General Health" },
    { key: "allergies", label: "Allergies", section: "Orientation & General Health" },
    { key: "codeStatus", label: "Code Status", section: "Orientation & General Health" },
    { key: "orientationDobVerified", label: "Orientation DOB Verified", section: "Orientation & General Health", valueType: "boolean" },
    { key: "orientationCityVerified", label: "Orientation City Verified", section: "Orientation & General Health", valueType: "boolean" },
    { key: "orientationYearVerified", label: "Orientation Current Year Verified", section: "Orientation & General Health", valueType: "boolean" },
    { key: "orientationOccupationVerified", label: "Orientation Former Occupation Verified", section: "Orientation & General Health", valueType: "boolean" },
    { key: "medicationManagementStatus", label: "Medication Management", section: "Independence & Daily Routines" },
    { key: "dressingSupportStatus", label: "Dressing Support", section: "Independence & Daily Routines" },
    { key: "assistiveDevices", label: "Assistive Devices", section: "Independence & Daily Routines" },
    { key: "incontinenceProducts", label: "Incontinence Products", section: "Independence & Daily Routines" },
    { key: "onSiteMedicationUse", label: "On-site Medication Use", section: "Independence & Daily Routines" },
    { key: "onSiteMedicationList", label: "On-site Medication List", section: "Independence & Daily Routines" },
    { key: "dietType", label: "Diet Type", section: "Diet & Nutrition" },
    { key: "dietOther", label: "Diet Other", section: "Diet & Nutrition" },
    { key: "dietRestrictionsNotes", label: "Diet Notes", section: "Diet & Nutrition" },
    { key: "mobilitySteadiness", label: "Steadiness / Mobility", section: "Mobility & Safety" },
    { key: "fallsHistory", label: "Falls History", section: "Mobility & Safety" },
    { key: "mobilityAids", label: "Mobility Aids", section: "Mobility & Safety" },
    { key: "mobilitySafetyNotes", label: "Mobility / Safety Notes", section: "Mobility & Safety" },
    { key: "overwhelmedByNoise", label: "Overwhelmed by Noise/Busyness", section: "Social Engagement & Emotional Wellness", valueType: "boolean" },
    { key: "socialTriggers", label: "Known Triggers", section: "Social Engagement & Emotional Wellness" },
    { key: "emotionalWellnessNotes", label: "Emotional Wellness Notes", section: "Social Engagement & Emotional Wellness" },
    { key: "joySparks", label: "Joy Sparks", section: "Personal Notes & Joy Sparks" },
    { key: "personalNotes", label: "Personal Notes", section: "Personal Notes & Joy Sparks" },
    { key: "scoreOrientationGeneralHealth", label: "Orientation & General Health Score", section: "Scoring", valueType: "number" },
    { key: "scoreDailyRoutinesIndependence", label: "Daily Routines & Independence Score", section: "Scoring", valueType: "number" },
    { key: "scoreNutritionDietaryNeeds", label: "Nutrition & Dietary Needs Score", section: "Scoring", valueType: "number" },
    { key: "scoreMobilitySafety", label: "Mobility & Safety Score", section: "Scoring", valueType: "number" },
    { key: "scoreSocialEmotionalWellness", label: "Social & Emotional Wellness Score", section: "Scoring", valueType: "number" },
    { key: "totalScore", label: "Total Score", section: "Scoring", valueType: "number" },
    { key: "recommendedTrack", label: "Recommended Track", section: "Scoring" },
    { key: "admissionReviewRequired", label: "Admission Review Required", section: "Scoring", valueType: "boolean" },
    { key: "transportCanEnterExitVehicle", label: "Can Enter/Exit Vehicle", section: "Transportation Screening" },
    { key: "transportAssistanceLevel", label: "Transport Assistance Level", section: "Transportation Screening" },
    { key: "transportMobilityAid", label: "Transport Mobility Aid", section: "Transportation Screening" },
    { key: "transportCanRemainSeatedBuckled", label: "Can Remain Seated and Buckled", section: "Transportation Screening", valueType: "boolean" },
    { key: "transportBehaviorConcern", label: "Transport Behavior Concern", section: "Transportation Screening" },
    { key: "transportAppropriate", label: "Appropriate for Center Transportation", section: "Transportation Screening", valueType: "boolean" },
    { key: "vitalsHr", label: "HR", section: "Vital Signs", valueType: "number" },
    { key: "vitalsBp", label: "BP", section: "Vital Signs" },
    { key: "vitalsO2Percent", label: "O2 %", section: "Vital Signs", valueType: "number" },
    { key: "vitalsRr", label: "RR", section: "Vital Signs", valueType: "number" }
  ];

  return definition.map((entry) => {
    const raw = input.values[entry.key];
    const inferredType = entry.valueType ?? (typeof raw === "boolean" ? "boolean" : typeof raw === "number" ? "number" : "string");
    return {
      assessment_id: input.assessmentId,
      member_id: input.memberId,
      field_key: entry.key,
      field_label: entry.label,
      section_type: entry.section,
      field_value: raw == null ? "" : String(raw),
      field_value_type: inferredType,
      created_at: input.createdAt
    };
  });
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function signInAction(formData: FormData) {
  if (isMockMode()) {
    // TODO(backend): Restore Supabase auth sign-in once local backend is connected.
    return { ok: true };
  }

  const payload = credentialsSchema.safeParse({
    email: String(formData.get("email") || ""),
    password: String(formData.get("password") || "")
  });

  if (!payload.success) {
    return { error: "Please enter a valid email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(payload.data);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/");
  return { ok: true };
}

export async function signOutAction() {
  if (isMockMode()) {
    revalidatePath("/login");
    return;
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/login");
}

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

  if (isMockMode()) {
    const created = addMockRecord("timePunches", {
      staff_user_id: profile.id,
      staff_name: profile.full_name,
      punch_type: payload.data.punchType,
      punch_at: toEasternISO(),
      within_fence: true,
      distance_meters: payload.data.lat && payload.data.lng ? 12 : null,
      note: payload.data.note ?? null
    });

    await insertAudit(payload.data.punchType === "in" ? "clock_in" : "clock_out", "time_punch", created.id, payload.data);
    revalidatePath("/time-card");
    revalidatePath("/");
    return { ok: true };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_punches")
    .insert({
      staff_user_id: profile.id,
      punch_type: payload.data.punchType,
      punch_at: toEasternISO(),
      lat: payload.data.lat ?? null,
      lng: payload.data.lng ?? null,
      note: payload.data.note ?? null
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  await insertAudit(payload.data.punchType === "in" ? "clock_in" : "clock_out", "time_punch", data.id, payload.data);
  revalidatePath("/time-card");
  revalidatePath("/");
  return { ok: true };
}

const dailyActivitySchema = z
  .object({
    memberId: z.string().uuid().optional().or(z.literal("")),
    activityDate: z.string(),
    activity1: z.number().min(0).max(100),
    reasonMissing1: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    activity2: z.number().min(0).max(100),
    reasonMissing2: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    activity3: z.number().min(0).max(100),
    reasonMissing3: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    activity4: z.number().min(0).max(100),
    reasonMissing4: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    activity5: z.number().min(0).max(100),
    reasonMissing5: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    notes: z.string().max(500).optional()
  })
  .superRefine((val, ctx) => {
    const checks = [
      { level: val.activity1, reason: val.reasonMissing1, path: "reasonMissing1" },
      { level: val.activity2, reason: val.reasonMissing2, path: "reasonMissing2" },
      { level: val.activity3, reason: val.reasonMissing3, path: "reasonMissing3" },
      { level: val.activity4, reason: val.reasonMissing4, path: "reasonMissing4" },
      { level: val.activity5, reason: val.reasonMissing5, path: "reasonMissing5" }
    ];

    checks.forEach((check) => {
      if (check.level === 0 && !check.reason?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [check.path],
          message: "Reason is required when activity participation is 0%."
        });
      }
    });
  });

export async function createDailyActivityAction(raw: z.infer<typeof dailyActivitySchema>) {
  const payload = dailyActivitySchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid activity log." };
  }

  const profile = await getCurrentProfile();
  const participation = Math.round(
    (payload.data.activity1 + payload.data.activity2 + payload.data.activity3 + payload.data.activity4 + payload.data.activity5) / 5
  );
  const memberName = payload.data.memberId ? getMemberName(payload.data.memberId) : "Unknown Member";

  if (isMockMode()) {
    const created = addMockRecord("dailyActivities", {
      timestamp: toEasternISO(),
      member_id: payload.data.memberId,
      member_name: memberName,
      activity_date: payload.data.activityDate,
      staff_user_id: profile.id,
      staff_name: profile.full_name,
      staff_recording_activity: profile.full_name,
      participation,
      participation_reason: null,
      activity_1_level: payload.data.activity1,
      reason_missing_activity_1: payload.data.activity1 === 0 ? payload.data.reasonMissing1?.trim() ?? null : null,
      activity_2_level: payload.data.activity2,
      reason_missing_activity_2: payload.data.activity2 === 0 ? payload.data.reasonMissing2?.trim() ?? null : null,
      activity_3_level: payload.data.activity3,
      reason_missing_activity_3: payload.data.activity3 === 0 ? payload.data.reasonMissing3?.trim() ?? null : null,
      activity_4_level: payload.data.activity4,
      reason_missing_activity_4: payload.data.activity4 === 0 ? payload.data.reasonMissing4?.trim() ?? null : null,
      activity_5_level: payload.data.activity5,
      reason_missing_activity_5: payload.data.activity5 === 0 ? payload.data.reasonMissing5?.trim() ?? null : null,
      notes: payload.data.notes ?? null,
      email_address: profile.email,
      created_at: toEasternISO()
    });

    await insertAudit("create_log", "daily_activity_log", created.id, payload.data);
    revalidatePath("/documentation");
    revalidatePath("/documentation/activity");
    revalidatePath("/");
    return { ok: true };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_activity_logs")
    .insert({
      member_id: payload.data.memberId,
      activity_date: payload.data.activityDate,
      staff_user_id: profile.id,
      activity_1_level: payload.data.activity1,
      reason_missing_activity_1: payload.data.activity1 === 0 ? payload.data.reasonMissing1?.trim() ?? null : null,
      activity_2_level: payload.data.activity2,
      reason_missing_activity_2: payload.data.activity2 === 0 ? payload.data.reasonMissing2?.trim() ?? null : null,
      activity_3_level: payload.data.activity3,
      reason_missing_activity_3: payload.data.activity3 === 0 ? payload.data.reasonMissing3?.trim() ?? null : null,
      activity_4_level: payload.data.activity4,
      reason_missing_activity_4: payload.data.activity4 === 0 ? payload.data.reasonMissing4?.trim() ?? null : null,
      activity_5_level: payload.data.activity5,
      reason_missing_activity_5: payload.data.activity5 === 0 ? payload.data.reasonMissing5?.trim() ?? null : null,
      notes: payload.data.notes ?? null
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  await insertAudit("create_log", "daily_activity_log", data.id, payload.data);
  revalidatePath("/documentation");
  revalidatePath("/");
  return { ok: true };
}

const leadSchema = z
  .object({
    stage: z.enum(LEAD_STAGE_OPTIONS),
    status: z.enum(LEAD_STATUS_OPTIONS),
    inquiryDate: z.string(),
    caregiverName: z.string().min(1),
    caregiverRelationship: z.string().min(1).optional().or(z.literal("")),
    caregiverEmail: z.string().email().optional().or(z.literal("")),
    caregiverPhone: z.string().min(7),
    memberName: z.string().min(1),
    leadSource: z.enum(LEAD_SOURCE_OPTIONS),
    referralName: z.string().optional().or(z.literal("")),
    likelihood: z.enum(LEAD_LIKELIHOOD_OPTIONS).optional().or(z.literal("")),
    nextFollowUpDate: z.string().optional().or(z.literal("")),
    nextFollowUpType: z.enum(LEAD_FOLLOW_UP_TYPES).optional().or(z.literal("")),
    tourDate: z.string().optional().or(z.literal("")),
    lostReason: z.enum(LEAD_LOST_REASON_OPTIONS).optional().or(z.literal("")),
    notes: z.string().max(1000).optional()
  })
  .superRefine((val, ctx) => {
    const stage = canonicalLeadStage(val.stage);
    const status = canonicalLeadStatus(val.status, stage);
    if ((stage === "Closed - Lost" || status === "Lost") && !val.lostReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lostReason"],
        message: "Lost reason is required when lead is Closed - Lost."
      });
    }
  });

export async function createLeadAction(raw: z.infer<typeof leadSchema>) {
  const payload = leadSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid lead data." };
  }

  const profile = await getCurrentProfile();
  const stage = canonicalLeadStage(payload.data.stage);
  const derivedStatus = canonicalLeadStatus(payload.data.status, stage);

  if (isMockMode()) {
    const nowIso = toEasternISO();
    const created = addMockRecord("leads", {
      lead_id: `L-${Date.now()}`,
      status: derivedStatus,
      stage,
      stage_updated_at: nowIso,
      inquiry_date: payload.data.inquiryDate,
      tour_date: payload.data.tourDate || null,
      tour_completed: false,
      discovery_date: null,
      member_start_date: null,
      caregiver_name: payload.data.caregiverName,
      caregiver_relationship: payload.data.caregiverRelationship || null,
      caregiver_email: payload.data.caregiverEmail || null,
      caregiver_phone: payload.data.caregiverPhone,
      member_name: payload.data.memberName,
      lead_source: payload.data.leadSource,
      referral_name: payload.data.referralName || null,
      likelihood: payload.data.likelihood || null,
      next_follow_up_date: payload.data.nextFollowUpDate || null,
      next_follow_up_type: payload.data.nextFollowUpType || null,
      notes_summary: payload.data.notes ?? null,
      lost_reason: derivedStatus === "Lost" ? payload.data.lostReason || null : null,
      closed_date: derivedStatus === "Open" || derivedStatus === "Nurture" ? null : payload.data.inquiryDate,
      partner_id: null,
      created_by_user_id: profile.id,
      created_by_name: profile.full_name,
      created_at: nowIso
    });

    syncLeadToMemberList(created);
    addLeadStageHistoryEntry({
      leadId: created.id,
      fromStage: null,
      toStage: created.stage,
      fromStatus: null,
      toStatus: created.status,
      changedByUserId: profile.id,
      changedByName: profile.full_name,
      reason: "Lead created",
      source: "createLeadAction",
      changedAt: nowIso
    });

    await insertAudit("create_lead", "lead", created.id, payload.data);
    revalidatePath("/sales");
    return { ok: true };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .insert({
      status: derivedStatus,
      stage,
      inquiry_date: payload.data.inquiryDate,
      caregiver_name: payload.data.caregiverName,
      caregiver_relationship: payload.data.caregiverRelationship || null,
      caregiver_email: payload.data.caregiverEmail || null,
      caregiver_phone: payload.data.caregiverPhone,
      member_name: payload.data.memberName,
      lead_source: payload.data.leadSource,
      referral_name: payload.data.referralName || null,
      likelihood: payload.data.likelihood || null,
      next_follow_up_date: payload.data.nextFollowUpDate || null,
      next_follow_up_type: payload.data.nextFollowUpType || null,
      tour_date: payload.data.tourDate || null,
      notes_summary: payload.data.notes ?? null,
      lost_reason: derivedStatus === "Lost" ? payload.data.lostReason || null : null,
      created_by_user_id: profile.id
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  await insertAudit("create_lead", "lead", data.id, payload.data);
  revalidatePath("/sales");
  return { ok: true };
}

const ancillarySchema = z.object({
  memberId: z.string().uuid(),
  categoryId: z.string().uuid(),
  serviceDate: z.string(),
  latePickupTime: z.string().optional().or(z.literal("")),
  notes: z.string().max(300).optional(),
  sourceEntity: z.string().optional(),
  sourceEntityId: z.string().optional()
});

export async function createAncillaryChargeAction(raw: z.infer<typeof ancillarySchema>) {
  const payload = ancillarySchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid ancillary charge." };
  }

  const profile = await getCurrentProfile();
  const isLatePickupCategory = (categoryName?: string | null) => {
    const normalized = (categoryName ?? "").toLowerCase();
    return normalized.includes("late pick-up") || normalized.includes("late pickup");
  };

  if (isMockMode()) {
    const db = getMockDb();
    const category = db.ancillaryCategories.find((c) => c.id === payload.data.categoryId);
    const requiresLatePickupTime = isLatePickupCategory(category?.name);
    if (requiresLatePickupTime && !payload.data.latePickupTime?.trim()) {
      return { error: "Late pick-up time is required for late pick-up charges." };
    }
    const latePickupTime = requiresLatePickupTime ? payload.data.latePickupTime?.trim() || null : null;
    let amountCents = category?.price_cents ?? 0;
    if (requiresLatePickupTime) {
      // Late pickup charges are computed from centralized operations rules, not static category price.
      const fee = calculateLatePickupFee({
        latePickupTime: latePickupTime ?? "",
        rules: getOperationalSettings().latePickupRules
      });
      if (!fee) {
        return { error: "Invalid late pick-up time." };
      }
      if (fee.amountCents <= 0) {
        return { error: "Selected pick-up time is not later than the configured late threshold." };
      }
      amountCents = fee.amountCents;
    }
    const existingDuplicate = db.ancillaryLogs.find((row) => {
      const sameMember = row.member_id === payload.data.memberId;
      const sameCategory = row.category_id === payload.data.categoryId;
      const sameDate = row.service_date === payload.data.serviceDate;
      const sameSourceEntity = (row.source_entity ?? null) === (payload.data.sourceEntity ?? null);
      const sameSourceId = (row.source_entity_id ?? null) === (payload.data.sourceEntityId ?? null);
      return sameMember && sameCategory && sameDate && sameSourceEntity && sameSourceId;
    });

    if (existingDuplicate) {
      return { error: "Duplicate ancillary charge detected for this member/date/category/source." };
    }

    const quantity = 1;
    const unitRate = Number((amountCents / 100).toFixed(2));
    const totalAmount = Number((unitRate * quantity).toFixed(2));
    const created = addMockRecord("ancillaryLogs", {
      timestamp: toEasternISO(),
      member_id: payload.data.memberId,
      member_name: getMemberName(payload.data.memberId),
      category_id: payload.data.categoryId,
      category_name: category?.name ?? "Unknown",
      charge_type: category?.name ?? "Ancillary Charge",
      amount_cents: amountCents,
      service_date: payload.data.serviceDate,
      charge_date: payload.data.serviceDate,
      late_pickup_time: latePickupTime,
      staff_user_id: profile.id,
      staff_name: profile.full_name,
      staff_recording_entry: profile.full_name,
      notes: payload.data.notes ?? null,
      source_entity: payload.data.sourceEntity ?? null,
      source_entity_id: payload.data.sourceEntityId ?? null,
      quantity,
      unit_rate: unitRate,
      total_amount: totalAmount,
      billable: true,
      billing_status: "Unbilled",
      billing_exclusion_reason: null,
      invoice_id: null,
      created_at: toEasternISO()
    });

    await insertAudit("create_log", "ancillary_charge", created.id, payload.data);
    revalidatePath("/ancillary");
    revalidatePath("/documentation/ancillary");
    revalidatePath("/reports/monthly-ancillary");
    return { ok: true };
  }

  const supabase = await createClient();
  // TODO(backend): Enforce category rule server-side in DB constraints once backend tables are managed.
  const mockDb = getMockDb();
  const category = mockDb.ancillaryCategories.find((c) => c.id === payload.data.categoryId);
  const requiresLatePickupTime = isLatePickupCategory(category?.name);
  if (requiresLatePickupTime && !payload.data.latePickupTime?.trim()) {
    return { error: "Late pick-up time is required for late pick-up charges." };
  }
  const latePickupTime = requiresLatePickupTime ? payload.data.latePickupTime?.trim() || null : null;
  if (requiresLatePickupTime) {
    const fee = calculateLatePickupFee({
      latePickupTime: latePickupTime ?? "",
      rules: getOperationalSettings().latePickupRules
    });
    if (!fee) {
      return { error: "Invalid late pick-up time." };
    }
    if (fee.amountCents <= 0) {
      return { error: "Selected pick-up time is not later than the configured late threshold." };
    }
  }
  const { data, error } = await supabase
    .from("ancillary_charge_logs")
    .insert({
      member_id: payload.data.memberId,
      category_id: payload.data.categoryId,
      service_date: payload.data.serviceDate,
      late_pickup_time: latePickupTime,
      staff_user_id: profile.id,
      notes: payload.data.notes ?? null
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  await insertAudit("create_log", "ancillary_charge", data.id, payload.data);
  revalidatePath("/ancillary");
  return { ok: true };
}

const ancillaryPricingSchema = z.object({
  categoryId: z.string().uuid(),
  unitPriceDollars: z.coerce.number().min(0).max(9999)
});

export async function updateAncillaryCategoryPriceAction(raw: z.infer<typeof ancillaryPricingSchema>) {
  const payload = ancillaryPricingSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid ancillary pricing update." };
  }

  const editor = await requireAdminEditor();
  if ("error" in editor) return editor;

  if (!isMockMode()) {
    // TODO(backend): Wire ancillary category pricing updates to Supabase table.
    return { error: "Ancillary pricing backend integration pending." };
  }

  const nextPriceCents = Math.round(payload.data.unitPriceDollars * 100);
  const updated = updateMockRecord("ancillaryCategories", payload.data.categoryId, {
    price_cents: nextPriceCents
  });

  if (!updated) {
    return { error: "Ancillary charge category not found." };
  }

  await insertAudit("manager_review", "ancillary_category", updated.id, {
    categoryName: updated.name,
    unitPriceDollars: payload.data.unitPriceDollars,
    unitPriceCents: nextPriceCents
  });

  revalidatePath("/operations/additional-charges");
  revalidatePath("/operations/additional-charges/manage-ancillary-pricing");
  revalidatePath("/ancillary");
  revalidatePath("/reports");
  revalidatePath("/reports/monthly-ancillary");

  return { ok: true };
}

const operationalSettingsSchema = z.object({
  busNumbersCsv: z.string().optional().default(""),
  makeupPolicy: z.enum(["rolling_30_day_expiration", "running_total"]),
  latePickupGraceStartTime: z.string().regex(/^\d{2}:\d{2}$/),
  latePickupFirstWindowMinutes: z.coerce.number().int().min(1).max(180),
  latePickupFirstWindowFeeDollars: z.coerce.number().min(0).max(9999),
  latePickupAdditionalPerMinuteDollars: z.coerce.number().min(0).max(999),
  latePickupAdditionalMinutesCap: z.coerce.number().int().min(0).max(240)
});

export async function updateOperationalSettingsAction(raw: z.infer<typeof operationalSettingsSchema>) {
  const payload = operationalSettingsSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid operations settings update." };
  }

  const editor = await requireAdminEditor();
  if ("error" in editor) return editor;

  if (!isMockMode()) {
    // TODO(backend): Persist operations settings in production data store.
    return { error: "Operations settings backend integration pending." };
  }

  const busNumbers = parseBusNumbersInput(payload.data.busNumbersCsv);
  const settings = updateOperationalSettings({
    busNumbers,
    makeupPolicy: payload.data.makeupPolicy,
    latePickupRules: {
      graceStartTime: payload.data.latePickupGraceStartTime,
      firstWindowMinutes: payload.data.latePickupFirstWindowMinutes,
      firstWindowFeeCents: Math.round(payload.data.latePickupFirstWindowFeeDollars * 100),
      additionalPerMinuteCents: Math.round(payload.data.latePickupAdditionalPerMinuteDollars * 100),
      additionalMinutesCap: payload.data.latePickupAdditionalMinutesCap
    }
  });

  await insertAudit("manager_review", "operations_settings", null, {
    busNumbers: settings.busNumbers,
    makeupPolicy: settings.makeupPolicy,
    latePickupRules: settings.latePickupRules
  });

  revalidatePath("/operations/additional-charges/manage-ancillary-pricing");
  revalidatePath("/operations/transportation-station");
  revalidatePath("/operations/transportation-station/print");
  revalidatePath("/operations/member-command-center");
  revalidatePath("/operations/attendance");
  revalidatePath("/operations/holds");
  revalidatePath("/ancillary");
  revalidatePath("/reports");
  revalidatePath("/reports/monthly-ancillary");

  return { ok: true, settings };
}

const toiletUseTypeSchema = z.enum(TOILET_USE_TYPE_OPTIONS);
const toiletSchema = z.object({
  memberId: z.string().uuid(),
  eventAt: z.string(),
  briefs: z.boolean(),
  memberSupplied: z.boolean(),
  useType: toiletUseTypeSchema,
  notes: z.string().max(500).optional()
});

export async function createToiletLogAction(raw: z.infer<typeof toiletSchema>) {
  const payload = toiletSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid toilet log." };
  }

  if (!isMockMode()) {
    // TODO(backend): wire to public.toilet_logs.
    return { error: "Toilet log backend integration pending." };
  }

  const profile = await getCurrentProfile();
  const created = addMockRecord("toiletLogs", {
    ratee: "5",
    event_at: payload.data.eventAt,
    event_date: payload.data.eventAt.slice(0, 10),
    member_id: payload.data.memberId,
    member_name: getMemberName(payload.data.memberId),
    briefs: payload.data.briefs,
    member_supplied: payload.data.memberSupplied,
    use_type: payload.data.useType,
    staff_user_id: profile.id,
    staff_name: profile.full_name,
    staff_assisting: profile.full_name,
    linked_ancillary_charge_id: null,
    notes: payload.data.notes ?? null
  });

  if (payload.data.briefs && !payload.data.memberSupplied) {
    const db = getMockDb();
    const briefsCategory = db.ancillaryCategories.find((c) => c.name.toLowerCase() === "briefs") ?? db.ancillaryCategories[0];

    const ancillary = addMockRecord("ancillaryLogs", {
      timestamp: toEasternISO(),
      member_id: payload.data.memberId,
      member_name: getMemberName(payload.data.memberId),
      category_id: briefsCategory.id,
      category_name: briefsCategory.name,
      charge_type: briefsCategory.name,
      amount_cents: briefsCategory.price_cents,
      service_date: payload.data.eventAt.slice(0, 10),
      charge_date: payload.data.eventAt.slice(0, 10),
      late_pickup_time: null,
      staff_user_id: profile.id,
      staff_name: profile.full_name,
      staff_recording_entry: profile.full_name,
      notes: "Auto-generated from Toilet Log (briefs changed and not member supplied)",
      source_entity: "toiletLogs",
      source_entity_id: created.id,
      quantity: 1,
      unit_rate: Number((briefsCategory.price_cents / 100).toFixed(2)),
      total_amount: Number((briefsCategory.price_cents / 100).toFixed(2)),
      billable: true,
      billing_status: "Unbilled",
      billing_exclusion_reason: null,
      invoice_id: null,
      created_at: toEasternISO()
    });

    updateMockRecord("toiletLogs", created.id, {
      linked_ancillary_charge_id: ancillary.id
    });
  }

  revalidatePath("/documentation/toilet");
  revalidatePath("/documentation");
  revalidatePath("/ancillary");
  revalidatePath("/reports/monthly-ancillary");
  return { ok: true };
}

const showerSchema = z.object({
  memberId: z.string().uuid(),
  eventAt: z.string(),
  laundry: z.boolean(),
  briefs: z.boolean(),
  notes: z.string().max(500).optional()
});

export async function createShowerLogAction(raw: z.infer<typeof showerSchema>) {
  const payload = showerSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid shower log." };
  }

  if (!isMockMode()) {
    // TODO(backend): wire to public.shower_logs.
    return { error: "Shower log backend integration pending." };
  }

  const profile = await getCurrentProfile();
  addMockRecord("showerLogs", {
    timestamp: toEasternISO(),
    event_at: payload.data.eventAt,
    event_date: payload.data.eventAt.slice(0, 10),
    member_id: payload.data.memberId,
    member_name: getMemberName(payload.data.memberId),
    laundry: payload.data.laundry,
    briefs: payload.data.briefs,
    staff_user_id: profile.id,
    staff_name: profile.full_name,
    staff_assisting: profile.full_name,
    linked_ancillary_charge_id: null,
    notes: payload.data.notes ?? null
  });

  revalidatePath("/documentation/shower");
  revalidatePath("/documentation");
  return { ok: true };
}

const transportationSchema = z.object({
  memberId: z.string().uuid(),
  period: z.enum(TRANSPORT_PERIOD_OPTIONS),
  transportType: z.enum(TRANSPORT_TYPE_OPTIONS),
  serviceDate: z.string()
});

export async function createTransportationLogAction(raw: z.infer<typeof transportationSchema>) {
  const payload = transportationSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid transportation log." };
  }

  if (!isMockMode()) {
    // TODO(backend): wire to public.transportation_logs.
    return { error: "Transportation log backend integration pending." };
  }

  const profile = await getCurrentProfile();
  const memberSetting = getActiveMemberBillingSetting(payload.data.memberId, payload.data.serviceDate);
  const attendanceBillingSetting = getMemberAttendanceBillingSetting(payload.data.memberId);
  const centerSetting = getActiveCenterBillingSetting(payload.data.serviceDate);
  const transportStatus = attendanceBillingSetting?.transportationBillingStatus ?? memberSetting?.transportation_billing_status ?? "BillNormally";
  const isBillable = transportStatus === "BillNormally";
  const tripType = payload.data.transportType.toLowerCase().includes("round") ? "RoundTrip" : "OneWay";
  const unitRate =
    tripType === "RoundTrip"
      ? Number(centerSetting?.default_transport_round_trip_rate ?? 0)
      : Number(centerSetting?.default_transport_one_way_rate ?? 0);
  const totalAmount = Number((unitRate * 1).toFixed(2));

  addMockRecord("transportationLogs", {
    timestamp: toEasternISO(),
    first_name: getMemberName(payload.data.memberId).split(" ")[0] ?? "",
    member_id: payload.data.memberId,
    member_name: getMemberName(payload.data.memberId),
    pick_up_drop_off: payload.data.period,
    period: payload.data.period,
    transport_type: payload.data.transportType,
    service_date: payload.data.serviceDate,
    staff_user_id: profile.id,
    staff_name: profile.full_name,
    staff_responsible: profile.full_name,
    notes: null,
    trip_type: tripType,
    quantity: 1,
    unit_rate: unitRate,
    total_amount: totalAmount,
    billable: isBillable,
    billing_status: isBillable ? "Unbilled" : "Excluded",
    billing_exclusion_reason:
      transportStatus === "Waived"
        ? "Waived in MCC attendance billing"
        : transportStatus === "IncludedInProgramRate"
          ? "Included in program rate (MCC attendance billing)"
          : null,
    invoice_id: null
  });

  revalidatePath("/documentation/transportation");
  revalidatePath("/documentation");
  return { ok: true };
}

const photoSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.string().optional(),
  fileDataUrl: z.string().optional(),
  notes: z.string().max(500).optional()
});
const MAX_PHOTO_UPLOAD_BYTES = 5 * 1024 * 1024;

function estimateDataUrlBytes(dataUrl: string) {
  const payload = dataUrl.split(",")[1] ?? "";
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

export async function createPhotoUploadAction(raw: z.infer<typeof photoSchema>) {
  const payload = photoSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid photo upload." };
  }
  if (payload.data.fileDataUrl) {
    const estimatedBytes = estimateDataUrlBytes(payload.data.fileDataUrl);
    if (estimatedBytes > MAX_PHOTO_UPLOAD_BYTES) {
      return { error: "Photo is too large. Max allowed per photo is 5MB." };
    }
  }

  if (!isMockMode()) {
    // TODO(backend): wire to Supabase Storage + member_photo_uploads.
    return { error: "Photo upload backend integration pending." };
  }

  const profile = await getCurrentProfile();
  addMockRecord("photoUploads", {
    member_id: "",
    member_name: "",
    photo_url: payload.data.fileDataUrl || "https://placehold.co/600x400?text=Uploaded+Photo",
    file_name: payload.data.fileName,
    file_type: payload.data.fileType ?? "image/*",
    uploaded_by: profile.id,
    uploaded_by_name: profile.full_name,
    uploaded_at: toEasternISO(),
    upload_date: toEasternDate(),
    staff_clean: profile.full_name,
    notes: payload.data.notes ?? null
  });

  revalidatePath("/documentation/photo-upload");
  revalidatePath("/documentation");
  return { ok: true };
}
const bloodSugarSchema = z.object({
  memberId: z.string().uuid(),
  checkedAt: z.string(),
  readingMgDl: z.number().min(20).max(600),
  notes: z.string().max(500).optional()
});

export async function createBloodSugarLogAction(raw: z.infer<typeof bloodSugarSchema>) {
  const payload = bloodSugarSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid blood sugar log." };
  }

  if (!isMockMode()) {
    // TODO(backend): wire to public.blood_sugar_logs.
    return { error: "Blood sugar backend integration pending." };
  }

  const profile = await getCurrentProfile();
  addMockRecord("bloodSugarLogs", {
    member_id: payload.data.memberId,
    member_name: getMemberName(payload.data.memberId),
    checked_at: payload.data.checkedAt,
    reading_mg_dl: payload.data.readingMgDl,
    nurse_user_id: profile.id,
    nurse_name: profile.full_name,
    notes: payload.data.notes ?? null
  });

  revalidatePath("/health");
  revalidatePath("/documentation/blood-sugar");
  return { ok: true };
}

const assessmentScoreSchema = z.union([z.literal(15), z.literal(10), z.literal(5)]);

const assessmentSchema = z
  .object({
    memberId: z.string().uuid().optional().or(z.literal("")),
    leadId: z.string().min(1),
    leadStage: z.string().optional().or(z.literal("")),
    leadStatus: z.string().optional().or(z.literal("")),
    assessmentDate: z.string(),
    completedBy: z.string().min(1),
    signedBy: z.string().min(1),
    complete: z.boolean(),

    feelingToday: z.string().min(1),
    healthLately: z.string().min(1),
    allergies: z.string().min(1),
    codeStatus: z.enum(["DNR", "Full Code"]),
    orientationDobVerified: z.boolean(),
    orientationCityVerified: z.boolean(),
    orientationYearVerified: z.boolean(),
    orientationOccupationVerified: z.boolean(),
    orientationNotes: z.string().optional().or(z.literal("")),

    medicationManagementStatus: z.string().min(1),
    dressingSupportStatus: z.string().min(1),
    assistiveDevices: z.string().optional().or(z.literal("")),
    incontinenceProducts: z.string().optional().or(z.literal("")),
    onSiteMedicationUse: z.string().optional().or(z.literal("")),
    onSiteMedicationList: z.string().optional().or(z.literal("")),
    independenceNotes: z.string().optional().or(z.literal("")),

    dietType: z.string().min(1),
    dietOther: z.string().optional().or(z.literal("")),
    dietRestrictionsNotes: z.string().optional().or(z.literal("")),

    mobilitySteadiness: z.string().min(1),
    fallsHistory: z.string().optional().or(z.literal("")),
    mobilityAids: z.string().optional().or(z.literal("")),
    mobilitySafetyNotes: z.string().optional().or(z.literal("")),

    overwhelmedByNoise: z.boolean(),
    socialTriggers: z.string().optional().or(z.literal("")),
    emotionalWellnessNotes: z.string().optional().or(z.literal("")),

    joySparks: z.string().optional().or(z.literal("")),
    personalNotes: z.string().optional().or(z.literal("")),

    scoreOrientationGeneralHealth: assessmentScoreSchema,
    scoreDailyRoutinesIndependence: assessmentScoreSchema,
    scoreNutritionDietaryNeeds: assessmentScoreSchema,
    scoreMobilitySafety: assessmentScoreSchema,
    scoreSocialEmotionalWellness: assessmentScoreSchema,

    transportCanEnterExitVehicle: z.string().min(1),
    transportAssistanceLevel: z.string().min(1),
    transportMobilityAid: z.string().optional().or(z.literal("")),
    transportCanRemainSeatedBuckled: z.boolean(),
    transportBehaviorConcern: z.string().optional().or(z.literal("")),
    transportAppropriate: z.boolean(),
    transportNotes: z.string().optional().or(z.literal("")),
    vitalsHr: z.number().min(1).max(250),
    vitalsBp: z.string().min(1),
    vitalsO2Percent: z.number().min(1).max(100),
    vitalsRr: z.number().min(1).max(80),

    notes: z.string().max(2000).optional().or(z.literal(""))
  })
  .superRefine((val, ctx) => {
    if (val.onSiteMedicationUse === "Yes" && !val.onSiteMedicationList?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["onSiteMedicationList"],
        message: "On-site medication names are required when on-site meds is Yes."
      });
    }

    if (!/^\d{2,3}\s*\/\s*\d{2,3}$/.test(val.vitalsBp.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vitalsBp"],
        message: "BP must use systolic/diastolic format (e.g., 120/80)."
      });
    }
  });

export async function createAssessmentAction(raw: z.infer<typeof assessmentSchema>) {
  const payload = assessmentSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid assessment." };
  }

  if (!isMockMode()) {
    // TODO(backend): add assessment table + relation tables and PDF generation pipeline.
    return { error: "Assessment backend integration pending." };
  }

  const profile = await getCurrentProfile();
  const signerName = getManagedUserSignatureName(profile.id, profile.full_name);
  const db = getMockDb();
  const lead = db.leads.find((row) => row.id === payload.data.leadId);
  if (!lead) {
    return { error: "Linked lead not found." };
  }

  const leadStage = canonicalLeadStage(lead.stage);
  if (leadStage !== "Tour" && leadStage !== "Enrollment in Progress") {
    return { error: "Intake assessment can only be created for leads in Tour or Enrollment in Progress." };
  }

  const linkedMember =
    ensureIntakeMemberFromLead({
      memberName: lead.member_name,
      leadId: lead.id,
      enrollmentDate: lead.member_start_date ?? lead.inquiry_date ?? null
    }) ?? null;
  const effectiveMemberId = linkedMember?.id ?? payload.data.memberId;
  if (!effectiveMemberId) {
    return { error: "Unable to resolve intake member record for this lead." };
  }

  const totalScore = calculateAssessmentTotal({
    orientationGeneralHealth: payload.data.scoreOrientationGeneralHealth,
    dailyRoutinesIndependence: payload.data.scoreDailyRoutinesIndependence,
    nutritionDietaryNeeds: payload.data.scoreNutritionDietaryNeeds,
    mobilitySafety: payload.data.scoreMobilitySafety,
    socialEmotionalWellness: payload.data.scoreSocialEmotionalWellness
  });

  const { recommendedTrack, admissionReviewRequired } = getAssessmentTrack(totalScore);

  const created = addMockRecord("assessments", {
    lead_id: payload.data.leadId,
    lead_stage_at_assessment: leadStage,
    lead_status_at_assessment: canonicalLeadStatus(lead.status, leadStage),
    member_id: effectiveMemberId,
    member_name: getMemberName(effectiveMemberId),
    assessment_date: payload.data.assessmentDate,
    completed_by: signerName,
    signed_by: signerName,
    complete: payload.data.complete,

    feeling_today: payload.data.feelingToday,
    health_lately: payload.data.healthLately,
    allergies: payload.data.allergies,
    code_status: payload.data.codeStatus || "",
    orientation_dob_verified: payload.data.orientationDobVerified,
    orientation_city_verified: payload.data.orientationCityVerified,
    orientation_year_verified: payload.data.orientationYearVerified,
    orientation_occupation_verified: payload.data.orientationOccupationVerified,
    orientation_notes: payload.data.orientationNotes || "",

    medication_management_status: payload.data.medicationManagementStatus,
    dressing_support_status: payload.data.dressingSupportStatus,
    assistive_devices: payload.data.assistiveDevices || "",
    incontinence_products: payload.data.incontinenceProducts || "",
    on_site_medication_use: payload.data.onSiteMedicationUse || "",
    on_site_medication_list: payload.data.onSiteMedicationList?.trim() || "",
    independence_notes: payload.data.independenceNotes || "",

    diet_type: payload.data.dietType,
    diet_other: payload.data.dietOther || "",
    diet_restrictions_notes: payload.data.dietRestrictionsNotes || "",

    mobility_steadiness: payload.data.mobilitySteadiness,
    falls_history: payload.data.fallsHistory || "",
    mobility_aids: payload.data.mobilityAids || "",
    mobility_safety_notes: payload.data.mobilitySafetyNotes || "",

    overwhelmed_by_noise: payload.data.overwhelmedByNoise,
    social_triggers: payload.data.socialTriggers || "",
    emotional_wellness_notes: payload.data.emotionalWellnessNotes || "",

    joy_sparks: payload.data.joySparks || "",
    personal_notes: payload.data.personalNotes || "",

    score_orientation_general_health: payload.data.scoreOrientationGeneralHealth,
    score_daily_routines_independence: payload.data.scoreDailyRoutinesIndependence,
    score_nutrition_dietary_needs: payload.data.scoreNutritionDietaryNeeds,
    score_mobility_safety: payload.data.scoreMobilitySafety,
    score_social_emotional_wellness: payload.data.scoreSocialEmotionalWellness,
    total_score: totalScore,
    recommended_track: recommendedTrack,
    admission_review_required: admissionReviewRequired,

    transport_can_enter_exit_vehicle: payload.data.transportCanEnterExitVehicle,
    transport_assistance_level: payload.data.transportAssistanceLevel,
    transport_mobility_aid: payload.data.transportMobilityAid || "",
    transport_can_remain_seated_buckled: payload.data.transportCanRemainSeatedBuckled,
    transport_behavior_concern: payload.data.transportBehaviorConcern || "",
    transport_appropriate: payload.data.transportAppropriate,
    transport_notes: payload.data.transportNotes || "",
    vitals_hr: payload.data.vitalsHr,
    vitals_bp: payload.data.vitalsBp.trim(),
    vitals_o2_percent: payload.data.vitalsO2Percent,
    vitals_rr: payload.data.vitalsRr,

    reviewer_name: signerName,
    created_by_user_id: profile.id,
    created_by_name: profile.full_name,
    created_at: toEasternISO(),
    notes: payload.data.notes || ""
  });

  const responseRows = buildAssessmentResponseRows({
    assessmentId: created.id,
    memberId: effectiveMemberId,
    createdAt: created.created_at,
    values: {
      ...payload.data,
      leadStage: leadStage,
      leadStatus: canonicalLeadStatus(lead.status, leadStage),
      totalScore,
      recommendedTrack,
      admissionReviewRequired
    }
  });
  responseRows.forEach((row) => addMockRecord("assessmentResponses", row));

    updateMockRecord("members", effectiveMemberId, {
    allergies: payload.data.allergies,
    code_status: payload.data.codeStatus || null,
    orientation_dob_verified: payload.data.orientationDobVerified,
    orientation_city_verified: payload.data.orientationCityVerified,
    orientation_year_verified: payload.data.orientationYearVerified,
    orientation_occupation_verified: payload.data.orientationOccupationVerified,
    medication_management_status: payload.data.medicationManagementStatus || null,
    dressing_support_status: payload.data.dressingSupportStatus || null,
    assistive_devices: payload.data.assistiveDevices || null,
    incontinence_products: payload.data.incontinenceProducts || null,
    on_site_medication_use: payload.data.onSiteMedicationUse || null,
    on_site_medication_list: payload.data.onSiteMedicationList?.trim() || null,
    diet_type: payload.data.dietType || null,
    diet_restrictions_notes: payload.data.dietRestrictionsNotes || null,
    mobility_status: payload.data.mobilitySteadiness || null,
    mobility_aids: payload.data.mobilityAids || null,
    social_triggers: payload.data.socialTriggers || null,
    joy_sparks: payload.data.joySparks || null,
    personal_notes: payload.data.personalNotes || null,
    transport_can_enter_exit_vehicle: payload.data.transportCanEnterExitVehicle || null,
    transport_assistance_level: payload.data.transportAssistanceLevel || null,
    transport_mobility_aid: payload.data.transportMobilityAid || null,
    transport_can_remain_seated_buckled: payload.data.transportCanRemainSeatedBuckled,
    transport_behavior_concern: payload.data.transportBehaviorConcern || null,
    transport_appropriate: payload.data.transportAppropriate,
    latest_assessment_id: created.id,
    latest_assessment_date: payload.data.assessmentDate,
    latest_assessment_score: totalScore,
      latest_assessment_track: recommendedTrack,
      latest_assessment_admission_review_required: admissionReviewRequired
    });

    prefillMemberHealthProfileFromAssessment({
      memberId: effectiveMemberId,
      assessment: created,
      actor: { id: profile.id, fullName: profile.full_name }
    });
    prefillMemberCommandCenterFromAssessment({
      memberId: effectiveMemberId,
      assessment: created,
      actor: { id: profile.id, fullName: profile.full_name }
    });
    syncMhpToCommandCenter(effectiveMemberId, { id: profile.id, fullName: profile.full_name });
    syncCommandCenterToMhp(
      effectiveMemberId,
      { id: profile.id, fullName: profile.full_name },
      undefined,
      { syncAllergies: true }
    );

    const shouldAutoAdvanceLeadToEip =
      payload.data.complete &&
      leadProgressRank(lead.stage, lead.status) < leadProgressRank("Enrollment in Progress", "Open");

    if (shouldAutoAdvanceLeadToEip) {
      const transitionedLead = updateMockRecord("leads", lead.id, {
        stage: "Enrollment in Progress",
        status: "Open",
        stage_updated_at: toEasternISO(),
        member_start_date: lead.member_start_date ?? payload.data.assessmentDate
      });

      if (transitionedLead) {
        addLeadStageHistoryEntry({
          leadId: transitionedLead.id,
          fromStage: lead.stage,
          toStage: transitionedLead.stage,
          fromStatus: lead.status,
          toStatus: transitionedLead.status,
          changedByUserId: profile.id,
          changedByName: profile.full_name,
          reason: "Intake assessment marked complete",
          source: "createAssessmentAction:auto-eip"
        });

        addAuditLogEvent({
          actorUserId: profile.id,
          actorName: profile.full_name,
          actorRole: profile.role,
          action: "update_lead",
          entityType: "lead",
          entityId: transitionedLead.id,
          details: {
            operation: "assessment-complete-auto-stage",
            assessmentId: created.id,
            fromStage: lead.stage,
            toStage: transitionedLead.stage,
            fromStatus: lead.status,
            toStatus: transitionedLead.status
          }
        });

        revalidatePath("/sales");
        revalidatePath("/sales/pipeline");
        revalidatePath("/sales/pipeline/tour");
        revalidatePath("/sales/pipeline/eip");
        revalidatePath(`/sales/leads/${transitionedLead.id}`);
      }
    }

    revalidatePath("/health");
    revalidatePath("/health/assessment");
    revalidatePath(`/health/assessment/${created.id}`);
    revalidatePath("/health/member-health-profiles");
    revalidatePath(`/health/member-health-profiles/${effectiveMemberId}`);
    revalidatePath(`/members/${effectiveMemberId}`);
    revalidatePath(`/reports/assessments/${created.id}`);
    return { ok: true, assessmentId: created.id };
}

const leadActivitySchema = z
  .object({
    leadId: z.string(),
    activityType: z.enum(LEAD_ACTIVITY_TYPES),
    outcome: z.enum(LEAD_ACTIVITY_OUTCOMES),
    lostReason: z.enum(LEAD_LOST_REASON_OPTIONS).optional().or(z.literal("")),
    nextFollowUpDate: z.string().optional().or(z.literal("")),
    nextFollowUpType: z.enum(LEAD_FOLLOW_UP_TYPES).optional().or(z.literal("")),
    notes: z.string().max(500).optional()
  })
  .superRefine((val, ctx) => {
    if (val.outcome === "Not a fit" && !val.lostReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lostReason"],
        message: "Lost reason is required when outcome is Not a fit."
      });
    }
  });

export async function createLeadActivityAction(raw: z.infer<typeof leadActivitySchema>) {
  const payload = leadActivitySchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid lead activity." };
  }

  if (!isMockMode()) {
    // TODO(backend): wire to public.lead_activities.
    return { error: "Lead activity backend integration pending." };
  }

  const profile = await getCurrentProfile();
  const db = getMockDb();
  const lead = db.leads.find((row) => row.id === payload.data.leadId);

  if (!lead) {
    return { error: "Lead not found." };
  }

  addMockRecord("leadActivities", {
    activity_id: `LA-${Date.now()}`,
    lead_id: payload.data.leadId,
    member_name: lead.member_name,
    activity_at: toEasternISO(),
    activity_type: payload.data.activityType,
    outcome: payload.data.outcome,
    lost_reason: payload.data.lostReason || null,
    notes: payload.data.notes ?? null,
    next_follow_up_date: payload.data.nextFollowUpDate || null,
    next_follow_up_type: payload.data.nextFollowUpType ?? null,
    completed_by_user_id: profile.id,
    completed_by_name: profile.full_name
  });

  revalidatePath("/sales");
  revalidatePath("/sales/activities");
  revalidatePath(`/sales/leads/${payload.data.leadId}`);
  return { ok: true };
}

const leadStatusSchema = z.object({
  leadId: z.string(),
  status: z.enum(LEAD_STATUS_OPTIONS),
  stage: z.string().min(1)
});

export async function updateLeadStatusAction(raw: z.infer<typeof leadStatusSchema>) {
  const payload = leadStatusSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid lead status update." };
  }

  if (!isMockMode()) {
    // TODO(backend): wire to public.leads update endpoint.
    return { error: "Lead status backend integration pending." };
  }

  const db = getMockDb();
  const lead = db.leads.find((l) => l.id === payload.data.leadId);

  if (!lead) {
    return { error: "Lead not found." };
  }

  const fromStatus = lead.status;
  const fromStage = lead.stage;
  const nextStatus = canonicalLeadStatus(payload.data.status, payload.data.stage);
  const nextStage = canonicalLeadStage(payload.data.stage);
  const updatedLead = updateMockRecord("leads", lead.id, {
    status: nextStatus,
    stage: nextStage,
    stage_updated_at: toEasternISO()
  });
  if (!updatedLead) return { error: "Lead not found." };

  syncLeadToMemberList(updatedLead);

  const profile = await getCurrentProfile();
  if (fromStage !== updatedLead.stage || fromStatus !== updatedLead.status) {
    addLeadStageHistoryEntry({
      leadId: updatedLead.id,
      fromStage,
      toStage: updatedLead.stage,
      fromStatus,
      toStatus: updatedLead.status,
      changedByUserId: profile.id,
      changedByName: profile.full_name,
      reason: "Lead status update",
      source: "updateLeadStatusAction"
    });
  }
  await insertAudit("update_lead", "lead", updatedLead.id, {
    fromStage,
    toStage: updatedLead.stage,
    fromStatus,
    toStatus: updatedLead.status
  });

  revalidatePath("/sales");
  revalidatePath("/sales/won");
  revalidatePath("/sales/lost");
  return { ok: true };
}

export async function getMockStaffLookup() {
  if (!isMockMode()) {
    return [];
  }

  const db = getMockDb();
  return db.staff.map((s) => ({ id: s.id, full_name: s.full_name, role: s.role }));
}

export async function getMockMemberLookup() {
  if (!isMockMode()) {
    return [];
  }

  const db = getMockDb();
  return db.members.filter((m) => m.status === "active").map((m) => ({ id: m.id, display_name: m.display_name }));
}

export async function resolveStaffName(staffId: string) {
  if (!isMockMode()) {
    return null;
  }

  return getStaffName(staffId);
}


const updateDailyActivitySchema = z
  .object({
    id: z.string(),
    activity1: z.number().min(0).max(100),
    reasonMissing1: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    activity2: z.number().min(0).max(100),
    reasonMissing2: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    activity3: z.number().min(0).max(100),
    reasonMissing3: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    activity4: z.number().min(0).max(100),
    reasonMissing4: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    activity5: z.number().min(0).max(100),
    reasonMissing5: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    notes: z.string().max(500).optional()
  })
  .superRefine((val, ctx) => {
    const checks = [
      { level: val.activity1, reason: val.reasonMissing1, path: "reasonMissing1" },
      { level: val.activity2, reason: val.reasonMissing2, path: "reasonMissing2" },
      { level: val.activity3, reason: val.reasonMissing3, path: "reasonMissing3" },
      { level: val.activity4, reason: val.reasonMissing4, path: "reasonMissing4" },
      { level: val.activity5, reason: val.reasonMissing5, path: "reasonMissing5" }
    ];

    checks.forEach((check) => {
      if (check.level === 0 && !check.reason?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [check.path],
          message: "Reason is required when activity participation is 0%."
        });
      }
    });
  });

export async function updateDailyActivityAction(raw: z.infer<typeof updateDailyActivitySchema>) {
  const payload = updateDailyActivitySchema.safeParse(raw);
  if (!payload.success) return { error: "Invalid participation log update." };
  if (!isMockMode()) return { error: "Participation log update backend integration pending." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;

  const participation = Math.round(
    (payload.data.activity1 + payload.data.activity2 + payload.data.activity3 + payload.data.activity4 + payload.data.activity5) / 5
  );

  const updated = updateMockRecord("dailyActivities", payload.data.id, {
    participation,
    participation_reason: null,
    activity_1_level: payload.data.activity1,
    reason_missing_activity_1: payload.data.activity1 === 0 ? payload.data.reasonMissing1?.trim() ?? null : null,
    activity_2_level: payload.data.activity2,
    reason_missing_activity_2: payload.data.activity2 === 0 ? payload.data.reasonMissing2?.trim() ?? null : null,
    activity_3_level: payload.data.activity3,
    reason_missing_activity_3: payload.data.activity3 === 0 ? payload.data.reasonMissing3?.trim() ?? null : null,
    activity_4_level: payload.data.activity4,
    reason_missing_activity_4: payload.data.activity4 === 0 ? payload.data.reasonMissing4?.trim() ?? null : null,
    activity_5_level: payload.data.activity5,
    reason_missing_activity_5: payload.data.activity5 === 0 ? payload.data.reasonMissing5?.trim() ?? null : null,
    notes: payload.data.notes ?? null
  });

  if (!updated) return { error: "Record not found." };
  revalidatePath("/documentation/activity");
  revalidatePath("/documentation");
  return { ok: true };
}

const updateSimpleSchema = z.object({ id: z.string(), notes: z.string().max(500).optional() });

export async function updateToiletLogAction(raw: z.infer<typeof updateSimpleSchema> & { useType: string; briefs: boolean; memberSupplied?: boolean }) {
  const payload = z.object({ id: z.string(), notes: z.string().max(500).optional(), useType: toiletUseTypeSchema, briefs: z.boolean(), memberSupplied: z.boolean().optional() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid toilet update." };
  if (!isMockMode()) return { error: "Toilet update backend integration pending." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;

  const existing = getMockDb().toiletLogs.find((row) => row.id === payload.data.id);
  const memberSupplied = payload.data.memberSupplied ?? existing?.member_supplied ?? false;

  const updated = updateMockRecord("toiletLogs", payload.data.id, {
    notes: payload.data.notes ?? null,
    use_type: payload.data.useType,
    briefs: payload.data.briefs,
    member_supplied: memberSupplied
  });

  if (!updated) return { error: "Record not found." };

  const shouldHaveBriefsCharge = payload.data.briefs && !memberSupplied;
  const linkedChargeId = updated.linked_ancillary_charge_id ?? null;

  if (shouldHaveBriefsCharge && !linkedChargeId) {
    const db = getMockDb();
    const profile = editor;
    const briefsCategory = db.ancillaryCategories.find((c) => c.name.toLowerCase() === "briefs") ?? db.ancillaryCategories[0];
    const existingCharge = db.ancillaryLogs.find(
      (row) =>
        row.source_entity === "toiletLogs" &&
        row.source_entity_id === updated.id &&
        row.category_id === briefsCategory.id
    );

    if (existingCharge) {
      updateMockRecord("toiletLogs", updated.id, { linked_ancillary_charge_id: existingCharge.id });
      revalidatePath("/documentation/toilet");
      revalidatePath("/documentation");
      revalidatePath("/ancillary");
      revalidatePath("/reports/monthly-ancillary");
      return { ok: true };
    }

    const ancillary = addMockRecord("ancillaryLogs", {
      timestamp: toEasternISO(),
      member_id: updated.member_id,
      member_name: updated.member_name,
      category_id: briefsCategory.id,
      category_name: briefsCategory.name,
      charge_type: briefsCategory.name,
      amount_cents: briefsCategory.price_cents,
      service_date: updated.event_date,
      charge_date: updated.event_date,
      late_pickup_time: null,
      staff_user_id: profile.id,
      staff_name: profile.full_name,
      staff_recording_entry: profile.full_name,
      notes: "Auto-generated from Toilet Log edit (briefs changed and not member supplied)",
      source_entity: "toiletLogs",
      source_entity_id: updated.id,
      quantity: 1,
      unit_rate: Number((briefsCategory.price_cents / 100).toFixed(2)),
      total_amount: Number((briefsCategory.price_cents / 100).toFixed(2)),
      billable: true,
      billing_status: "Unbilled",
      billing_exclusion_reason: null,
      invoice_id: null,
      created_at: toEasternISO()
    });

    updateMockRecord("toiletLogs", updated.id, { linked_ancillary_charge_id: ancillary.id });
  }

  if (!shouldHaveBriefsCharge && linkedChargeId) {
    removeMockRecord("ancillaryLogs", linkedChargeId);
    updateMockRecord("toiletLogs", updated.id, { linked_ancillary_charge_id: null });
  }

  revalidatePath("/documentation/toilet");
  revalidatePath("/documentation");
  revalidatePath("/ancillary");
  revalidatePath("/reports/monthly-ancillary");
  return { ok: true };
}

export async function updateShowerLogAction(raw: z.infer<typeof updateSimpleSchema> & { laundry: boolean; briefs: boolean }) {
  const payload = z.object({ id: z.string(), notes: z.string().max(500).optional(), laundry: z.boolean(), briefs: z.boolean() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid shower update." };
  if (!isMockMode()) return { error: "Shower update backend integration pending." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  const updated = updateMockRecord("showerLogs", payload.data.id, { notes: payload.data.notes ?? null, laundry: payload.data.laundry, briefs: payload.data.briefs });
  if (!updated) return { error: "Record not found." };
  revalidatePath("/documentation/shower");
  revalidatePath("/documentation");
  return { ok: true };
}

export async function updateTransportationLogAction(raw: { id: string; period: (typeof TRANSPORT_PERIOD_OPTIONS)[number]; transportType: (typeof TRANSPORT_TYPE_OPTIONS)[number] }) {
  const payload = z.object({ id: z.string(), period: z.enum(TRANSPORT_PERIOD_OPTIONS), transportType: z.enum(TRANSPORT_TYPE_OPTIONS) }).safeParse(raw);
  if (!payload.success) return { error: "Invalid transportation update." };
  if (!isMockMode()) return { error: "Transportation update backend integration pending." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  const updated = updateMockRecord("transportationLogs", payload.data.id, { period: payload.data.period, pick_up_drop_off: payload.data.period, transport_type: payload.data.transportType, notes: null });
  if (!updated) return { error: "Record not found." };
  revalidatePath("/documentation/transportation");
  revalidatePath("/documentation");
  return { ok: true };
}

export async function updateBloodSugarAction(raw: { id: string; readingMgDl: number; notes?: string }) {
  const payload = z.object({ id: z.string(), readingMgDl: z.number().min(20).max(600), notes: z.string().max(500).optional() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid blood sugar update." };
  if (!isMockMode()) return { error: "Blood sugar update backend integration pending." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  const updated = updateMockRecord("bloodSugarLogs", payload.data.id, { reading_mg_dl: payload.data.readingMgDl, notes: payload.data.notes ?? null });
  if (!updated) return { error: "Record not found." };
  revalidatePath("/documentation/blood-sugar");
  revalidatePath("/health");
  return { ok: true };
}

export async function updateAncillaryAction(raw: { id: string; notes?: string }) {
  const payload = updateSimpleSchema.safeParse(raw);
  if (!payload.success) return { error: "Invalid ancillary update." };
  if (!isMockMode()) return { error: "Ancillary update backend integration pending." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  const updated = updateMockRecord("ancillaryLogs", payload.data.id, { notes: payload.data.notes ?? null });
  if (!updated) return { error: "Record not found." };
  revalidatePath("/ancillary");
  revalidatePath("/documentation");
  return { ok: true };
}

export async function setAncillaryReconciliationAction(raw: {
  id: string;
  status: "open" | "reconciled" | "void";
  note?: string;
}) {
  const payload = z
    .object({
      id: z.string(),
      status: z.enum(["open", "reconciled", "void"]),
      note: z.string().max(500).optional()
    })
    .safeParse(raw);
  if (!payload.success) return { error: "Invalid reconciliation update." };
  if (!isMockMode()) return { error: "Ancillary reconciliation backend integration pending." };

  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;

  const nextPatch =
    payload.data.status === "reconciled"
      ? {
          reconciliation_status: "reconciled" as const,
          reconciled_by: editor.full_name,
          reconciled_at: toEasternISO(),
          reconciliation_note: payload.data.note?.trim() || "Reconciled by manager/admin review."
        }
      : {
          reconciliation_status: payload.data.status,
          reconciled_by: null,
          reconciled_at: null,
          reconciliation_note:
            payload.data.status === "void"
              ? payload.data.note?.trim() || "Voided during reconciliation review."
              : payload.data.note?.trim() || null
        };

  const updated = updateMockRecord("ancillaryLogs", payload.data.id, nextPatch);
  if (!updated) return { error: "Record not found." };

  await insertAudit("manager_review", "ancillary_charge", payload.data.id, {
    reconciliation_status: payload.data.status,
    note: payload.data.note ?? null
  });

  revalidatePath("/ancillary");
  revalidatePath("/reports");
  revalidatePath("/reports/monthly-ancillary");
  revalidatePath("/admin-reports");
  return { ok: true };
}

export async function updateLeadDetailsAction(raw: { id: string; stage: string; status: (typeof LEAD_STATUS_OPTIONS)[number]; notes?: string }) {
  const payload = z.object({ id: z.string(), stage: z.string().min(1), status: z.enum(LEAD_STATUS_OPTIONS), notes: z.string().max(1000).optional() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid lead update." };
  if (!isMockMode()) return { error: "Lead update backend integration pending." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  let stage = canonicalLeadStage(payload.data.stage);
  let status = canonicalLeadStatus(payload.data.status, stage);
  if (stage === "Closed - Lost") status = "Lost";
  if (status === "Lost") stage = "Closed - Lost";
  if (status === "Won") stage = "Closed - Won";
  if (status === "Nurture" && stage !== "Nurture") stage = "Nurture";
  status = canonicalLeadStatus(status, stage);
  // Keep closed-date semantics consistent with the primary lead save action across all edit entry points.
  const closedDate = status === "Lost" || status === "Won" ? toEasternDate() : null;
  const existingLead = getMockDb().leads.find((row) => row.id === payload.data.id) ?? null;
  const updated = updateMockRecord("leads", payload.data.id, {
    stage,
    status,
    stage_updated_at: toEasternISO(),
    notes_summary: payload.data.notes ?? null,
    closed_date: closedDate,
    next_follow_up_date: status === "Lost" ? null : existingLead?.next_follow_up_date ?? null,
    next_follow_up_type: status === "Lost" ? null : existingLead?.next_follow_up_type ?? null
  });
  if (!updated) {
    console.error("[Sales] updateLeadDetailsAction update failed", { leadId: payload.data.id, stage, status });
    return { error: "Lead not found." };
  }
  const profile = editor;
  const fromStage = existingLead?.stage ?? null;
  const fromStatus = existingLead?.status ?? null;
  if (fromStage !== stage || fromStatus !== status) {
    addLeadStageHistoryEntry({
      leadId: payload.data.id,
      fromStage,
      toStage: stage,
      fromStatus,
      toStatus: status,
      changedByUserId: profile.id,
      changedByName: profile.full_name,
      reason: "Lead detail edit",
      source: "updateLeadDetailsAction"
    });
  }
  await insertAudit("update_lead", "lead", payload.data.id, {
    fromStage,
    toStage: stage,
    fromStatus,
    toStatus: status,
    notes: payload.data.notes ?? null
  });
  syncLeadToMemberList(updated);
  revalidatePath("/sales");
  revalidatePath("/sales/activities");
  revalidatePath("/sales/pipeline");
  revalidatePath("/sales/pipeline/leads-table");
  revalidatePath("/sales/pipeline/by-stage");
  revalidatePath("/sales/pipeline/follow-up-dashboard");
  revalidatePath("/sales/pipeline/inquiry");
  revalidatePath("/sales/pipeline/tour");
  revalidatePath("/sales/pipeline/eip");
  revalidatePath("/sales/pipeline/nurture");
  revalidatePath("/sales/pipeline/closed-won");
  revalidatePath("/sales/pipeline/closed-lost");
  revalidatePath(`/sales/leads/${payload.data.id}`);
  revalidatePath(`/sales/leads/${payload.data.id}/edit`);
  revalidatePath("/sales/won");
  revalidatePath("/sales/lost");
  return { ok: true };
}

export async function setMemberStatusAction(raw: {
  memberId: string;
  status: "active" | "inactive";
  dischargeReason?: string;
  dischargeDisposition?: string;
}) {
  const payload = z
    .object({
      memberId: z.string().min(1),
      status: z.enum(["active", "inactive"]),
      dischargeReason: z.string().trim().optional(),
      dischargeDisposition: z.string().trim().optional()
    })
    .superRefine((val, ctx) => {
      if (val.status !== "inactive") return;
      if (!val.dischargeReason || !MEMBER_DISCHARGE_REASON_OPTIONS.includes(val.dischargeReason as (typeof MEMBER_DISCHARGE_REASON_OPTIONS)[number])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dischargeReason"],
          message: "Discharge reason is required."
        });
      }
      if (!val.dischargeDisposition || !MEMBER_DISPOSITION_OPTIONS.includes(val.dischargeDisposition as (typeof MEMBER_DISPOSITION_OPTIONS)[number])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dischargeDisposition"],
          message: "Discharge disposition is required."
        });
      }
    })
    .safeParse(raw);
  if (!payload.success) return { error: "Invalid member status update." };
  if (!isMockMode()) return { error: "Member status backend integration pending." };

  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;

  const updated = setMockMemberStatus(payload.data.memberId, payload.data.status, {
    dischargeReason: payload.data.dischargeReason ?? null,
    dischargeDisposition: payload.data.dischargeDisposition ?? null,
    actorName: editor.full_name
  });
  if (!updated) return { error: "Member not found." };

  await insertAudit("manager_review", "member", payload.data.memberId, {
    status: payload.data.status,
    dischargeReason: payload.data.dischargeReason ?? null,
    dischargeDisposition: payload.data.dischargeDisposition ?? null
  });

  revalidatePath("/members");
  revalidatePath(`/members/${updated.id}`);
  revalidatePath("/reports/member-summary");
  revalidatePath("/operations/member-command-center");
  revalidatePath(`/operations/member-command-center/${updated.id}`);
  revalidatePath("/operations/holds");
  revalidatePath("/operations/attendance");
  revalidatePath("/operations/transportation-station");
  revalidatePath("/operations/transportation-station/print");
  revalidatePath("/operations/locker-assignments");
  revalidatePath("/health/member-health-profiles");
  revalidatePath(`/health/member-health-profiles/${updated.id}`);
  return { ok: true };
}

export async function deleteWorkflowRecordAction(raw: { entity: string; id: string }) {
  const payload = z.object({ entity: z.string(), id: z.string() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid delete request." };
  if (!isMockMode()) return { error: "Delete backend integration pending." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  const db = getMockDb();

  const entityMap: Record<string, keyof ReturnType<typeof getMockDb>> = {
    dailyActivities: "dailyActivities",
    toiletLogs: "toiletLogs",
    showerLogs: "showerLogs",
    transportationLogs: "transportationLogs",
    photoUploads: "photoUploads",
    bloodSugarLogs: "bloodSugarLogs",
    ancillaryLogs: "ancillaryLogs",
    leads: "leads",
    leadActivities: "leadActivities",
    assessments: "assessments"
  };

  const key = entityMap[payload.data.entity];
  if (!key) return { error: "Unknown entity." };

  if (key === "ancillaryLogs") {
    const existing = db.ancillaryLogs.find((row) => row.id === payload.data.id);
    if (existing?.source_entity === "toiletLogs" && existing.source_entity_id) {
      updateMockRecord("toiletLogs", existing.source_entity_id, { linked_ancillary_charge_id: null });
    }
  }

  const deleted = removeMockRecord(key, payload.data.id);
  if (!deleted) return { error: "Record not found." };

  revalidatePath("/");
  revalidatePath("/documentation");
  revalidatePath("/health");
  revalidatePath("/ancillary");
  revalidatePath("/reports");
  revalidatePath("/reports/monthly-ancillary");
  revalidatePath("/sales");
  return { ok: true };
}

export async function reviewTimeCardAction(raw: { staffName: string; payPeriod: string; status: "Pending" | "Reviewed" | "Needs Follow-up"; notes?: string }) {
  const payload = z.object({ staffName: z.string().min(1), payPeriod: z.string().min(1), status: z.enum(["Pending", "Reviewed", "Needs Follow-up"]), notes: z.string().max(500).optional() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid time review." };
  if (!isMockMode()) return { error: "Time review backend integration pending." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  const profile = editor;
  setTimeReview(payload.data.staffName, payload.data.payPeriod, {
    status: payload.data.status,
    notes: payload.data.notes ?? "",
    reviewed_by: profile.full_name,
    reviewed_at: toEasternISO()
  });
  revalidatePath("/time-card");
  return { ok: true };
}

export async function reviewDocumentationAction(raw: { staffName: string; periodLabel: string; status: "Pending" | "Reviewed" | "Needs Follow-up"; notes?: string }) {
  const payload = z.object({ staffName: z.string().min(1), periodLabel: z.string().min(1), status: z.enum(["Pending", "Reviewed", "Needs Follow-up"]), notes: z.string().max(500).optional() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid documentation review." };
  if (!isMockMode()) return { error: "Documentation review backend integration pending." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  const profile = editor;
  setDocumentationReview(payload.data.staffName, payload.data.periodLabel, {
    status: payload.data.status,
    notes: payload.data.notes ?? "",
    reviewed_by: profile.full_name,
    reviewed_at: toEasternISO()
  });
  revalidatePath("/documentation");
  revalidatePath("/reports");
  return { ok: true };
}













































































