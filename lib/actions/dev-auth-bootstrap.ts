"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { resolveDevAuthBootstrapPasswordForEmail } from "@/lib/services/dev-auth-bootstrap";
import { evaluateStaffLoginEligibility, markStaffLoginSuccess } from "@/lib/services/staff-login-state";
import { isDevAuthBypassEnabled } from "@/lib/runtime";

type AuthActionState = {
  ok?: boolean;
  message?: string;
  error?: string;
};

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function devBootstrapSignInAction(formData: FormData): Promise<AuthActionState> {
  if (!isDevAuthBypassEnabled()) {
    return { error: "Dev auth bootstrap is disabled." };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!isEmail(email)) {
    return { error: "Invalid bootstrap account email." };
  }

  const password = resolveDevAuthBootstrapPasswordForEmail(email);
  const supabase = await createClient();
  await supabase.auth.signOut();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return { error: `Unable to sign in with bootstrap account: ${error.message}` };
  }

  const userId = data.user?.id;
  if (!userId) {
    await supabase.auth.signOut();
    return { error: "Bootstrap account signed in without an auth user id." };
  }

  const eligibility = await evaluateStaffLoginEligibility(userId);
  if (!eligibility.ok) {
    await supabase.auth.signOut();
    return {
      error:
        eligibility.reason === "password-setup-required"
          ? "This account still requires set-password completion."
          : "This account is not eligible to sign in."
    };
  }

  await markStaffLoginSuccess(userId);
  revalidatePath("/");
  revalidatePath("/login");
  return { ok: true };
}
