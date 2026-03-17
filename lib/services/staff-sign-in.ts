import { z } from "zod";

import { evaluateStaffLoginEligibility, markStaffLoginSuccess } from "@/lib/services/staff-login-state";

export const staffSignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export type StaffSignInCredentials = z.infer<typeof staffSignInSchema>;

export type StaffSignInFailureReason =
  | "invalid-credentials"
  | "no-auth-user"
  | "password-setup-required"
  | "disabled-profile"
  | "inactive-profile"
  | "no-linked-profile"
  | "not-eligible";

const STAFF_SIGN_IN_FAILURE_REASONS: StaffSignInFailureReason[] = [
  "invalid-credentials",
  "no-auth-user",
  "password-setup-required",
  "disabled-profile",
  "inactive-profile",
  "no-linked-profile",
  "not-eligible"
];

export type StaffSignInResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      reason: StaffSignInFailureReason;
      message: string;
    };

export function parseStaffSignInCredentials(raw: { email: string; password: string }) {
  return staffSignInSchema.safeParse(raw);
}

export function getStaffSignInErrorMessage(reason: StaffSignInFailureReason) {
  if (reason === "password-setup-required") {
    return "Your account still requires a set-password step. Please use your set-password email.";
  }
  if (reason === "disabled-profile") {
    return "Your login is currently disabled. Contact an administrator.";
  }
  if (reason === "inactive-profile") {
    return "Your profile is inactive. Contact an administrator.";
  }
  if (reason === "no-linked-profile") {
    return "No linked staff profile was found for this auth user.";
  }
  if (reason === "no-auth-user") {
    return "Sign-in succeeded but auth user id was missing.";
  }
  if (reason === "invalid-credentials") {
    return "Please enter a valid email and password.";
  }
  return "This account is not eligible to sign in.";
}

function normalizeStaffSignInFailureReason(reason: string): StaffSignInFailureReason {
  return STAFF_SIGN_IN_FAILURE_REASONS.includes(reason as StaffSignInFailureReason)
    ? (reason as StaffSignInFailureReason)
    : "not-eligible";
}

export function normalizeNextPath(raw: string | null | undefined) {
  const value = String(raw ?? "").trim();
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}

export async function performStaffSignIn(input: {
  credentials: StaffSignInCredentials;
  signInWithPassword: (credentials: StaffSignInCredentials) => Promise<{
    data: { user?: { id?: string | null } | null };
    error: { message?: string | null } | null;
  }>;
  signOut: () => Promise<unknown>;
}) : Promise<StaffSignInResult> {
  const { data, error } = await input.signInWithPassword(input.credentials);

  if (error) {
    return {
      ok: false,
      reason: "invalid-credentials",
      message: String(error.message ?? getStaffSignInErrorMessage("invalid-credentials"))
    };
  }

  const userId = data.user?.id;
  if (!userId) {
    await input.signOut();
    return {
      ok: false,
      reason: "no-auth-user",
      message: getStaffSignInErrorMessage("no-auth-user")
    };
  }

  const eligibility = await evaluateStaffLoginEligibility(userId);
  if (!eligibility.ok) {
    await input.signOut();
    const failureReason = normalizeStaffSignInFailureReason(eligibility.reason);
    return {
      ok: false,
      reason: failureReason,
      message: getStaffSignInErrorMessage(failureReason)
    };
  }

  await markStaffLoginSuccess(userId);
  return {
    ok: true,
    userId
  };
}
