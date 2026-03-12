import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SetAllCookies } from "@supabase/ssr";

import { getSupabaseEnv, isAuthEnforced } from "../runtime";

export async function updateSession(request: NextRequest) {
  if (!isAuthEnforced()) {
    // Explicit auth bypass mode: skip auth redirects.
    return NextResponse.next({ request });
  }

  const { url, anonKey } = getSupabaseEnv();

  const response = NextResponse.next({ request });

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

  const {
    data: { user }
  } = await supabase.auth.getUser();
  const isPublicSigningRoute =
    request.nextUrl.pathname.startsWith("/sign/pof/") ||
    request.nextUrl.pathname.startsWith("/sign/care-plan/");

  if (!user && !request.nextUrl.pathname.startsWith("/login") && !isPublicSigningRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
