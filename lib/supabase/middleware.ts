import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SetAllCookies } from "@supabase/ssr";

import { getSupabaseEnv, isDevAuthBypassEnabled } from "../runtime";

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

function getRequestedPathname(request: NextRequest) {
  const search = request.nextUrl.search ?? "";
  return `${request.nextUrl.pathname}${search}`;
}

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token"));
}

function buildLoginRedirect(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  const requestedPath = getRequestedPathname(request);
  if (requestedPath && requestedPath !== "/") {
    url.searchParams.set("next", requestedPath);
  }
  return NextResponse.redirect(url);
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const publicRoute = isPublicRoute(pathname);
  const isLoginRoute = pathname === "/login";
  const isDevAuthRoute = pathname.startsWith("/dev/auth");
  const isApiRoute = pathname.startsWith("/api/");
  const shouldResolveSession = isApiRoute || isLoginRoute || isDevAuthRoute;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-memory-lane-pathname", pathname);
  requestHeaders.set("x-memory-lane-requested-path", getRequestedPathname(request));

  if (!publicRoute && !hasSupabaseAuthCookie(request) && !isApiRoute) {
    return buildLoginRedirect(request);
  }

  if (!shouldResolveSession) {
    return NextResponse.next({
      request: {
        headers: requestHeaders
      }
    });
  }

  const { url, anonKey } = getSupabaseEnv();

  const response = NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });

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

  if (!user && !publicRoute) {
    return withAuthCookies(buildLoginRedirect(request), response);
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
