import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SetAllCookies } from "@supabase/ssr";
import { z } from "zod";

import { getSupabaseEnv } from "@/lib/runtime";
import { evaluateStaffLoginEligibility, markStaffLoginSuccess } from "@/lib/services/staff-auth";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

function normalizeNextPath(raw: string | null | undefined) {
  const value = String(raw ?? "").trim();
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}

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

  const parsed = credentialsSchema.safeParse({
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

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return redirectToLogin(request, "invalid-credentials", requestedNext, response);
  }

  const userId = data.user?.id;
  if (!userId) {
    await supabase.auth.signOut();
    return redirectToLogin(request, "no-auth-user", requestedNext, response);
  }

  const eligibility = await evaluateStaffLoginEligibility(userId);
  if (!eligibility.ok) {
    await supabase.auth.signOut();
    return redirectToLogin(request, eligibility.reason, requestedNext, response);
  }

  await markStaffLoginSuccess(userId);
  return response;
}
