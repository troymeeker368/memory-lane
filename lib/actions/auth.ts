"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { parseStaffSignInCredentials, performStaffSignIn } from "@/lib/services/staff-sign-in";

export async function signInAction(formData: FormData) {
  const payload = parseStaffSignInCredentials({
    email: String(formData.get("email") || ""),
    password: String(formData.get("password") || "")
  });

  if (!payload.success) {
    return { error: "Please enter a valid email and password." };
  }

  const supabase = await createClient();
  const result = await performStaffSignIn({
    credentials: payload.data,
    signInWithPassword: (credentials) => supabase.auth.signInWithPassword(credentials),
    signOut: () => supabase.auth.signOut()
  });
  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/");
  return { ok: true };
}
