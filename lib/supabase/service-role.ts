import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseEnv, getSupabaseServiceRoleKey } from "@/lib/runtime";

const SERVICE_ROLE_USE_CASES = {
  billing_payor_contact_workflow:
    "Billing payor contact writes and repair-safe reads run through this privileged billing workflow.",
  billing_quickbooks_repair:
    "Billing QuickBooks repair scripts need explicit service-role access to reconcile canonical billing customers.",
  billing_rpc_workflow:
    "Billing batch, export, and invoice RPC workflows execute as service-only atomic operations.",
  canonical_identity_resolution_read:
    "Canonical lead/member identity resolution sometimes needs explicit server-only reads across members and leads.",
  care_plan_signature_workflow:
    "Care plan caregiver and nurse e-sign workflows need explicit privileged reads, RPC finalization, and artifact persistence.",
  dashboard_admin_read:
    "Dashboard operational counters and alert reads sometimes span records outside the signed-in user's direct RLS scope.",
  dashboard_mar_read:
    "Dashboard MAR reads sometimes run outside a user session and need an explicit privileged fallback.",
  dev_auth_bootstrap_read:
    "Local dev auth bootstrap may enumerate active staff accounts when bypass mode is explicitly enabled.",
  enrollment_packet_artifact_download:
    "Completed enrollment packet artifact downloads use an explicit privileged storage read after token validation succeeds.",
  enrollment_packet_workflow:
    "Enrollment packet public token flows, delivery tracking, mapping, and completion follow-up use a labeled privileged workflow.",
  enrollment_pricing_workflow:
    "Enrollment pricing reads and writes run on a labeled privileged workflow because pricing tables are admin-scoped.",
  historical_drift_repair:
    "Historical drift repair scripts need explicit privileged access to reconcile canonical Supabase state.",
  incident_artifact_workflow:
    "Incident artifact generation and member-file persistence run through an explicit privileged incident workflow.",
  incident_workflow:
    "Incident creation, review, amendment, and reporting reads/writes require a labeled privileged workflow.",
  intake_follow_up_workflow:
    "Intake post-sign follow-up workflows use privileged access to reconcile downstream canonical records safely.",
  live_e2e_enrollment_packet:
    "Live enrollment packet end-to-end verification scripts need explicit privileged reads and writes.",
  live_e2e_pof_signing:
    "Live POF signing end-to-end verification scripts need explicit privileged reads and writes.",
  member_file_record_rpc:
    "Member file RPC mutations are service-only so database and storage state stay aligned.",
  member_file_storage:
    "Member file storage signing and object mutations must stay server-only and bypass user-scoped RLS.",
  member_file_backfill:
    "Member file backfill scripts use explicit privileged access to reconcile storage metadata against canonical records.",
  member_command_center_service_write:
    "Canonical Member Command Center repair and shell provisioning run on explicit privileged service workflows.",
  member_health_profile_backfill:
    "Member Health Profile shell backfill is a canonical service write path restricted to service_role.",
  member_health_profile_domain_write:
    "Member Health Profile diagnoses, medications, and allergies use an explicit privileged write path.",
  member_health_profile_write_guard_read:
    "Member Health Profile write guards sometimes need the canonical shell row during service-backed workflows.",
  notification_user_inbox_read:
    "Some internal notification review flows need a cross-user inbox read outside recipient-scoped RLS.",
  notification_dispatch_write:
    "Notification inserts are restricted to service_role by policy and must stay on the canonical service path.",
  notification_workflow_context_read:
    "Notification fan-out resolves cross-user workflow context and recipients beyond the acting user's RLS scope.",
  operations_settings_repair:
    "Operations settings singleton repair needs explicit privileged upsert access for canonical center configuration.",
  operational_reliability_read:
    "Operational reliability dashboards read cross-workflow failure state beyond a single user's RLS boundary.",
  pof_signature_workflow:
    "Physician order request delivery, public signing, post-sign sync, and signed artifact workflows use a labeled privileged path.",
  seed_runtime_bootstrap:
    "Seed/bootstrap scripts use explicit privileged access to establish canonical runtime data.",
  staff_auth_admin:
    "Staff auth invitation, reset, and lifecycle updates require explicit admin access to auth-managed profile state.",
  staff_login_state_read:
    "Staff login eligibility checks need explicit cross-user profile reads during authentication.",
  system_event_write:
    "System event persistence is restricted to a labeled service-only write path.",
  transportation_run_posting:
    "Transportation run posting uses a privileged RPC workflow so posting facts and billing stay atomic.",
  user_management_admin:
    "User management needs explicit privileged access for profile metadata, auth user sync, and permission maintenance.",
  workflow_observability_read:
    "Workflow observability reads system-wide failure and alert state outside end-user RLS boundaries."
} as const;

export type ServiceRoleUseCase = keyof typeof SERVICE_ROLE_USE_CASES;

export function getServiceRoleUseCaseReason(useCase: ServiceRoleUseCase) {
  return SERVICE_ROLE_USE_CASES[useCase];
}

export function createServiceRoleClient(useCase: ServiceRoleUseCase): SupabaseClient {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!serviceRoleKey) {
    throw new Error(
      `Missing SUPABASE_SERVICE_ROLE_KEY. Service-role client cannot be created for ${useCase}: ${getServiceRoleUseCaseReason(useCase)}`
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers: {
        "x-memory-lane-service-role-use-case": useCase
      }
    }
  });
}
