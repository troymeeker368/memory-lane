"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { signInAction as canonicalSignInAction } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";

export async function signInAction(formData: FormData) {
  return canonicalSignInAction(formData);
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/");
  revalidatePath("/login");
  redirect("/login");
}
