import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SetAllCookies } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseEnv, isAuthBypassEnabled } from "@/lib/runtime";

type CreateClientOptions = {
  serviceRole?: boolean;
};

export async function createClient(options: CreateClientOptions = {}) {
  const { url, anonKey } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  const shouldUseServiceRole = Boolean(serviceRoleKey) && (options.serviceRole || isAuthBypassEnabled());
  const key = shouldUseServiceRole ? serviceRoleKey! : anonKey;

  if (shouldUseServiceRole) {
    try {
      const cookieStore = await cookies();
      return createServerClient(url, key, {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
            cookiesToSet.forEach(({ name, value, options }: Parameters<SetAllCookies>[0][number]) => {
              cookieStore.set(name, value, options);
            });
          }
        }
      });
    } catch {
      return createSupabaseClient(url, key, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
    }
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        cookiesToSet.forEach(({ name, value, options }: Parameters<SetAllCookies>[0][number]) => {
          cookieStore.set(name, value, options);
        });
      }
    }
  });
}
