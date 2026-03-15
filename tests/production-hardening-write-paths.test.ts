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
  const migrationSource = readWorkspaceFile("supabase/migrations/0051_intake_assessment_atomic_creation_rpc.sql");

  assert.equal(intakeSource.includes('const CREATE_INTAKE_ASSESSMENT_RPC = "rpc_create_intake_assessment_with_responses";'), true);
  assert.equal(intakeSource.includes("Intake assessment atomic creation RPC is not available."), true);
  assert.equal(intakeSource.includes("0051_intake_assessment_atomic_creation_rpc.sql"), true);
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
