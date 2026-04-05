import { redirect } from "next/navigation";

import { resolveCurrentHomeLanding } from "@/lib/home-landing-auth";
import { logServerTiming, timingNowMs } from "@/lib/server-timing";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const totalStartedAt = timingNowMs();

  try {
    const landingStartedAt = timingNowMs();
    const landing = await resolveCurrentHomeLanding({ traceLabel: "route:/" });
    logServerTiming("route:/", "landing-resolution-complete", landingStartedAt, {
      role: landing.role,
      destination: landing.path,
      reason: landing.reason
    });

    logServerTiming("route:/", "redirect-ready", totalStartedAt, {
      destination: landing.path
    });
    redirect(landing.path);
  } finally {
    logServerTiming("route:/", "total", totalStartedAt);
  }
}
