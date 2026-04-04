import { resolveCurrentUserAccess } from "@/lib/current-user-access";
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

function timingNow() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function logTiming(traceLabel: string | undefined, step: string, startedAtMs: number, details?: Record<string, unknown>) {
  if (!traceLabel) return;
  const elapsedMs = (timingNow() - startedAtMs).toFixed(1);
  const detailsText = details
    ? Object.entries(details)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")
    : "";
  const suffix = detailsText ? ` ${detailsText}` : "";
  console.info(`[timing] ${traceLabel} ${step} ${elapsedMs}ms${suffix}`);
}

export async function resolveCurrentHomeLanding(
  options?: LandingResolutionOptions
): Promise<LandingResolutionResult> {
  const traceLabel = options?.traceLabel;
  const totalStartedAt = timingNow();
  const resolution = await resolveCurrentUserAccess({ traceLabel });

  if (resolution.status !== "authenticated") {
    const path =
      resolution.status === "invited-password-setup"
        ? "/auth/set-password"
        : `/login?reason=${resolution.status}`;

    return {
      path,
      reason: resolution.status,
      role: resolution.role
    };
  }

  const landing = resolveHomeLandingPath(resolution.profile);

  logTiming(traceLabel, "landing-resolution-complete", totalStartedAt, {
    role: resolution.profile.role,
    destination: landing.path,
    reason: landing.reason
  });

  return {
    ...landing,
    role: resolution.profile.role
  };
}
