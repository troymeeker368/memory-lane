"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { evaluateStaffLoginEligibility, markStaffLoginSuccess } from "@/lib/services/staff-auth";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function signInAction(formData: FormData) {
  const payload = credentialsSchema.safeParse({
    email: String(formData.get("email") || ""),
    password: String(formData.get("password") || "")
  });

  if (!payload.success) {
    return { error: "Please enter a valid email and password." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(payload.data);

  if (error) {
    return { error: error.message };
  }

  const userId = data.user?.id;
  if (!userId) {
    await supabase.auth.signOut();
    return { error: "Sign-in succeeded but auth user id was missing." };
  }

  const eligibility = await evaluateStaffLoginEligibility(userId);
  if (!eligibility.ok) {
    await supabase.auth.signOut();
    if (eligibility.reason === "password-setup-required") {
      return { error: "Your account still requires a set-password step. Please use your set-password email." };
    }
    if (eligibility.reason === "disabled-profile") {
      return { error: "Your login is currently disabled. Contact an administrator." };
    }
    if (eligibility.reason === "inactive-profile") {
      return { error: "Your profile is inactive. Contact an administrator." };
    }
    if (eligibility.reason === "no-linked-profile") {
      return { error: "No linked staff profile was found for this auth user." };
    }
    return { error: "This account is not eligible to sign in." };
  }

  await markStaffLoginSuccess(userId);

  revalidatePath("/");
  return { ok: true };
}
