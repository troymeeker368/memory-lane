import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseEnv, getSupabaseServiceRoleKey } from "@/lib/runtime";

const SERVICE_ROLE_USE_CASES = {
  legacy_unspecified:
    "Temporary fallback for older service-role call sites that still need migration to an explicit use case.",
  auth_custom_permissions_read:
    "Auth resolution must read self permission overrides even when RLS limits user_permissions reads to admins.",
  dashboard_mar_read:
    "Dashboard MAR reads sometimes run outside a user session and need an explicit privileged fallback.",
  member_file_record_rpc:
    "Member file RPC mutations are service-only so database and storage state stay aligned.",
  member_file_storage:
    "Member file storage signing and object mutations must stay server-only and bypass user-scoped RLS.",
  member_health_profile_backfill:
    "Member Health Profile shell backfill is a canonical service write path restricted to service_role.",
  member_health_profile_write_guard_read:
    "Member Health Profile write guards sometimes need the canonical shell row during service-backed workflows.",
  notification_user_inbox_read:
    "Some internal notification review flows need a cross-user inbox read outside recipient-scoped RLS.",
  notification_dispatch_write:
    "Notification inserts are restricted to service_role by policy and must stay on the canonical service path.",
  notification_workflow_context_read:
    "Notification fan-out resolves cross-user workflow context and recipients beyond the acting user's RLS scope."
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
