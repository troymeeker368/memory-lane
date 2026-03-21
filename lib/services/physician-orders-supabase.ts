import { Buffer } from "node:buffer";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import {
  OPHTHALMIC_LATERALITY_OPTIONS,
  OTIC_LATERALITY_OPTIONS,
  POF_DEFAULT_MEDICATION_FORM,
  POF_DEFAULT_MEDICATION_QUANTITY,
  POF_DEFAULT_MEDICATION_ROUTE,
  POF_LEVEL_OF_CARE_OPTIONS,
  POF_MEDICATION_FORM_OPTIONS,
  POF_MEDICATION_ROUTE_OPTIONS,
  POF_NUTRITION_OPTIONS,
  POF_STANDING_ORDER_OPTIONS
} from "@/lib/services/physician-order-config";
import type { IntakeAssessmentForPofPrefill } from "@/lib/services/intake-to-pof-mapping";
import type { IntakeAssessmentSignatureState } from "@/lib/services/intake-assessment-esign";
import { logSystemEvent } from "@/lib/services/system-event-service";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import {
  claimQueuedPhysicianOrderPostSignSyncRows,
  emitAgedPostSignSyncQueueAlerts,
  invokeSignPhysicianOrderRpc,
  invokeSyncSignedPofToMemberClinicalProfileRpc,
  loadPostSignQueueStatusByPofIds,
  markPostSignQueueCompleted,
  markPostSignQueueQueued
} from "@/lib/services/physician-order-post-sign-runtime";
import {
  getLatestEnrollmentPacketPofStagingSummary,
  markEnrollmentPacketPofStagingReviewed
} from "@/lib/services/enrollment-packet-intake-staging";
import {
  PHYSICIAN_ORDER_INDEX_SELECT,
  PHYSICIAN_ORDER_MEMBER_HISTORY_SELECT,
  PHYSICIAN_ORDER_WITH_MEMBER_SELECT
} from "@/lib/services/physician-orders-selects";
import {
  resolvePhysicianOrderClinicalSyncStatus,
  type PhysicianOrderClinicalSyncStatus
} from "@/lib/services/physician-order-clinical-sync";
import {
  calculateRenewalDueDate,
  addDaysDateOnly,
  applyEnrollmentPacketPrefillToDraft,
  buildPostSignSyncError,
  clean,
  computePostSignRetryAt,
  fromStatus,
  isMissingPhysicianOrdersTableError,
  mapPhysicianOrderWriteError,
  normalizePhysicianOrderSex,
  physicianOrdersTableRequiredError,
  resolveRenewalStatus,
  rowToForm,
  sanitizeAllergyRows,
  sanitizeDiagnosisRows,
  sanitizeList,
  sanitizeMedicationRows,
  toStatus,
  type PofPostSignSyncStep,
  type PostgrestErrorLike
} from "@/lib/services/physician-order-core";
import {
  defaultCareInformation,
  defaultOperationalFlags,
  type PhysicianOrderCareInformation,
  type PhysicianOrderForm,
  type PhysicianOrderIndexRow,
  type PhysicianOrderMemberHistoryRow,
  type PhysicianOrderOperationalFlags,
  type PhysicianOrderSaveInput,
  type PhysicianOrderStatus
} from "@/lib/services/physician-order-model";
import { listActiveMemberLookupSupabase } from "@/lib/services/shared-lookups-supabase";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
type PhysicianOrderIndexSelectRow = {
  id: string;
  member_id: string;
  members: Array<{ display_name: string | null }> | { display_name: string | null } | null;
  status: string | null;
  level_of_care: string | null;
  provider_name: string | null;
  sent_at: string | null;
  next_renewal_due_date: string | null;
  signed_at: string | null;
  updated_at: string;
};

type PhysicianOrderMemberHistorySelectRow = {
  id: string;
  member_id: string;
  member_name_snapshot: string | null;
  status: string | null;
  provider_name: string | null;
  sent_at: string | null;
  next_renewal_due_date: string | null;
  signed_at: string | null;
  updated_by_name: string | null;
  updated_at: string;
};

export {
  OPHTHALMIC_LATERALITY_OPTIONS,
  OTIC_LATERALITY_OPTIONS,
  POF_DEFAULT_MEDICATION_FORM,
  POF_DEFAULT_MEDICATION_QUANTITY,
  POF_DEFAULT_MEDICATION_ROUTE,
  POF_LEVEL_OF_CARE_OPTIONS,
  POF_MEDICATION_FORM_OPTIONS,
  POF_MEDICATION_ROUTE_OPTIONS,
  POF_NUTRITION_OPTIONS,
  POF_STANDING_ORDER_OPTIONS
};
export type { PhysicianOrderClinicalSyncStatus };
export type {
  EnrollmentPacketPrefillMeta,
  PhysicianOrderAdlProfile,
  PhysicianOrderAllergy,
  PhysicianOrderCareInformation,
  PhysicianOrderDiagnosis,
  PhysicianOrderForm,
  PhysicianOrderIndexRow,
  PhysicianOrderMemberHistoryRow,
  PhysicianOrderMedication,
  PhysicianOrderOperationalFlags,
  PhysicianOrderOrientationProfile,
  PhysicianOrderRenewalStatus,
  PhysicianOrderSaveInput,
  PhysicianOrderStatus,
  ProviderSignatureStatus
} from "@/lib/services/physician-order-model";

const CREATE_DRAFT_POF_FROM_INTAKE_RPC = "rpc_create_draft_physician_order_from_intake";
const CREATE_DRAFT_POF_FROM_INTAKE_MIGRATION = "0055_intake_draft_pof_atomic_creation.sql";

async function loadPofDocumentPdfBuilder() {
  const { buildPofDocumentPdfBytes } = await import("@/lib/services/pof-document-pdf");
  return buildPofDocumentPdfBytes;
}

async function loadMarWorkflowService() {
  return import("@/lib/services/mar-workflow");
}

async function loadIntakeToPofMapping() {
  return import("@/lib/services/intake-to-pof-mapping");
}

type CreateDraftPofFromIntakeRpcRow = {
  physician_order_id: string;
  draft_pof_status: string;
  was_existing: boolean;
};

function buildDraftPhysicianOrderFromIntakeFallback(input: {
  physicianOrderId: string;
  assessment: IntakeAssessmentForPofPrefill;
  memberName: string;
  memberDob: string | null;
  sex: "M" | "F" | null;
  now: string;
  mapped: Awaited<ReturnType<Awaited<ReturnType<typeof loadIntakeToPofMapping>>["mapIntakeAssessmentToPofPrefill"]>>;
  actor: { id: string; fullName: string; signoffName?: string | null };
}) {
  const providerName = clean(input.actor.signoffName) ?? input.actor.fullName;
  return {
    id: input.physicianOrderId,
    memberId: input.assessment.member_id,
    intakeAssessmentId: input.assessment.id,
    memberNameSnapshot: input.memberName,
    memberDobSnapshot: clean(input.memberDob),
    sex: input.sex,
    levelOfCare: null,
    dnrSelected: input.mapped.dnrSelected,
    vitalsBloodPressure: input.mapped.vitalsBloodPressure,
    vitalsPulse: input.mapped.vitalsPulse,
    vitalsOxygenSaturation: input.mapped.vitalsOxygenSaturation,
    vitalsRespiration: input.mapped.vitalsRespiration,
    diagnosisRows: [],
    diagnoses: [],
    allergyRows: input.mapped.allergyRows,
    allergies: input.mapped.allergyRows
      .map((row) => clean(row.allergyName))
      .filter((value): value is string => value !== null),
    medications: [],
    standingOrders: POF_STANDING_ORDER_OPTIONS,
    careInformation: {
      ...defaultCareInformation(),
      ...input.mapped.careInformation
    },
    operationalFlags: input.mapped.operationalFlags,
    providerName,
    providerSignature: providerName,
    providerSignatureDate: null,
    status: "Draft" as const,
    providerSignatureStatus: "Pending" as const,
    createdByUserId: input.actor.id,
    createdByName: input.actor.fullName,
    createdAt: input.now,
    completedByUserId: null,
    completedByName: null,
    completedDate: null,
    nextRenewalDueDate: null,
    signedBy: null,
    signedDate: null,
    clinicalSyncStatus: "not_signed" as const,
    clinicalSyncReady: false,
    supersededAt: null,
    supersededByPofId: null,
    updatedByUserId: input.actor.id,
    updatedByName: input.actor.fullName,
    updatedAt: input.now,
    enrollmentPacketPrefill: null
  };
}

export type SignPhysicianOrderResult = {
  postSignStatus: "synced" | "queued";
  queueId: string;
  attemptCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
};

async function runPostSignSyncCascade(input: {
  pofId: string;
  memberId: string;
  syncTimestamp: string;
  serviceRole?: boolean;
}) {
  let step: PofPostSignSyncStep = "mhp_mcc";
  try {
    await syncMemberHealthProfileFromSignedPhysicianOrder(input.pofId, { serviceRole: input.serviceRole });
    step = "mar_schedules";
    const scheduleStartDate = toEasternDate(input.syncTimestamp);
    const scheduleEndDate = addDaysDateOnly(scheduleStartDate, 30);
    const { generateMarSchedulesForMember } = await loadMarWorkflowService();
    await generateMarSchedulesForMember({
      memberId: input.memberId,
      startDate: scheduleStartDate,
      endDate: scheduleEndDate,
      serviceRole: input.serviceRole ?? true
    });
    return {
      ok: true as const
    };
  } catch (error) {
    return {
      ok: false as const,
      step,
      errorMessage: buildPostSignSyncError(step, error)
    };
  }
}

async function resolvePhysicianOrderMemberId(rawMemberId: string, actionLabel: string) {
  return resolveCanonicalMemberId(rawMemberId, { actionLabel });
}

async function getMember(memberId: string) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "physician-orders:getMember");
  const supabase = await createClient();
  const { data } = await supabase.from("members").select("id, display_name, dob").eq("id", canonicalMemberId).single();
  return data;
}

export async function listPhysicianOrderMemberLookup() {
  return listActiveMemberLookupSupabase();
}

async function resolvePhysicianOrderSexPrefill(memberId: string): Promise<"M" | "F" | null> {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "resolvePhysicianOrderSexPrefill");
  const supabase = await createClient();
  const [mccResult, mhpResult] = await Promise.all([
    supabase.from("member_command_centers").select("gender").eq("member_id", canonicalMemberId).maybeSingle(),
    supabase.from("member_health_profiles").select("gender").eq("member_id", canonicalMemberId).maybeSingle()
  ]);
  if (mccResult.error) throw new Error(`Unable to load member command center gender for POF prefill: ${mccResult.error.message}`);
  if (mhpResult.error) throw new Error(`Unable to load member health profile gender for POF prefill: ${mhpResult.error.message}`);

  return normalizePhysicianOrderSex(mccResult.data?.gender) ?? normalizePhysicianOrderSex(mhpResult.data?.gender);
}

export async function getPhysicianOrders(filters?: {
  memberId?: string | null;
  status?: PhysicianOrderStatus | "all";
  q?: string;
}): Promise<PhysicianOrderIndexRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("physician_orders")
    .select(PHYSICIAN_ORDER_INDEX_SELECT)
    .order("updated_at", { ascending: false });

  if (filters?.memberId) {
    const canonicalMemberId = await resolvePhysicianOrderMemberId(filters.memberId, "getPhysicianOrders");
    query = query.eq("member_id", canonicalMemberId);
  }
  if (filters?.status && filters.status !== "all") query = query.eq("status", fromStatus(filters.status));

  const { data, error } = await query;
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) {
      throw physicianOrdersTableRequiredError();
    }
    throw new Error(error.message);
  }

  const queueStatuses = await loadPostSignQueueStatusByPofIds(
    ((data ?? []) as Array<{ id: string }>).map((row) => String(row.id)),
    { serviceRole: true }
  );

  return ((data ?? []) as unknown as PhysicianOrderIndexSelectRow[])
    .map((row) => {
      const memberRelation = Array.isArray(row.members) ? row.members[0] ?? null : row.members;
      const status = toStatus(row.status);
      return {
        id: row.id,
        memberId: row.member_id,
        memberName: memberRelation?.display_name ?? "Unknown Member",
        status,
        levelOfCare: row.level_of_care,
        providerName: row.provider_name,
        completedDate: row.sent_at ? String(row.sent_at).slice(0, 10) : null,
        nextRenewalDueDate: row.next_renewal_due_date,
        renewalStatus: resolveRenewalStatus(row.next_renewal_due_date),
        signedDate: row.signed_at ? String(row.signed_at).slice(0, 10) : null,
        clinicalSyncStatus: resolvePhysicianOrderClinicalSyncStatus({
          status,
          queueStatus: queueStatuses.get(String(row.id))?.status ?? null,
          lastError: queueStatuses.get(String(row.id))?.lastError ?? null,
          lastFailedStep: queueStatuses.get(String(row.id))?.lastFailedStep ?? null
        }),
        updatedAt: row.updated_at
      };
    })
    .filter((row) => {
      const q = (filters?.q ?? "").trim().toLowerCase();
      if (!q) return true;
      return (
        row.memberName.toLowerCase().includes(q) ||
        String(row.providerName ?? "").toLowerCase().includes(q) ||
        row.status.toLowerCase().includes(q)
      );
    });
}

export async function getPhysicianOrdersForMember(memberId: string): Promise<PhysicianOrderMemberHistoryRow[]> {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "getPhysicianOrdersForMember");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("physician_orders")
    .select(PHYSICIAN_ORDER_MEMBER_HISTORY_SELECT)
    .eq("member_id", canonicalMemberId)
    .order("updated_at", { ascending: false });
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) {
      throw physicianOrdersTableRequiredError();
    }
    throw new Error(error.message);
  }
  const rows = (data ?? []) as unknown as PhysicianOrderMemberHistorySelectRow[];
  const queueStatuses = await loadPostSignQueueStatusByPofIds(
    rows.map((row) => String(row.id)),
    { serviceRole: true }
  );
  return rows.map((row) => {
    const status = toStatus(row.status);
    return {
      id: row.id,
      memberId: row.member_id,
      memberNameSnapshot: clean(row.member_name_snapshot) ?? "Unknown Member",
      status,
      providerName: clean(row.provider_name),
      completedDate: row.sent_at ? String(row.sent_at).slice(0, 10) : null,
      nextRenewalDueDate: row.next_renewal_due_date ?? null,
      signedDate: row.signed_at ? String(row.signed_at).slice(0, 10) : null,
      clinicalSyncStatus: resolvePhysicianOrderClinicalSyncStatus({
        status,
        queueStatus: queueStatuses.get(String(row.id))?.status ?? null,
        lastError: queueStatuses.get(String(row.id))?.lastError ?? null,
        lastFailedStep: queueStatuses.get(String(row.id))?.lastFailedStep ?? null
      }),
      updatedByName: clean(row.updated_by_name),
      updatedAt: row.updated_at
    };
  });
}

export async function getActivePhysicianOrderForMember(memberId: string) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "getActivePhysicianOrderForMember");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("physician_orders")
    .select(PHYSICIAN_ORDER_WITH_MEMBER_SELECT)
    .eq("member_id", canonicalMemberId)
    .eq("is_active_signed", true)
    .maybeSingle();
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) throw physicianOrdersTableRequiredError();
    throw new Error(error.message);
  }
  if (!data) return null;
  const queueStatuses = await loadPostSignQueueStatusByPofIds([String((data as { id: string }).id)], {
    serviceRole: true
  });
  return rowToForm(
    data,
    resolvePhysicianOrderClinicalSyncStatus({
      status: toStatus((data as { status: string }).status),
      queueStatus: queueStatuses.get(String((data as { id: string }).id))?.status ?? null,
      lastError: queueStatuses.get(String((data as { id: string }).id))?.lastError ?? null,
      lastFailedStep: queueStatuses.get(String((data as { id: string }).id))?.lastFailedStep ?? null
    })
  );
}

export async function getPhysicianOrderById(
  pofId: string,
  options?: {
    serviceRole?: boolean;
  }
) {
  const supabase = await createClient({ serviceRole: options?.serviceRole });
  const { data, error } = await supabase
    .from("physician_orders")
    .select(PHYSICIAN_ORDER_WITH_MEMBER_SELECT)
    .eq("id", pofId)
    .maybeSingle();
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) throw physicianOrdersTableRequiredError();
    throw new Error(error.message);
  }
  if (!data) return null;
  const queueStatuses = await loadPostSignQueueStatusByPofIds([String((data as { id: string }).id)], {
    serviceRole: true
  });
  return rowToForm(
    data,
    resolvePhysicianOrderClinicalSyncStatus({
      status: toStatus((data as { status: string }).status),
      queueStatus: queueStatuses.get(String((data as { id: string }).id))?.status ?? null,
      lastError: queueStatuses.get(String((data as { id: string }).id))?.lastError ?? null,
      lastFailedStep: queueStatuses.get(String((data as { id: string }).id))?.lastFailedStep ?? null
    })
  );
}

export async function getPhysicianOrderClinicalSyncState(
  pofId: string,
  options?: {
    serviceRole?: boolean;
  }
): Promise<PhysicianOrderClinicalSyncStatus> {
  const form = await getPhysicianOrderById(pofId, { serviceRole: options?.serviceRole });
  return form?.clinicalSyncStatus ?? "not_signed";
}

export async function buildNewPhysicianOrderDraft(input: {
  memberId: string;
  actor: { id: string; fullName: string; signoffName?: string | null };
}): Promise<PhysicianOrderForm | null> {
  const memberId = await resolvePhysicianOrderMemberId(input.memberId, "buildNewPhysicianOrderDraft");
  const member = await getMember(memberId);
  if (!member) return null;
  const sexPrefill = await resolvePhysicianOrderSexPrefill(memberId);

  const supabase = await createClient();
  const { data: latestIntake, error: latestIntakeError } = await supabase
    .from("intake_assessments")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestIntakeError) {
    throw new Error(`Unable to load latest intake assessment for POF draft prefill: ${latestIntakeError.message}`);
  }

  const { mapIntakeAssessmentToPofPrefill } = await loadIntakeToPofMapping();
  const mapped = latestIntake ? mapIntakeAssessmentToPofPrefill(latestIntake as IntakeAssessmentForPofPrefill) : null;
  const enrollmentPacketPrefill = await getLatestEnrollmentPacketPofStagingSummary(memberId);
  const activeEnrollmentPacketPrefill = enrollmentPacketPrefill?.reviewRequired ? enrollmentPacketPrefill : null;
  const shouldApplyEnrollmentPacketPrefill = activeEnrollmentPacketPrefill !== null;
  const baseCareInformation = mapped
    ? ({ ...defaultCareInformation(), ...mapped.careInformation } as PhysicianOrderCareInformation)
    : defaultCareInformation();
  const baseOperationalFlags = mapped
    ? ({ ...defaultOperationalFlags(), ...mapped.operationalFlags } as PhysicianOrderOperationalFlags)
    : defaultOperationalFlags();
  const staged = shouldApplyEnrollmentPacketPrefill
    ? applyEnrollmentPacketPrefillToDraft({
        careInformation: baseCareInformation,
        operationalFlags: baseOperationalFlags,
        prefillPayload: activeEnrollmentPacketPrefill.prefillPayload
      })
    : {
        careInformation: baseCareInformation,
        operationalFlags: baseOperationalFlags
      };
  const now = toEasternISO();

  return {
    id: "",
    memberId,
    intakeAssessmentId: latestIntake?.id ?? null,
    memberNameSnapshot: member.display_name,
    memberDobSnapshot: clean(member.dob),
    sex: sexPrefill,
    levelOfCare: "Home",
    dnrSelected: mapped?.dnrSelected ?? false,
    vitalsBloodPressure: mapped?.vitalsBloodPressure ?? null,
    vitalsPulse: mapped?.vitalsPulse ?? null,
    vitalsOxygenSaturation: mapped?.vitalsOxygenSaturation ?? null,
    vitalsRespiration: mapped?.vitalsRespiration ?? null,
    diagnosisRows: [],
    diagnoses: [],
    allergyRows: mapped?.allergyRows.map((row, idx) => ({ ...row, id: `new-allergy-${idx + 1}` })) ?? [],
    allergies: mapped?.allergyRows.map((row) => row.allergyName) ?? [],
    medications: [],
    standingOrders: [...POF_STANDING_ORDER_OPTIONS],
    careInformation: staged.careInformation,
    operationalFlags: staged.operationalFlags,
    providerName: clean(input.actor.signoffName) ?? input.actor.fullName,
    providerSignature: clean(input.actor.signoffName) ?? input.actor.fullName,
    providerSignatureDate: null,
    status: "Draft",
    providerSignatureStatus: "Pending",
    createdByUserId: input.actor.id,
    createdByName: input.actor.fullName,
    createdAt: now,
    completedByUserId: null,
    completedByName: null,
    completedDate: null,
    nextRenewalDueDate: null,
    signedBy: null,
    signedDate: null,
    clinicalSyncStatus: "not_signed",
    clinicalSyncReady: false,
    supersededAt: null,
    supersededByPofId: null,
    updatedByUserId: input.actor.id,
    updatedByName: input.actor.fullName,
    updatedAt: now,
    enrollmentPacketPrefill: shouldApplyEnrollmentPacketPrefill
      ? {
          stagingId: activeEnrollmentPacketPrefill.stagingId,
          packetId: activeEnrollmentPacketPrefill.packetId,
          sourceLabel: activeEnrollmentPacketPrefill.sourceLabel,
          importedAt: activeEnrollmentPacketPrefill.importedAt,
          caregiverName: activeEnrollmentPacketPrefill.caregiverName,
          initiatedByName: activeEnrollmentPacketPrefill.initiatedByName,
          riskSignals: activeEnrollmentPacketPrefill.riskSignals
        }
      : null
  };
}

async function nextVersionNumber(memberId: string) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "nextVersionNumber");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("physician_orders")
    .select("version_number")
    .eq("member_id", canonicalMemberId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) throw physicianOrdersTableRequiredError();
    throw new Error(error.message);
  }
  return Number(data?.version_number ?? 0) + 1;
}

export async function createDraftPhysicianOrderFromAssessment(input: {
  assessment: IntakeAssessmentForPofPrefill;
  actor: { id: string; fullName: string; signoffName?: string | null };
  intakeSignature?: IntakeAssessmentSignatureState;
}) {
  const supabase = await createClient();
  const member = await getMember(input.assessment.member_id);
  if (!member) throw new Error("Member not found for intake assessment.");
  const sexPrefill = await resolvePhysicianOrderSexPrefill(input.assessment.member_id);

  const { mapIntakeAssessmentToPofPrefill } = await loadIntakeToPofMapping();
  const mapped = mapIntakeAssessmentToPofPrefill(input.assessment);
  const now = toEasternISO();
  const payload = {
    member_id: input.assessment.member_id,
    intake_assessment_id: input.assessment.id,
    status: "draft",
    is_active_signed: false,
    member_name_snapshot: member.display_name,
    member_dob_snapshot: clean(member.dob),
    sex: sexPrefill,
    dnr_selected: mapped.dnrSelected,
    vitals_blood_pressure: mapped.vitalsBloodPressure,
    vitals_pulse: mapped.vitalsPulse,
    vitals_oxygen_saturation: mapped.vitalsOxygenSaturation,
    vitals_respiration: mapped.vitalsRespiration,
    diagnoses: [],
    allergies: mapped.allergyRows,
    medications: [],
    standing_orders: POF_STANDING_ORDER_OPTIONS,
    diet_order: {
      diets: mapped.careInformation.nutritionDiets,
      other: mapped.careInformation.nutritionDietOther
    },
    mobility_order: {
      ambulatoryStatus: mapped.careInformation.ambulatoryStatus,
      mobilityWalker: mapped.careInformation.mobilityWalker,
      mobilityWheelchair: mapped.careInformation.mobilityWheelchair,
      mobilityOther: mapped.careInformation.mobilityOther,
      mobilityOtherText: mapped.careInformation.mobilityOtherText
    },
    adl_support: mapped.careInformation.adlProfile,
    continence_support: {
      bladderContinent: mapped.careInformation.bladderContinent,
      bladderIncontinent: mapped.careInformation.bladderIncontinent,
      bowelContinent: mapped.careInformation.bowelContinent,
      bowelIncontinent: mapped.careInformation.bowelIncontinent
    },
    behavior_orientation: mapped.careInformation.orientationProfile,
    clinical_support: {
      ...defaultCareInformation(),
      ...mapped.careInformation
    },
    nutrition_orders: {
      diets: mapped.careInformation.nutritionDiets,
      nutritionDietOther: mapped.careInformation.nutritionDietOther
    },
    operational_flags: mapped.operationalFlags,
    provider_name: clean(input.actor.signoffName) ?? input.actor.fullName,
    provider_signature: clean(input.actor.signoffName) ?? input.actor.fullName,
    signature_metadata: input.intakeSignature
      ? {
          sourceIntakeAssessmentSignature: {
            status: input.intakeSignature.status,
            signedByUserId: input.intakeSignature.signedByUserId,
            signedByName: input.intakeSignature.signedByName,
            signedAt: input.intakeSignature.signedAt
          }
        }
      : {},
    created_by_user_id: input.actor.id,
    created_by_name: input.actor.fullName,
    updated_by_user_id: input.actor.id,
    updated_by_name: input.actor.fullName,
    created_at: now,
    updated_at: now
  };

  let rpcData: unknown;
  try {
    rpcData = await invokeSupabaseRpcOrThrow<unknown>(supabase, CREATE_DRAFT_POF_FROM_INTAKE_RPC, {
      p_assessment_id: input.assessment.id,
      p_member_id: input.assessment.member_id,
      p_payload: payload,
      p_attempted_at: now
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create draft physician order from intake.";
    if (message.includes(CREATE_DRAFT_POF_FROM_INTAKE_RPC)) {
      throw new Error(
        `Intake draft physician order RPC is not available. Apply Supabase migration ${CREATE_DRAFT_POF_FROM_INTAKE_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw new Error(mapPhysicianOrderWriteError(error as PostgrestErrorLike, "Unable to create draft physician order from intake."));
  }

  const row = (Array.isArray(rpcData) ? rpcData[0] : null) as CreateDraftPofFromIntakeRpcRow | null;
  if (!row?.physician_order_id) {
    throw new Error("Intake draft physician order RPC did not return the physician order id.");
  }

  const saved = await getPhysicianOrderById(row.physician_order_id, { serviceRole: true });
  if (saved) return saved;

  try {
    await recordImmediateSystemAlert({
      entityType: "intake_assessment",
      entityId: input.assessment.id,
      actorUserId: input.actor.id,
      severity: "medium",
      alertKey: "intake_draft_pof_post_commit_reload_failed",
      metadata: {
        member_id: input.assessment.member_id,
        physician_order_id: row.physician_order_id,
        rpc_name: CREATE_DRAFT_POF_FROM_INTAKE_RPC,
        draft_pof_status: row.draft_pof_status,
        was_existing: row.was_existing
      }
    });
  } catch (alertError) {
    console.error("[physician-orders] unable to persist post-commit draft POF reload alert", alertError);
  }

  // The RPC is the canonical success boundary for draft creation. If the immediate reread
  // misses, return a deterministic fallback snapshot rather than downgrading the intake.
  return buildDraftPhysicianOrderFromIntakeFallback({
    physicianOrderId: row.physician_order_id,
    assessment: input.assessment,
    memberName: member.display_name,
    memberDob: clean(member.dob),
    sex: sexPrefill,
    now,
    mapped,
    actor: input.actor
  });
}

export async function updatePhysicianOrder(input: PhysicianOrderSaveInput) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(input.memberId, "updatePhysicianOrder");
  const supabase = await createClient();
  const existing = input.id ? await getPhysicianOrderById(input.id) : null;
  if (existing && existing.status === "Signed") {
    throw new Error("Signed physician orders are locked. Create a new order to make updates.");
  }

  const member = await getMember(canonicalMemberId);
  if (!member) throw new Error("Member not found.");
  const diagnosisRows = sanitizeDiagnosisRows(input.diagnosisRows);
  const allergyRows = sanitizeAllergyRows(input.allergyRows);
  const medications = sanitizeMedicationRows(input.medications);

  const wantsSigned = input.status === "Signed";
  // Avoid tripping uniq_physician_orders_active_signed before we supersede old active orders.
  // We persist as Sent first, then finalize signed state in signPhysicianOrder.
  const persistedStatus: PhysicianOrderStatus = wantsSigned ? "Sent" : input.status;
  const now = toEasternISO();
  const sentAt = persistedStatus === "Sent" ? now : null;
  const signedAt = null;
  const nextRenewalDueDate = sentAt ? calculateRenewalDueDate(sentAt.slice(0, 10)) : null;

  const payload = {
    member_id: canonicalMemberId,
    intake_assessment_id: clean(input.intakeAssessmentId),
    status: fromStatus(persistedStatus),
    is_active_signed: false,
    member_name_snapshot: member.display_name,
    member_dob_snapshot: clean(input.memberDobSnapshot),
    sex: input.sex,
    level_of_care: input.levelOfCare,
    dnr_selected: input.dnrSelected,
    vitals_blood_pressure: clean(input.vitalsBloodPressure),
    vitals_pulse: clean(input.vitalsPulse),
    vitals_oxygen_saturation: clean(input.vitalsOxygenSaturation),
    vitals_respiration: clean(input.vitalsRespiration),
    diagnoses: diagnosisRows,
    allergies: allergyRows,
    medications,
    standing_orders: sanitizeList(input.standingOrders),
    diet_order: {
      diets: input.careInformation.nutritionDiets,
      other: input.careInformation.nutritionDietOther
    },
    mobility_order: {
      ambulatoryStatus: input.careInformation.ambulatoryStatus,
      mobilityIndependent: input.careInformation.mobilityIndependent,
      mobilityWalker: input.careInformation.mobilityWalker,
      mobilityWheelchair: input.careInformation.mobilityWheelchair,
      mobilityScooter: input.careInformation.mobilityScooter,
      mobilityOther: input.careInformation.mobilityOther,
      mobilityOtherText: input.careInformation.mobilityOtherText
    },
    adl_support: input.careInformation.adlProfile,
    continence_support: {
      bladderContinent: input.careInformation.bladderContinent,
      bladderIncontinent: input.careInformation.bladderIncontinent,
      bowelContinent: input.careInformation.bowelContinent,
      bowelIncontinent: input.careInformation.bowelIncontinent
    },
    behavior_orientation: input.careInformation.orientationProfile,
    clinical_support: input.careInformation,
    nutrition_orders: {
      nutritionDiets: input.careInformation.nutritionDiets,
      nutritionDietOther: input.careInformation.nutritionDietOther
    },
    operational_flags: { ...input.operationalFlags, dnr: input.dnrSelected },
    provider_name: clean(input.providerName),
    provider_signature: clean(input.providerSignature),
    provider_signature_date: clean(input.providerSignatureDate),
    sent_at: sentAt,
    signed_at: signedAt,
    signed_by_name: null,
    next_renewal_due_date: nextRenewalDueDate,
    updated_by_user_id: input.actor.id,
    updated_by_name: input.actor.fullName,
    updated_at: now
  };

  if (existing) {
    const { error } = await supabase.from("physician_orders").update(payload).eq("id", existing.id);
    if (error) {
      if (isMissingPhysicianOrdersTableError(error)) throw physicianOrdersTableRequiredError();
      throw new Error(mapPhysicianOrderWriteError(error, "Unable to update physician order."));
    }
    if (wantsSigned) {
      await signPhysicianOrder(existing.id, input.actor);
    }
    const saved = await getPhysicianOrderById(existing.id);
    if (!saved) throw new Error("Unable to load saved physician order.");
    await markEnrollmentPacketPofStagingReviewed({
      memberId: canonicalMemberId,
      actorUserId: input.actor.id,
      actorName: input.actor.fullName
    });
    return saved;
  }

  const version = await nextVersionNumber(canonicalMemberId);
  const { data, error } = await supabase
    .from("physician_orders")
    .insert({
      ...payload,
      version_number: version,
      created_by_user_id: input.actor.id,
      created_by_name: input.actor.fullName,
      created_at: now
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) throw physicianOrdersTableRequiredError();
    throw new Error(mapPhysicianOrderWriteError(error, "Unable to create physician order."));
  }
  if (wantsSigned) {
    await signPhysicianOrder(data.id, input.actor);
  }
  const saved = await getPhysicianOrderById(data.id);
  if (!saved) throw new Error("Unable to load saved physician order.");
  await markEnrollmentPacketPofStagingReviewed({
    memberId: canonicalMemberId,
    actorUserId: input.actor.id,
    actorName: input.actor.fullName
  });
  return saved;
}

export async function processSignedPhysicianOrderPostSignSync(input: {
  pofId: string;
  memberId: string;
  queueId: string;
  queueAttemptCount: number;
  actor: { id: string; fullName: string };
  signedAtIso: string;
  pofRequestId?: string | null;
  serviceRole?: boolean;
}): Promise<SignPhysicianOrderResult> {
  const attemptCount = Math.max(0, Number(input.queueAttemptCount ?? 0)) + 1;
  const postSign = await runPostSignSyncCascade({
    pofId: input.pofId,
    memberId: input.memberId,
    syncTimestamp: input.signedAtIso,
    serviceRole: input.serviceRole
  });

  if (postSign.ok) {
    await markPostSignQueueCompleted({
      queueId: input.queueId,
      attemptCount,
      actor: input.actor,
      completedAt: input.signedAtIso,
      pofRequestId: input.pofRequestId,
      serviceRole: input.serviceRole
    });
    await logSystemEvent({
      event_type: "pof_post_sign_sync_completed",
      entity_type: "physician_order",
      entity_id: input.pofId,
      actor_type: "user",
      actor_id: input.actor.id,
      actor_user_id: input.actor.id,
      status: "completed",
      severity: "low",
      metadata: {
        member_id: input.memberId,
        queue_id: input.queueId,
        attempt_count: attemptCount,
        pof_request_id: clean(input.pofRequestId)
      }
    }, { required: false });
    return {
      postSignStatus: "synced",
      queueId: input.queueId,
      attemptCount,
      nextRetryAt: null,
      lastError: null
    };
  }

  const nextRetryAt = computePostSignRetryAt(attemptCount, input.signedAtIso);
  await markPostSignQueueQueued({
    queueId: input.queueId,
    attemptCount,
    step: postSign.step,
    errorMessage: postSign.errorMessage,
    nextRetryAt,
    pofRequestId: input.pofRequestId,
    actor: input.actor,
    queuedAt: input.signedAtIso,
    serviceRole: input.serviceRole
    });
  await logSystemEvent({
    event_type: "pof_post_sign_sync_queued_for_retry",
    entity_type: "physician_order",
    entity_id: input.pofId,
    actor_type: "user",
    actor_id: input.actor.id,
    actor_user_id: input.actor.id,
    status: "retry_pending",
    severity: attemptCount >= 3 ? "high" : "medium",
    metadata: {
      member_id: input.memberId,
      queue_id: input.queueId,
      attempt_count: attemptCount,
      failed_step: postSign.step,
      next_retry_at: nextRetryAt,
      last_error: postSign.errorMessage,
      pof_request_id: clean(input.pofRequestId)
    }
  }, { required: false });
  if (attemptCount >= 3) {
    await recordImmediateSystemAlert({
      entityType: "physician_order",
      entityId: input.pofId,
      actorUserId: input.actor.id,
      severity: "high",
      alertKey: "pof_post_sign_sync_failed",
      metadata: {
        member_id: input.memberId,
        queue_id: input.queueId,
        attempt_count: attemptCount,
        failed_step: postSign.step,
        next_retry_at: nextRetryAt,
        last_error: postSign.errorMessage,
        pof_request_id: clean(input.pofRequestId)
      }
    });
  }
  return {
    postSignStatus: "queued",
    queueId: input.queueId,
    attemptCount,
    nextRetryAt,
    lastError: postSign.errorMessage
  };
}

export async function signPhysicianOrder(
  pofId: string,
  actor: { id: string; fullName: string },
  options?: {
    serviceRole?: boolean;
    signedAtIso?: string;
    pofRequestId?: string | null;
  }
): Promise<SignPhysicianOrderResult> {
  const signedAtIso = options?.signedAtIso ?? toEasternISO();
  const transition = await invokeSignPhysicianOrderRpc({
    pofId,
    actor,
    signedAtIso,
    pofRequestId: options?.pofRequestId,
    serviceRole: options?.serviceRole
  });

  return processSignedPhysicianOrderPostSignSync({
    pofId: transition.physician_order_id,
    memberId: transition.member_id,
    queueId: transition.queue_id,
    queueAttemptCount: transition.queue_attempt_count,
    actor,
    signedAtIso,
    pofRequestId: options?.pofRequestId,
    serviceRole: options?.serviceRole
  });
}

export async function retryQueuedPhysicianOrderPostSignSync(input?: {
  limit?: number;
  serviceRole?: boolean;
  actor?: { id: string | null; fullName: string | null };
}) {
  const serviceRole = input?.serviceRole ?? true;
  const now = toEasternISO();
  const limit = Math.min(100, Math.max(1, input?.limit ?? 25));
  const actor = input?.actor ?? {
    id: null,
    fullName: "System Post-Sign Sync Retry"
  };
  const rows = await claimQueuedPhysicianOrderPostSignSyncRows({
    limit,
    claimAt: now,
    actor,
    serviceRole
  });

  let processed = 0;
  let succeeded = 0;
  let queued = 0;

  for (const row of rows) {
    processed += 1;
    const attemptCount = Math.max(0, Number(row.attempt_count ?? 0)) + 1;
    const postSign = await runPostSignSyncCascade({
      pofId: row.physician_order_id,
      memberId: row.member_id,
      syncTimestamp: now,
      serviceRole
    });

    if (postSign.ok) {
      await markPostSignQueueCompleted({
        queueId: row.id,
        attemptCount,
        actor,
        completedAt: now,
        pofRequestId: row.pof_request_id,
        serviceRole
      });
      succeeded += 1;
      continue;
    }

    const nextRetryAt = computePostSignRetryAt(attemptCount, now);
    await markPostSignQueueQueued({
      queueId: row.id,
      attemptCount,
      step: postSign.step,
      errorMessage: postSign.errorMessage,
      nextRetryAt,
      pofRequestId: row.pof_request_id,
      actor,
      queuedAt: now,
      serviceRole
    });
    queued += 1;
  }

  const agedQueueAlertSummary = await emitAgedPostSignSyncQueueAlerts({
    nowIso: now,
    serviceRole,
    actorUserId: actor.id
  });

  return {
    processed,
    succeeded,
    queued,
    agedQueueRows: agedQueueAlertSummary.agedQueueRows,
    agedQueueAlertsRaised: agedQueueAlertSummary.alertsRaised,
    agedQueueAlertAgeMinutes: agedQueueAlertSummary.alertAgeMinutes
  };
}

export async function syncMemberHealthProfileFromSignedPhysicianOrder(
  pofId: string,
  options?: {
    serviceRole?: boolean;
  }
) {
  const form = await getPhysicianOrderById(pofId, { serviceRole: options?.serviceRole });
  if (!form) throw new Error("Physician order not found for sync.");
  if (form.status !== "Signed") return null;
  await invokeSyncSignedPofToMemberClinicalProfileRpc({
    pofId,
    syncTimestamp: toEasternISO(),
    serviceRole: options?.serviceRole
  });

  return getMemberHealthProfile(form.memberId);
}

export async function getMemberHealthProfile(memberId: string) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "getMemberHealthProfile");
  const supabase = await createClient();
  const { data, error } = await supabase.from("member_health_profiles").select("*").eq("member_id", canonicalMemberId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function savePhysicianOrderForm(input: PhysicianOrderSaveInput) {
  return updatePhysicianOrder(input);
}

export async function buildPhysicianOrderPdfDataUrl(
  pofId: string,
  options?: {
    serviceRole?: boolean;
  }
) {
  const form = await getPhysicianOrderById(pofId, { serviceRole: options?.serviceRole });
  if (!form) throw new Error("Physician Order Form not found.");

  const now = toEasternISO();
  const buildPofDocumentPdfBytes = await loadPofDocumentPdfBuilder();
  const bytes = await buildPofDocumentPdfBytes({
    form,
    title: "Physician Order Form",
    metaLines: [`Generated: ${now}`]
  });
  return {
    form,
    fileName: `POF - ${form.memberNameSnapshot} - ${toEasternDate(now)}.pdf`,
    dataUrl: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`,
    generatedAt: now
  };
}
