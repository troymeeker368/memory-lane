import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth";
import { resolveHomeLandingPath } from "@/lib/services/home-landing";

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function logRouteTiming(step: string, startedAtMs: number, details?: Record<string, unknown>) {
  const elapsedMs = (nowMs() - startedAtMs).toFixed(1);
  const detailsText = details
    ? Object.entries(details)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")
    : "";
  const suffix = detailsText ? ` ${detailsText}` : "";
  console.info(`[timing] route:/ ${step} ${elapsedMs}ms${suffix}`);
}

export default async function RootPage() {
  const totalStartedAt = nowMs();

  try {
    const profileStartedAt = nowMs();
    const profile = await getCurrentProfile({ traceLabel: "route:/" });
    logRouteTiming("profile-resolution-complete", profileStartedAt, {
      role: profile.role
    });

    const permissionsStartedAt = nowMs();
    const landing = resolveHomeLandingPath(profile);
    logRouteTiming("permission-checks", permissionsStartedAt, {
      destination: landing.path,
      reason: landing.reason
    });

    logRouteTiming("redirect-ready", totalStartedAt, {
      destination: landing.path
    });
    redirect(landing.path);
  } finally {
    logRouteTiming("total", totalStartedAt);
  }
}
