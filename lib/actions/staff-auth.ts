"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import {
  completeStaffPasswordUpdateFromSession,
  evaluateStaffLoginEligibility,
  markStaffLoginSuccess,
  requestStaffPasswordResetByEmail,
  resolveDevAuthBootstrapPasswordForEmail
} from "@/lib/services/staff-auth";
import { isDevAuthBypassEnabled } from "@/lib/runtime";

type AuthActionState = {
  ok?: boolean;
  message?: string;
  error?: string;
};

const emailSchema = z.string().email();
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be 128 characters or less.");

function parseMatchingPasswordForm(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const parsedPassword = passwordSchema.safeParse(password);
  if (!parsedPassword.success) {
    return { ok: false as const, error: parsedPassword.error.issues[0]?.message ?? "Invalid password." };
  }
  if (password !== confirmPassword) {
    return { ok: false as const, error: "Password confirmation does not match." };
  }
  return { ok: true as const, password: parsedPassword.data };
}

export async function requestForgotPasswordAction(formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return { error: "Enter a valid email address." };
  }

  // Do not leak account existence.
  await requestStaffPasswordResetByEmail(parsed.data);

  return {
    ok: true,
    message: "If an account exists for that email, a password reset link has been sent."
  };
}

export async function completeSetPasswordAction(formData: FormData): Promise<AuthActionState> {
  const parsed = parseMatchingPasswordForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  await completeStaffPasswordUpdateFromSession({
    mode: "set-password",
    password: parsed.password
  });
  revalidatePath("/");
  return { ok: true };
}

export async function completeResetPasswordAction(formData: FormData): Promise<AuthActionState> {
  const parsed = parseMatchingPasswordForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  await completeStaffPasswordUpdateFromSession({
    mode: "reset-password",
    password: parsed.password
  });
  revalidatePath("/");
  return { ok: true };
}

export async function devBootstrapSignInAction(formData: FormData): Promise<AuthActionState> {
  if (!isDevAuthBypassEnabled()) {
    return { error: "Dev auth bootstrap is disabled." };
  }

  const emailRaw = String(formData.get("email") ?? "").trim().toLowerCase();
  const email = emailSchema.safeParse(emailRaw);
  if (!email.success) {
    return { error: "Invalid bootstrap account email." };
  }

  const password = resolveDevAuthBootstrapPasswordForEmail(email.data);
  const supabase = await createClient();
  await supabase.auth.signOut();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.data,
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
