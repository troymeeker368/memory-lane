import { resolveCurrentUserAuthState } from "@/lib/current-user-auth-state";
import { logServerTiming, timingNowMs } from "@/lib/server-timing";
import {
  resolveHomeLandingPath,
  type HomeLandingResolution
} from "@/lib/services/home-landing";
import type { AppRole } from "@/types/app";

type LandingResolutionOptions = {
  traceLabel?: string;
};

type LandingResolutionResult = HomeLandingResolution & {
  role: AppRole;
};

export async function resolveCurrentHomeLanding(
  options?: LandingResolutionOptions
): Promise<LandingResolutionResult> {
  const traceLabel = options?.traceLabel;
  const totalStartedAt = timingNowMs();
  const resolution = await resolveCurrentUserAuthState({ traceLabel });

  if (resolution.status !== "authenticated") {
    return {
      path: resolution.defaultPath,
      reason: resolution.status,
      role: resolution.role
    };
  }

  const landing = resolveHomeLandingPath(resolution.profile);

  logServerTiming(traceLabel, "landing-resolution-complete", totalStartedAt, {
    role: resolution.profile.role,
    destination: landing.path,
    reason: landing.reason
  });

  return {
    ...landing,
    role: resolution.profile.role
  };
}
