import { Buffer } from "node:buffer";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { POF_STANDING_ORDER_OPTIONS } from "@/lib/services/physician-order-config";
import type { IntakeAssessmentForPofPrefill } from "@/lib/services/intake-to-pof-mapping";
import type { IntakeAssessmentSignatureState } from "@/lib/services/intake-assessment-esign";
import { logSystemEvent } from "@/lib/services/system-event-service";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import {
  claimQueuedPhysicianOrderPostSignSyncRows,
  emitAgedPostSignSyncQueueAlerts,
  invokeSignPhysicianOrderRpc,
  invokeSyncSignedPofToMemberClinicalProfileRpc,
  markPostSignQueueCompleted,
  markPostSignQueueQueued
} from "@/lib/services/physician-order-post-sign-runtime";
import {
  getLatestEnrollmentPacketPofStagingSummary,
  markEnrollmentPacketPofStagingReviewed
} from "@/lib/services/enrollment-packet-intake-staging";
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
  sanitizeAllergyRows,
  sanitizeDiagnosisRows,
  sanitizeList,
  sanitizeMedicationRows,
  type PofPostSignSyncStep,
  type PostgrestErrorLike
} from "@/lib/services/physician-order-core";
import {
  defaultCareInformation,
  defaultOperationalFlags,
  type PhysicianOrderCareInformation,
  type PhysicianOrderForm,
  type PhysicianOrderOperationalFlags,
  type PhysicianOrderSaveInput,
  type PhysicianOrderStatus
} from "@/lib/services/physician-order-model";
import { getMemberHealthProfile, getPhysicianOrderById } from "@/lib/services/physician-orders-read";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

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

type ResolvePhysicianOrderMemberOptions = {
  canonicalInput?: boolean;
};

async function resolvePhysicianOrderMemberId(
  rawMemberId: string,
  actionLabel: string,
  options?: ResolvePhysicianOrderMemberOptions
) {
  if (options?.canonicalInput) return rawMemberId;
  return resolveCanonicalMemberId(rawMemberId, { actionLabel });
}

async function getMember(memberId: string, options?: ResolvePhysicianOrderMemberOptions) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "physician-orders:getMember", options);
  const supabase = await createClient();
  const { data } = await supabase.from("members").select("id, display_name, dob").eq("id", canonicalMemberId).single();
  return data;
}

async function resolvePhysicianOrderSexPrefill(
  memberId: string,
  options?: ResolvePhysicianOrderMemberOptions
): Promise<"M" | "F" | null> {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "resolvePhysicianOrderSexPrefill", options);
  const supabase = await createClient();
  const [mccResult, mhpResult] = await Promise.all([
    supabase.from("member_command_centers").select("gender").eq("member_id", canonicalMemberId).maybeSingle(),
    supabase.from("member_health_profiles").select("gender").eq("member_id", canonicalMemberId).maybeSingle()
  ]);
  if (mccResult.error) throw new Error(`Unable to load member command center gender for POF prefill: ${mccResult.error.message}`);
  if (mhpResult.error) throw new Error(`Unable to load member health profile gender for POF prefill: ${mhpResult.error.message}`);

  return normalizePhysicianOrderSex(mccResult.data?.gender) ?? normalizePhysicianOrderSex(mhpResult.data?.gender);
}

export async function buildNewPhysicianOrderDraft(input: {
  memberId: string;
  actor: { id: string; fullName: string; signoffName?: string | null };
}): Promise<PhysicianOrderForm | null> {
  const memberId = await resolvePhysicianOrderMemberId(input.memberId, "buildNewPhysicianOrderDraft");
  const member = await getMember(memberId, { canonicalInput: true });
  if (!member) return null;
  const sexPrefill = await resolvePhysicianOrderSexPrefill(memberId, { canonicalInput: true });

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
  const enrollmentPacketPrefill = await getLatestEnrollmentPacketPofStagingSummary(memberId, { canonicalInput: true });
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
    clinicalSyncDetail: null,
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

async function nextVersionNumber(memberId: string, options?: ResolvePhysicianOrderMemberOptions) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "nextVersionNumber", options);
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
  const member = await getMember(input.assessment.member_id, { canonicalInput: true });
  if (!member) throw new Error("Member not found for intake assessment.");
  const sexPrefill = await resolvePhysicianOrderSexPrefill(input.assessment.member_id, { canonicalInput: true });

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

  throw new Error(
    `Draft physician order ${row.physician_order_id} was created, but the canonical reload failed immediately afterward. Reopen the draft from the physician orders list after verifying the saved record.`
  );
}

export async function updatePhysicianOrder(input: PhysicianOrderSaveInput) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(input.memberId, "updatePhysicianOrder");
  const supabase = await createClient();
  const existing = input.id ? await getPhysicianOrderById(input.id) : null;
  if (existing && existing.status === "Signed") {
    throw new Error("Signed physician orders are locked. Create a new order to make updates.");
  }

  const member = await getMember(canonicalMemberId, { canonicalInput: true });
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

  const version = await nextVersionNumber(canonicalMemberId, { canonicalInput: true });
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

  return getMemberHealthProfile(form.memberId, {
    canonicalInput: true,
    serviceRole: options?.serviceRole
  });
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
