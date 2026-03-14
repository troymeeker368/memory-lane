import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SetAllCookies } from "@supabase/ssr";

import { getSupabaseEnv } from "@/lib/runtime";
import { normalizeNextPath, parseStaffSignInCredentials, performStaffSignIn } from "@/lib/services/staff-sign-in";

function redirectToLogin(request: NextRequest, reason: string, next?: string | null, response?: NextResponse) {
  const url = new URL("/login", request.url);
  url.searchParams.set("reason", reason);
  const normalizedNext = normalizeNextPath(next);
  if (normalizedNext !== "/") {
    url.searchParams.set("next", normalizedNext);
  }
  const target = NextResponse.redirect(url);
  if (response) {
    response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  }
  return target;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const requestedNext = normalizeNextPath(String(formData.get("next") ?? "/"));

  const parsed = parseStaffSignInCredentials({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? "")
  });
  if (!parsed.success) {
    return redirectToLogin(request, "invalid-credentials", requestedNext);
  }

  const { url, anonKey } = getSupabaseEnv();
  const response = NextResponse.redirect(new URL(requestedNext, request.url));

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        cookiesToSet.forEach(({ name, value, options }: Parameters<SetAllCookies>[0][number]) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      }
    }
  });

  const result = await performStaffSignIn({
    credentials: parsed.data,
    signInWithPassword: (credentials) => supabase.auth.signInWithPassword(credentials),
    signOut: () => supabase.auth.signOut()
  });
  if (!result.ok) {
    return redirectToLogin(request, result.reason, requestedNext, response);
  }
  return response;
}
