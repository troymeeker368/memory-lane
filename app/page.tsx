import { redirect } from "next/navigation";

import { resolveCurrentHomeLanding } from "@/lib/home-landing-auth";

export const dynamic = "force-dynamic";

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
    const landingStartedAt = nowMs();
    const landing = await resolveCurrentHomeLanding({ traceLabel: "route:/" });
    logRouteTiming("landing-resolution-complete", landingStartedAt, {
      role: landing.role,
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
