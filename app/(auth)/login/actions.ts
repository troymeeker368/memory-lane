"use server";

import { redirect } from "next/navigation";

import { signInAction as canonicalSignInAction } from "@/lib/actions/auth";

export async function signInAction(formData: FormData) {
  try {
    const result = await canonicalSignInAction(formData);
    if (result?.error) return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected sign-in failure.";
    return { error: message };
  }

  redirect("/");
}
