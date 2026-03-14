function isExplicitlyTrue(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function isExplicitlyFalse(value: string | undefined) {
  return value?.trim().toLowerCase() === "false";
}

// Compatibility export:
// older middleware bundles may still reference these during hot reload.
export function isAuthBypassEnabled() {
  const bypassEnv = process.env.NEXT_PUBLIC_ENABLE_AUTH_BYPASS;
  if (typeof bypassEnv === "string") {
    return isExplicitlyTrue(bypassEnv);
  }

  const legacyAuthEnv = process.env.NEXT_PUBLIC_ENABLE_AUTH;
  if (isExplicitlyFalse(legacyAuthEnv)) {
    return true;
  }

  return false;
}

// Compatibility export for older import paths.
export function isAuthEnforced() {
  return !isAuthBypassEnabled();
}

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return { url, anonKey };
}
