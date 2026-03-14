import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SetAllCookies } from "@supabase/ssr";

import { getSupabaseEnv, isDevAuthBypassEnabled } from "../runtime";

function isMissingColumnError(error: unknown, column: string) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = [candidate.message, candidate.details, candidate.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const code = String(candidate.code ?? "");
  return (
    (code === "42703" || code === "PGRST205" || code === "PGRST116") &&
    (text.includes(column.toLowerCase()) || text.includes("schema cache") || text.includes("does not exist"))
  );
}

function isPublicRoute(pathname: string) {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/auth/")) return true;
  if (pathname.startsWith("/sign/pof/")) return true;
  if (pathname.startsWith("/sign/care-plan/")) return true;
  if (pathname.startsWith("/sign/enrollment-packet/")) return true;
  if (pathname.startsWith("/dev/auth")) return isDevAuthBypassEnabled();
  return false;
}

function withAuthCookies(target: NextResponse, source: NextResponse) {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });
  return target;
}

export async function updateSession(request: NextRequest) {
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

  const pathname = request.nextUrl.pathname;
  const publicRoute = isPublicRoute(pathname);

  if (!user && !publicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    if (requestedPath && requestedPath !== "/") {
      url.searchParams.set("next", requestedPath);
    }
    return withAuthCookies(NextResponse.redirect(url), response);
  }

  if (!user) {
    return response;
  }

  if (pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return withAuthCookies(NextResponse.redirect(url), response);
  }

  if (pathname.startsWith("/dev/auth")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return withAuthCookies(NextResponse.redirect(url), response);
  }

  return response;
}
