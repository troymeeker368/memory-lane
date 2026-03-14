function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function parseBooleanEnv(value: string | null | undefined) {
  const normalized = clean(value)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return { url, anonKey };
}

export function isProductionNodeEnv() {
  return process.env.NODE_ENV === "production";
}

export function isDevAuthBypassEnabled() {
  if (isProductionNodeEnv()) return false;
  return parseBooleanEnv(process.env.ENABLE_DEV_AUTH_BYPASS);
}

export function getPublicAppUrl() {
  const resolved =
    clean(process.env.NEXT_PUBLIC_APP_URL) ??
    clean(process.env.APP_URL) ??
    clean(process.env.NEXT_PUBLIC_SITE_URL) ??
    clean(process.env.SITE_URL);

  if (!resolved) {
    throw new Error(
      "Public app URL is not configured. Set NEXT_PUBLIC_APP_URL (or APP_URL/SITE_URL) so auth links are canonical."
    );
  }

  return resolved.replace(/\/+$/, "");
}

export function getDevAuthBootstrapPassword() {
  return clean(process.env.DEV_AUTH_BOOTSTRAP_PASSWORD) ?? "SeedDataOnly!123";
}

export function getDevAuthBootstrapUsersJson() {
  return clean(process.env.DEV_AUTH_BOOTSTRAP_USERS_JSON);
}
