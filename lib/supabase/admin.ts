import { createServiceRoleClient, type ServiceRoleUseCase } from "@/lib/supabase/service-role";

/**
 * Thin compatibility wrapper around the canonical named service-role client.
 * New code should prefer createServiceRoleClient(useCase) directly.
 */
export function createSupabaseAdminClient(useCase: ServiceRoleUseCase) {
  return createServiceRoleClient(useCase);
}
