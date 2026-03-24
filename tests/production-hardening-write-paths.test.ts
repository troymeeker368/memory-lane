import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("server actions delegate audit logs and time punches to shared services", () => {
  const appActionsSource = readWorkspaceFile("app/actions.ts");
  const marActionsSource = readWorkspaceFile("app/(portal)/health/mar/actions.ts");
  const pricingActionsSource = readWorkspaceFile("app/(portal)/operations/pricing/actions.ts");

  assert.equal(appActionsSource.includes('import { insertAuditLogEntry } from "@/lib/services/audit-log-service";'), true);
  assert.equal(appActionsSource.includes('import { createTimePunchSupabase } from "@/lib/services/time-punches";'), true);
  assert.equal(appActionsSource.includes('from("audit_logs").insert'), false);
  assert.equal(appActionsSource.includes('from("time_punches").insert'), false);

  assert.equal(marActionsSource.includes('import { insertAuditLogEntry } from "@/lib/services/audit-log-service";'), true);
  assert.equal(marActionsSource.includes('from("audit_logs").insert'), false);

  assert.equal(
    pricingActionsSource.includes('import { insertAuditLogEntry } from "@/lib/services/audit-log-service";'),
    true
  );
  assert.equal(pricingActionsSource.includes('from("audit_logs").insert'), false);
  assert.equal(appActionsSource.includes('from("ancillary_charge_categories").update'), false);
  assert.equal(appActionsSource.includes('from("intake_assessments").delete().eq("id", created.id)'), false);
});

test("shared services own ancillary pricing, intake rollback, and audit-log writes", () => {
  const ancillaryWriteSource = readWorkspaceFile("lib/services/ancillary-write-supabase.ts");
  const intakeSource = readWorkspaceFile("lib/services/intake-pof-mhp-cascade.ts");
  const salesCrmSource = readWorkspaceFile("lib/services/sales-crm-supabase.ts");
  const salesLeadActivitiesSource = readWorkspaceFile("lib/services/sales-lead-activities.ts");
  const staffAuthSource = readWorkspaceFile("lib/services/staff-auth.ts");

  assert.equal(ancillaryWriteSource.includes("export async function updateAncillaryCategoryPriceSupabase"), true);
  assert.equal(intakeSource.includes("export async function deleteIntakeAssessmentSupabase"), true);
  assert.equal(intakeSource.includes('rpc_create_intake_assessment_with_responses'), true);
  assert.equal(intakeSource.includes("invokeSupabaseRpcOrThrow"), true);

  assert.equal(salesCrmSource.includes('import { insertAuditLogEntry } from "@/lib/services/audit-log-service";'), true);
  assert.equal(salesLeadActivitiesSource.includes('import { insertAuditLogEntry } from "@/lib/services/audit-log-service";'), true);
  assert.equal(staffAuthSource.includes('import { insertAuditLogEntry } from "@/lib/services/audit-log-service";'), true);
});

test("critical file workflows include cleanup for storage and metadata split-brain", () => {
  const memberFilesSource = readWorkspaceFile("lib/services/member-files.ts");
  const clinicalEsignSource = readWorkspaceFile("lib/services/clinical-esign-artifacts.ts");
  const enrollmentPacketsSource = readWorkspaceFile("lib/services/enrollment-packets.ts");

  assert.equal(memberFilesSource.includes("export async function deleteMemberDocumentObject"), true);
  assert.equal(memberFilesSource.includes("export async function deleteMemberFileRecord"), true);

  assert.equal(clinicalEsignSource.includes("deleteMemberDocumentObject"), true);
  assert.equal(
    clinicalEsignSource.includes("unable to cleanup orphaned signature object"),
    true
  );

  assert.equal(enrollmentPacketsSource.includes("deleteMemberDocumentObject"), true);
  assert.equal(enrollmentPacketsSource.includes("deleteMemberFileRecord"), true);
  assert.equal(enrollmentPacketsSource.includes("enrollment_packet_upload_split_brain"), true);
});

test("intake assessment atomic creation RPC is migration-backed and guarded", () => {
  const intakeSource = readWorkspaceFile("lib/services/intake-pof-mhp-cascade.ts");
  const actionSource = readWorkspaceFile("app/intake-actions.ts");
  const migrationSource = readWorkspaceFile("supabase/migrations/0051_intake_assessment_atomic_creation_rpc.sql");

  assert.equal(intakeSource.includes('const CREATE_INTAKE_ASSESSMENT_RPC = "rpc_create_intake_assessment_with_responses";'), true);
  assert.equal(intakeSource.includes("const supabase = await createClient({ serviceRole: input.serviceRole });"), true);
  assert.equal(intakeSource.includes("if (isMissingRpcFunctionError(error, CREATE_INTAKE_ASSESSMENT_RPC)) {"), true);
  assert.equal(intakeSource.includes("if (message.includes(CREATE_INTAKE_ASSESSMENT_RPC)) {"), false);
  assert.equal(intakeSource.includes("Intake assessment atomic creation RPC is not available."), true);
  assert.equal(intakeSource.includes("0051_intake_assessment_atomic_creation_rpc.sql"), true);
  assert.equal(actionSource.includes("serviceRole: true"), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_create_intake_assessment_with_responses("), true);
  assert.equal(migrationSource.includes("p_response_rows must be a JSON array"), true);
  assert.equal(
    migrationSource.includes(
      "grant execute on function public.rpc_create_intake_assessment_with_responses(jsonb, jsonb) to authenticated, service_role;"
    ),
    true
  );
});

test("intake assessment signature finalization is RPC-backed with cleanup safeguards", () => {
  const intakeEsignSource = readWorkspaceFile("lib/services/intake-assessment-esign.ts");
  const artifactSource = readWorkspaceFile("lib/services/clinical-esign-artifacts.ts");
  const migrationSource = readWorkspaceFile("supabase/migrations/0052_intake_assessment_signature_finalize_rpc.sql");

  assert.equal(
    intakeEsignSource.includes('const FINALIZE_INTAKE_SIGNATURE_RPC = "rpc_finalize_intake_assessment_signature";'),
    true
  );
  assert.equal(intakeEsignSource.includes("invokeSupabaseRpcOrThrow"), true);
  assert.equal(intakeEsignSource.includes("cleanupIntakeSignatureArtifactAfterFinalizeFailure"), true);
  assert.equal(intakeEsignSource.includes("intake_assessment_signature_finalize_split_brain"), true);
  assert.equal(intakeEsignSource.includes("intake_assessment_signature_finalize_cleanup_failed"), true);
  assert.equal(artifactSource.includes("signatureArtifactMemberFileCreated: result.created"), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_finalize_intake_assessment_signature("), true);
  assert.equal(migrationSource.includes("was_already_signed boolean"), true);
  assert.equal(
    migrationSource.includes("grant execute on function public.rpc_finalize_intake_assessment_signature("),
    true
  );
});

test("artifact finalization workflows use replay-safe RPC boundaries and staged cleanup", () => {
  const pofSource = readWorkspaceFile("lib/services/pof-esign.ts");
  const carePlanSource = readWorkspaceFile("lib/services/care-plan-esign.ts");
  const nurseSource = readWorkspaceFile("lib/services/care-plan-nurse-esign.ts");
  const enrollmentSource = readWorkspaceFile("lib/services/enrollment-packets.ts");
  const migrationSource = readWorkspaceFile("supabase/migrations/0053_artifact_drift_replay_hardening.sql");

  assert.equal(pofSource.includes("last_consumed_signature_token_hash"), true);
  assert.equal(pofSource.includes("cleanupFailedPofSignatureArtifacts"), true);
  assert.equal(pofSource.includes("p_consumed_signature_token_hash: consumedTokenHash"), true);
  assert.equal(pofSource.includes("if (finalized.was_already_signed)"), true);

  assert.equal(carePlanSource.includes("last_consumed_caregiver_signature_token_hash"), true);
  assert.equal(carePlanSource.includes("cleanupFailedCarePlanCaregiverArtifacts"), true);
  assert.equal(carePlanSource.includes("p_final_member_file_data_url"), true);
  assert.equal(carePlanSource.includes("if (finalized.wasAlreadySigned)"), true);
  assert.equal(carePlanSource.includes("upsertMemberFileByDocumentSource"), false);

  assert.equal(nurseSource.includes('const FINALIZE_CARE_PLAN_NURSE_SIGNATURE_RPC = "rpc_finalize_care_plan_nurse_signature";'), true);
  assert.equal(nurseSource.includes("cleanupCarePlanNurseSignatureArtifactAfterFinalizeFailure"), true);
  assert.equal(nurseSource.includes("care_plan_nurse_signature_finalize_split_brain"), true);
  assert.equal(nurseSource.includes("was_already_signed"), true);

  assert.equal(enrollmentSource.includes('const ENROLLMENT_PACKET_COMPLETION_RPC = "rpc_finalize_enrollment_packet_submission";'), true);
  assert.equal(enrollmentSource.includes("finalization_status: \"staged\""), true);
  assert.equal(enrollmentSource.includes("cleanupEnrollmentPacketUploadArtifacts"), true);
  assert.equal(enrollmentSource.includes("mapping_sync_status"), true);
  assert.equal(enrollmentSource.includes("wasAlreadyFiled"), true);

  assert.equal(migrationSource.includes("last_consumed_signature_token_hash"), true);
  assert.equal(migrationSource.includes("last_consumed_caregiver_signature_token_hash"), true);
  assert.equal(migrationSource.includes("last_consumed_submission_token_hash"), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_finalize_pof_signature("), true);
  assert.equal(
    migrationSource.includes("create or replace function public.rpc_finalize_care_plan_caregiver_signature("),
    true
  );
  assert.equal(
    migrationSource.includes("create or replace function public.rpc_finalize_care_plan_nurse_signature("),
    true
  );
  assert.equal(
    migrationSource.includes("create or replace function public.rpc_finalize_enrollment_packet_submission("),
    true
  );
});

test("rollback-delete workflow compensation is removed from intake and care plan paths", () => {
  const appActionsSource = readWorkspaceFile("app/actions.ts");
  const carePlanActionsSource = readWorkspaceFile("app/care-plan-actions.ts");
  const carePlanServiceSource = readWorkspaceFile("lib/services/care-plans-supabase.ts");
  const snapshotMigrationSource = readWorkspaceFile("supabase/migrations/0054_care_plan_snapshot_atomicity.sql");

  assert.equal(appActionsSource.includes("deleteIntakeAssessmentSupabase"), false);
  assert.equal(
    appActionsSource.includes("Intake Assessment was created, but nurse/admin e-signature finalization failed"),
    true
  );

  assert.equal(carePlanServiceSource.includes('from("care_plans").delete().eq("id", createdCarePlanId)'), false);
  assert.equal(carePlanServiceSource.includes("buildCarePlanWorkflowError"), true);
  assert.equal(carePlanServiceSource.includes('const CARE_PLAN_SNAPSHOT_RPC = "rpc_record_care_plan_snapshot";'), true);
  assert.equal(carePlanServiceSource.includes("Care Plan was created, but nurse/admin e-signature finalization failed"), true);
  assert.equal(carePlanServiceSource.includes("Care Plan review was saved and signed, but version/review history persistence failed"), true);

  assert.equal(carePlanActionsSource.includes('error: error instanceof Error ? error.message : "Unable to create care plan."'), true);
  assert.equal(carePlanActionsSource.includes("ok: false"), true);

  assert.equal(snapshotMigrationSource.includes("create or replace function public.rpc_record_care_plan_snapshot("), true);
  assert.equal(snapshotMigrationSource.includes("insert into public.care_plan_versions"), true);
  assert.equal(snapshotMigrationSource.includes("insert into public.care_plan_review_history"), true);
});

test("intake draft POF creation is RPC-backed so intake status and physician order creation stay aligned", () => {
  const appActionsSource = readWorkspaceFile("app/actions.ts");
  const pofServiceSource = readWorkspaceFile("lib/services/physician-orders-supabase.ts");
  const migrationSource = readWorkspaceFile("supabase/migrations/0055_intake_draft_pof_atomic_creation.sql");

  assert.equal(
    pofServiceSource.includes('const CREATE_DRAFT_POF_FROM_INTAKE_RPC = "rpc_create_draft_physician_order_from_intake";'),
    true
  );
  assert.equal(pofServiceSource.includes("invokeSupabaseRpcOrThrow"), true);
  assert.equal(pofServiceSource.includes("p_assessment_id: input.assessment.id"), true);
  assert.equal(pofServiceSource.includes("p_payload: payload"), true);
  assert.equal(pofServiceSource.includes("Intake draft physician order RPC is not available. Apply Supabase migration"), true);
  assert.equal(pofServiceSource.includes("CREATE_DRAFT_POF_FROM_INTAKE_MIGRATION"), true);

  assert.equal(
    appActionsSource.includes("await autoCreateDraftPhysicianOrderFromIntake({"),
    true
  );
  assert.equal(
    appActionsSource.includes('await updateIntakeAssessmentDraftPofStatus({\n      assessmentId: created.id,\n      status: "pending"'),
    false
  );
  assert.equal(
    appActionsSource.includes('await updateIntakeAssessmentDraftPofStatus({\n      assessmentId: created.id,\n      status: "created"'),
    false
  );
  assert.equal(
    appActionsSource.includes('await updateIntakeAssessmentDraftPofStatus({\n      assessmentId: created.id,\n      status: "failed"'),
    true
  );

  assert.equal(migrationSource.includes("create or replace function public.rpc_create_draft_physician_order_from_intake("), true);
  assert.equal(migrationSource.includes("draft_pof_status = 'created'"), true);
  assert.equal(migrationSource.includes("where intake_assessment_id = p_assessment_id"), true);
  assert.equal(migrationSource.includes("status in ('draft', 'sent')"), true);
});

test("pof draft creation resolves sex from canonical MCC then MHP gender", () => {
  const pofServiceSource = readWorkspaceFile("lib/services/physician-orders-supabase.ts");

  assert.equal(
    pofServiceSource.includes('async function resolvePhysicianOrderSexPrefill(memberId: string): Promise<"M" | "F" | null>'),
    true
  );
  assert.equal(
    pofServiceSource.includes('supabase.from("member_command_centers").select("gender").eq("member_id", canonicalMemberId).maybeSingle()'),
    true
  );
  assert.equal(
    pofServiceSource.includes('supabase.from("member_health_profiles").select("gender").eq("member_id", canonicalMemberId).maybeSingle()'),
    true
  );
  assert.equal(pofServiceSource.includes("sex: sexPrefill,"), true);
});

test("pof request delivery stays on the canonical RPC contract for both new sends and resends", () => {
  const pofEsignSource = readWorkspaceFile("lib/services/pof-esign.ts");
  const migrationSource = readWorkspaceFile("supabase/migrations/0080_pof_request_delivery_rpc_insert_alignment.sql");

  assert.equal(pofEsignSource.includes("type RpcPreparePofRequestDeliveryRow = {"), true);
  assert.equal(pofEsignSource.includes("function toRpcPreparePofRequestDeliveryRow(data: unknown): RpcPreparePofRequestDeliveryRow"), true);
  assert.equal(pofEsignSource.includes("const provisionalRequestId = randomUUID();"), true);
  assert.equal(pofEsignSource.includes("p_request_id: provisionalRequestId,"), true);
  assert.equal(pofEsignSource.includes("requestId = prepared.request_id;"), true);
  assert.equal(pofEsignSource.includes("if (isMissingRpcFunctionError(error, PREPARE_POF_REQUEST_DELIVERY_RPC)) {"), true);
  assert.equal(pofEsignSource.includes("if (message.includes(PREPARE_POF_REQUEST_DELIVERY_RPC)) {"), false);

  assert.equal(
    migrationSource.includes("create or replace function public.rpc_prepare_pof_request_delivery("),
    true
  );
  assert.equal(migrationSource.includes("if p_request_id is null then"), true);
  assert.equal(migrationSource.includes("insert into public.pof_requests ("), true);
  assert.equal(migrationSource.includes("was_created := true;"), true);
  assert.equal(migrationSource.includes("was_created := false;"), true);
});

test("pof delivery-state rpc ambiguity fix qualifies physician order status references", () => {
  const migrationSource = readWorkspaceFile("supabase/migrations/0082_fix_pof_delivery_state_rpc_ambiguity.sql");

  assert.equal(
    migrationSource.includes("create or replace function public.rpc_transition_pof_request_delivery_state("),
    true
  );
  assert.equal(migrationSource.includes("update public.physician_orders as physician_orders"), true);
  assert.equal(migrationSource.includes("and physician_orders.status <> 'signed';"), true);
});

test("signed pof clinical sync rpc ambiguity fix qualifies member_id references", () => {
  const migrationSource = readWorkspaceFile("supabase/migrations/0083_fix_signed_pof_clinical_sync_rpc_ambiguity.sql");

  assert.equal(
    migrationSource.includes("create or replace function public.rpc_sync_signed_pof_to_member_clinical_profile("),
    true
  );
  assert.equal(
    migrationSource.includes("delete from public.member_diagnoses as member_diagnoses where member_diagnoses.member_id = v_order.member_id;"),
    true
  );
  assert.equal(
    migrationSource.includes("update public.member_command_centers as member_command_centers"),
    true
  );
});

test("signed pof clinical sync rpc uses named conflict targets to avoid output-column ambiguity", () => {
  const migrationSource = readWorkspaceFile("supabase/migrations/0084_fix_signed_pof_clinical_sync_rpc_conflict_targets.sql");

  assert.equal(
    migrationSource.includes("on conflict on constraint member_health_profiles_member_id_key"),
    true
  );
  assert.equal(
    migrationSource.includes("on conflict on constraint member_command_centers_member_id_key"),
    true
  );
});

test("care plan core save, MAR reconciliation, and shared profile sync now use canonical RPC boundaries", () => {
  const carePlanSource = readWorkspaceFile("lib/services/care-plans-supabase.ts");
  const marSource = readWorkspaceFile("lib/services/mar-workflow.ts");
  const profileSyncSource = readWorkspaceFile("lib/services/member-profile-sync.ts");
  const memberCommandCenterSource = readWorkspaceFile("lib/services/member-command-center.ts");
  const migrationSource = readWorkspaceFile("supabase/migrations/0056_shared_rpc_orchestration_hardening.sql");

  assert.equal(carePlanSource.includes('const CARE_PLAN_CORE_RPC = "rpc_upsert_care_plan_core";'), true);
  assert.equal(carePlanSource.includes("Care plan core RPC is not available."), true);
  assert.equal(carePlanSource.includes("await upsertCarePlanCore({"), true);
  assert.equal(carePlanSource.includes('.from("care_plans").insert({'), false);

  assert.equal(marSource.includes('const MAR_MEDICATION_SYNC_RPC = "rpc_sync_mar_medications_from_member_profile";'), true);
  assert.equal(marSource.includes('const MAR_RECONCILE_RPC = "rpc_reconcile_member_mar_state";'), true);
  assert.equal(marSource.includes("MAR reconciliation RPC is not available."), true);
  assert.equal(marSource.includes('.from("mar_schedules").insert(rowsToInsert)'), false);
  assert.equal(marSource.includes('.from("pof_medications").upsert(upsertRows'), false);

  assert.equal(profileSyncSource.includes('const SYNC_MHP_TO_COMMAND_CENTER_RPC = "rpc_sync_member_health_profile_to_command_center";'), true);
  assert.equal(profileSyncSource.includes('const SYNC_COMMAND_CENTER_TO_MHP_RPC = "rpc_sync_command_center_to_member_health_profile";'), true);
  assert.equal(profileSyncSource.includes("Member profile sync RPC is not available."), true);
  assert.equal(profileSyncSource.includes('updateMemberCommandCenterProfileSupabase('), false);
  assert.equal(profileSyncSource.includes('updateMemberHealthProfileByMemberIdSupabase('), false);

  assert.equal(memberCommandCenterSource.includes('const PREFILL_MEMBER_COMMAND_CENTER_RPC = "rpc_prefill_member_command_center_from_assessment";'), true);
  assert.equal(memberCommandCenterSource.includes("Member Command Center prefill RPC is not available."), true);
  assert.equal(memberCommandCenterSource.includes('.from("intake_assessments")'), false);

  assert.equal(migrationSource.includes("create or replace function public.rpc_upsert_care_plan_core("), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_sync_member_health_profile_to_command_center("), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_sync_command_center_to_member_health_profile("), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_prefill_member_command_center_from_assessment("), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_sync_mar_medications_from_member_profile("), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_reconcile_member_mar_state("), true);
});

test("MCC and MHP bundle workflows now use 0057 shared RPC boundaries", () => {
  const mccActionsSource = readWorkspaceFile("app/(portal)/operations/member-command-center/actions.ts");
  const mhpActionsSource = readWorkspaceFile("app/(portal)/health/member-health-profiles/actions.ts");
  const memberCommandCenterSource = readWorkspaceFile("lib/services/member-command-center.ts");
  const memberHealthProfilesSource = readWorkspaceFile("lib/services/member-health-profiles.ts");
  const migrationSource = readWorkspaceFile("supabase/migrations/0057_mcc_mhp_workflow_rpc_hardening.sql");

  assert.equal(
    memberCommandCenterSource.includes('const UPDATE_MEMBER_COMMAND_CENTER_BUNDLE_RPC = "rpc_update_member_command_center_bundle";'),
    true
  );
  assert.equal(
    memberCommandCenterSource.includes(
      'const SAVE_MEMBER_COMMAND_CENTER_ATTENDANCE_BILLING_RPC = "rpc_save_member_command_center_attendance_billing";'
    ),
    true
  );
  assert.equal(
    memberCommandCenterSource.includes(
      'const SAVE_MEMBER_COMMAND_CENTER_TRANSPORTATION_RPC = "rpc_save_member_command_center_transportation";'
    ),
    true
  );
  assert.equal(memberCommandCenterSource.includes("MEMBER_COMMAND_CENTER_WORKFLOW_RPC_MIGRATION"), true);

  assert.equal(
    memberHealthProfilesSource.includes('const UPDATE_MEMBER_HEALTH_PROFILE_BUNDLE_RPC = "rpc_update_member_health_profile_bundle";'),
    true
  );
  assert.equal(
    memberHealthProfilesSource.includes('const UPDATE_MEMBER_TRACK_WITH_NOTE_RPC = "rpc_update_member_track_with_note";'),
    true
  );
  assert.equal(memberHealthProfilesSource.includes("MEMBER_HEALTH_PROFILE_WORKFLOW_RPC_MIGRATION"), true);

  assert.equal(mccActionsSource.includes("saveMemberCommandCenterBundle({"), true);
  assert.equal(mccActionsSource.includes("saveMemberCommandCenterAttendanceBillingWorkflow({"), true);
  assert.equal(mccActionsSource.includes("saveMemberCommandCenterTransportationWorkflow({"), true);
  assert.equal(mccActionsSource.includes("updateMemberCommandCenterProfileSupabase("), false);
  assert.equal(mccActionsSource.includes("updateMemberAttendanceScheduleSupabase("), false);
  assert.equal(mccActionsSource.includes("upsertMemberBillingSettingSupabase("), false);
  assert.equal(mccActionsSource.includes("upsertBillingScheduleTemplateSupabase("), false);
  assert.equal(mccActionsSource.includes("upsertBusStopDirectoryFromValuesSupabase("), false);

  assert.equal(mhpActionsSource.includes("saveMemberHealthProfileBundle({"), true);
  assert.equal(mhpActionsSource.includes("updateMemberTrackWithCarePlanNote({"), true);
  assert.equal(
    mhpActionsSource.includes('await updateMemberFromMhpSupabase({ memberId, patch: {\n    latest_assessment_track: track'),
    false
  );

  assert.equal(migrationSource.includes("create or replace function public.rpc_update_member_command_center_bundle("), true);
  assert.equal(
    migrationSource.includes("create or replace function public.rpc_save_member_command_center_attendance_billing("),
    true
  );
  assert.equal(
    migrationSource.includes("create or replace function public.rpc_save_member_command_center_transportation("),
    true
  );
  assert.equal(migrationSource.includes("create or replace function public.rpc_update_member_health_profile_bundle("), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_update_member_track_with_note("), true);
});

test("MHP child diagnosis, medication, allergy, and provider workflows now use 0058 shared RPC boundaries", () => {
  const mhpActionsSource = readWorkspaceFile("app/(portal)/health/member-health-profiles/actions.ts");
  const memberHealthProfilesSource = readWorkspaceFile("lib/services/member-health-profiles.ts");
  const migrationSource = readWorkspaceFile("supabase/migrations/0058_mhp_child_workflow_rpc_hardening.sql");

  assert.equal(
    memberHealthProfilesSource.includes(
      'const MUTATE_MEMBER_DIAGNOSIS_WORKFLOW_RPC = "rpc_mutate_member_diagnosis_workflow";'
    ),
    true
  );
  assert.equal(
    memberHealthProfilesSource.includes(
      'const MUTATE_MEMBER_MEDICATION_WORKFLOW_RPC = "rpc_mutate_member_medication_workflow";'
    ),
    true
  );
  assert.equal(
    memberHealthProfilesSource.includes(
      'const MUTATE_MEMBER_ALLERGY_WORKFLOW_RPC = "rpc_mutate_member_allergy_workflow";'
    ),
    true
  );
  assert.equal(
    memberHealthProfilesSource.includes(
      'const MUTATE_MEMBER_PROVIDER_WORKFLOW_RPC = "rpc_mutate_member_provider_workflow";'
    ),
    true
  );

  assert.equal(mhpActionsSource.includes("mutateMemberDiagnosisWorkflow({"), true);
  assert.equal(mhpActionsSource.includes("mutateMemberMedicationWorkflow({"), true);
  assert.equal(mhpActionsSource.includes("mutateMemberAllergyWorkflow({"), true);
  assert.equal(mhpActionsSource.includes("mutateMemberProviderWorkflow({"), true);
  assert.equal(mhpActionsSource.includes("createMemberMedicationSupabase("), false);
  assert.equal(mhpActionsSource.includes("updateMemberMedicationSupabase("), false);
  assert.equal(mhpActionsSource.includes("deleteMemberMedicationSupabase("), false);
  assert.equal(mhpActionsSource.includes("createMemberDiagnosisSupabase("), false);
  assert.equal(mhpActionsSource.includes("updateMemberDiagnosisSupabase("), false);
  assert.equal(mhpActionsSource.includes("deleteMemberDiagnosisSupabase("), false);
  assert.equal(mhpActionsSource.includes("createMemberAllergySupabase("), false);
  assert.equal(mhpActionsSource.includes("updateMemberAllergySupabase("), false);
  assert.equal(mhpActionsSource.includes("deleteMemberAllergySupabase("), false);
  assert.equal(mhpActionsSource.includes("createMemberProviderSupabase("), false);
  assert.equal(mhpActionsSource.includes("updateMemberProviderSupabase("), false);
  assert.equal(mhpActionsSource.includes("deleteMemberProviderSupabase("), false);

  assert.equal(migrationSource.includes("create or replace function public.rpc_mutate_member_diagnosis_workflow("), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_mutate_member_medication_workflow("), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_mutate_member_allergy_workflow("), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_mutate_member_provider_workflow("), true);
  assert.equal(migrationSource.includes("from public.rpc_reconcile_member_mar_state("), true);
});

test("MHP bundle RPC covers functional and cognitive tab persistence fields", () => {
  const actionSource = readWorkspaceFile("app/(portal)/health/member-health-profiles/actions-impl.ts");
  const migrationSource = readWorkspaceFile("supabase/migrations/0133_mhp_bundle_rpc_functional_and_cognitive_fields.sql");

  assert.equal(actionSource.includes("toileting_needs: asNullableString(formData, \"toiletingNeeds\")"), true);
  assert.equal(actionSource.includes("may_self_medicate: asNullableBool(formData, \"maySelfMedicate\")"), true);
  assert.equal(actionSource.includes("orientation_dob: asNullableString(formData, \"orientationDob\")"), true);
  assert.equal(actionSource.includes("self_harm_unsafe: asNullableBool(formData, \"selfHarmUnsafe\")"), true);

  assert.equal(migrationSource.includes("create or replace function public.rpc_update_member_health_profile_bundle("), true);
  assert.equal(migrationSource.includes("toileting_needs = case when p_mhp_patch ? 'toileting_needs'"), true);
  assert.equal(migrationSource.includes("vision = case when p_mhp_patch ? 'vision'"), true);
  assert.equal(migrationSource.includes("speech_verbal_status = case when p_mhp_patch ? 'speech_verbal_status'"), true);
  assert.equal(migrationSource.includes("may_self_medicate = case when p_mhp_patch ? 'may_self_medicate'"), true);
  assert.equal(migrationSource.includes("orientation_dob = case when p_mhp_patch ? 'orientation_dob'"), true);
  assert.equal(migrationSource.includes("memory_impairment = case when p_mhp_patch ? 'memory_impairment'"), true);
  assert.equal(migrationSource.includes("self_harm_unsafe = case when p_mhp_patch ? 'self_harm_unsafe'"), true);
  assert.equal(migrationSource.includes("exit_seeking = case when p_mhp_patch ? 'exit_seeking'"), true);
  assert.equal(migrationSource.includes("cognitive_behavior_comments = case when p_mhp_patch ? 'cognitive_behavior_comments'"), true);
});

test("MHP equipment and note workflows now use 0059 shared RPC boundaries", () => {
  const mhpActionsSource = readWorkspaceFile("app/(portal)/health/member-health-profiles/actions.ts");
  const memberHealthProfilesSource = readWorkspaceFile("lib/services/member-health-profiles.ts");
  const migrationSource = readWorkspaceFile("supabase/migrations/0059_mhp_equipment_notes_rpc_hardening.sql");

  assert.equal(
    memberHealthProfilesSource.includes(
      'const MUTATE_MEMBER_EQUIPMENT_WORKFLOW_RPC = "rpc_mutate_member_equipment_workflow";'
    ),
    true
  );
  assert.equal(
    memberHealthProfilesSource.includes('const MUTATE_MEMBER_NOTE_WORKFLOW_RPC = "rpc_mutate_member_note_workflow";'),
    true
  );

  assert.equal(mhpActionsSource.includes("mutateMemberEquipmentWorkflow({"), true);
  assert.equal(mhpActionsSource.includes("mutateMemberNoteWorkflow({"), true);
  assert.equal(mhpActionsSource.includes("createMemberEquipmentSupabase("), false);
  assert.equal(mhpActionsSource.includes("updateMemberEquipmentSupabase("), false);
  assert.equal(mhpActionsSource.includes("deleteMemberEquipmentSupabase("), false);
  assert.equal(mhpActionsSource.includes("createMemberNoteSupabase("), false);
  assert.equal(mhpActionsSource.includes("updateMemberNoteSupabase("), false);
  assert.equal(mhpActionsSource.includes("deleteMemberNoteSupabase("), false);

  assert.equal(migrationSource.includes("create or replace function public.rpc_mutate_member_equipment_workflow("), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_mutate_member_note_workflow("), true);
});
