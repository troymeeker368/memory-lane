import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

function normalizeNextPath(raw: string | null, fallback: string) {
  const value = (raw ?? "").trim();
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  return value;
}

function normalizeOtpType(raw: string | null): EmailOtpType | null {
  if (raw === "signup" || raw === "invite" || raw === "magiclink" || raw === "recovery" || raw === "email_change" || raw === "email") {
    return raw;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const searchParams = requestUrl.searchParams;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const token = searchParams.get("token");
  const email = searchParams.get("email");
  const type = normalizeOtpType(searchParams.get("type"));
  const nextPath = normalizeNextPath(searchParams.get("next"), "/");

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const loginUrl = new URL("/login", requestUrl.origin);
      loginUrl.searchParams.set("reason", "auth-link-failed");
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash
    });
    if (error) {
      const loginUrl = new URL("/login", requestUrl.origin);
      loginUrl.searchParams.set("reason", "auth-link-failed");
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
  }

  if (token && type && email) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token,
      email
    });
    if (error) {
      const loginUrl = new URL("/login", requestUrl.origin);
      loginUrl.searchParams.set("reason", "auth-link-failed");
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
  }

  // Some Supabase verify links complete the auth step upstream and land here
  // with only the redirect path; if a session now exists, continue.
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (user) {
    return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
  }

  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("reason", "invalid-auth-link");
  return NextResponse.redirect(loginUrl);
}
