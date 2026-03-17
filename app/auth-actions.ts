"use server";

import { signInAction as canonicalSignInAction } from "@/lib/actions/auth";

export async function signInAction(formData: FormData) {
  return canonicalSignInAction(formData);
}
