import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SetAllCookies } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseEnv, getSupabaseServiceRoleKey } from "@/lib/runtime";

type CreateClientOptions = {
  /**
   * @deprecated Prefer `createServiceRoleClient()` from `@/lib/supabase/service-role`
   * so privileged access is explicit, narrow, and auditable.
   */
  serviceRole?: boolean;
};

export async function createClient(options: CreateClientOptions = {}) {
  const { url, anonKey } = getSupabaseEnv();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (options.serviceRole) {
    // New code should prefer createServiceRoleClient(useCase) so privilege elevation
    // stays explicit and reviewable at the call site.
    if (!serviceRoleKey) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY. Service-role client cannot be created.");
    }
    return createSupabaseClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        cookiesToSet.forEach(({ name, value, options }: Parameters<SetAllCookies>[0][number]) => {
          try {
            cookieStore.set(name, value, options);
          } catch {
            // Server Component renders can read cookies but cannot mutate them.
            // Middleware and route/action handlers remain the canonical places
            // where Supabase auth cookie refreshes are persisted.
          }
        });
      }
    }
  });
}
