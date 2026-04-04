import { NextRequest, NextResponse } from "next/server";

import {
  getAcceptedPofPostSignSyncRunnerSecrets,
  getPofPostSignSyncRunnerConfigError,
  getPofPostSignSyncRunnerHealth
} from "@/lib/services/internal-runner-health";
import { retryQueuedPhysicianOrderPostSignSync } from "@/lib/services/physician-orders-supabase";
import { toEasternISO } from "@/lib/timezone";

function readBearerToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  return authHeader.startsWith(prefix) ? authHeader.slice(prefix.length).trim() : null;
}

function getAcceptedRunnerSecrets() {
  return getAcceptedPofPostSignSyncRunnerSecrets();
}

function getDefaultConfigError() {
  return getPofPostSignSyncRunnerConfigError();
}

function parseLimitValue(value: string | number | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(100, Math.max(1, Math.trunc(parsed)));
}

function isHealthMode(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") ?? "";
  return mode.trim().toLowerCase() === "health";
}

function resolveRunnerHealth(input: {
  runnerConfigured: boolean;
  agedQueueRows?: number;
  queuedRows?: number;
}) {
  if (!input.runnerConfigured) {
    return {
      healthStatus: "missing_config" as const,
      healthReason: "runner_not_configured" as const
    };
  }
  if ((input.agedQueueRows ?? 0) > 0) {
    return {
      healthStatus: "degraded" as const,
      healthReason: "aged_queue" as const
    };
  }
  if ((input.queuedRows ?? 0) > 0) {
    return {
      healthStatus: "degraded" as const,
      healthReason: "retry_queued" as const
    };
  }
  return {
    healthStatus: "healthy" as const,
    healthReason: null
  };
}

async function handleRunnerRequest(request: NextRequest) {
  const acceptedSecrets = getAcceptedRunnerSecrets();
  if (acceptedSecrets.length === 0) {
    const health = await getPofPostSignSyncRunnerHealth({ actorUserId: null });
    return NextResponse.json(
      {
        ok: false,
        error: getDefaultConfigError(),
        ...health
      },
      { status: 503 }
    );
  }

  const providedSecret = readBearerToken(request);
  if (!providedSecret || !acceptedSecrets.includes(providedSecret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const now = toEasternISO();
  if (isHealthMode(request)) {
    const health = await getPofPostSignSyncRunnerHealth({ nowIso: now, actorUserId: null });
    return NextResponse.json({
      ok: true,
      mode: "health",
      ...health
    });
  }

  let limit = parseLimitValue(request.nextUrl.searchParams.get("limit"));
  if (request.method === "POST") {
    try {
      const body = (await request.json().catch(() => null)) as { limit?: number } | null;
      if (body?.limit != null) {
        limit = parseLimitValue(body.limit);
      }
    } catch {
      limit = parseLimitValue(request.nextUrl.searchParams.get("limit"));
    }
  }

  const result = await retryQueuedPhysicianOrderPostSignSync({
    limit,
    serviceRole: true
  });
  const health = await getPofPostSignSyncRunnerHealth({
    nowIso: now,
    actorUserId: null,
    summary: {
      agedQueueRows: result.agedQueueRows,
      agedQueueAlertsRaised: result.agedQueueAlertsRaised,
      agedQueueAlertAgeMinutes: result.agedQueueAlertAgeMinutes
    }
  });
  const responseHealth =
    health.agedQueueRows > 0
      ? {
          healthStatus: health.healthStatus,
          healthReason: health.healthReason
        }
      : resolveRunnerHealth({
          runnerConfigured: true,
          agedQueueRows: result.agedQueueRows,
          queuedRows: result.queued
        });

  return NextResponse.json({
    ok: true,
    timestamp: now,
    runnerConfigured: true,
    mode: "run",
    ...responseHealth,
    ...result
  });
}

export async function GET(request: NextRequest) {
  return handleRunnerRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRunnerRequest(request);
}
