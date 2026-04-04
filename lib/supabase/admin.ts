import { createServiceRoleClient, type ServiceRoleUseCase } from "@/lib/supabase/service-role";

export function createSupabaseAdminClient(useCase: ServiceRoleUseCase = "legacy_unspecified") {
  return createServiceRoleClient(useCase);
}
