import { headers } from "next/headers";

import type { CurrentUserAccessOptions, CurrentUserAccessResult } from "@/lib/current-user-access";
import { resolveCurrentUserAccess } from "@/lib/current-user-access";
import type { AppRole, UserProfile } from "@/types/app";

type RedirectStatus = Exclude<CurrentUserAccessResult["status"], "authenticated">;

type CurrentUserAuthStateOptions = CurrentUserAccessOptions & {
  includeRequestedPathForLogin?: boolean;
  requestedPath?: string | null;
};

export type CurrentUserAuthState =
  | {
      status: "authenticated";
      role: AppRole;
      profile: UserProfile;
    }
  | {
      status: RedirectStatus;
      role: AppRole;
      defaultPath: string;
    };

async function getRequestedPathForLoginRedirect() {
  const headerStore = await headers();
  const requestedPath = String(headerStore.get("x-memory-lane-requested-path") ?? "").trim();
  if (!requestedPath || requestedPath === "/" || !requestedPath.startsWith("/") || requestedPath.startsWith("//")) {
    return null;
  }
  return requestedPath;
}

async function getDefaultPathForStatus(status: RedirectStatus, requestedPath?: string | null) {
  if (status === "invited-password-setup") {
    return "/auth/set-password";
  }

  if (status !== "no-auth-user") {
    return `/login?reason=${status}`;
  }

  const nextPath = requestedPath === undefined ? await getRequestedPathForLoginRedirect() : requestedPath;
  const params = new URLSearchParams({ reason: status });
  if (nextPath) {
    params.set("next", nextPath);
  }
  return `/login?${params.toString()}`;
}

export async function resolveCurrentUserAuthState(
  options?: CurrentUserAuthStateOptions
): Promise<CurrentUserAuthState> {
  const resolution = await resolveCurrentUserAccess(options);

  if (resolution.status === "authenticated") {
    return {
      status: "authenticated",
      role: resolution.profile.role,
      profile: resolution.profile
    };
  }

  return {
    status: resolution.status,
    role: resolution.role,
    defaultPath: await getDefaultPathForStatus(
      resolution.status,
      options?.includeRequestedPathForLogin ? options.requestedPath : null
    )
  };
}
