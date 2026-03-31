import { NextRequest, NextResponse } from "next/server";

import { retryQueuedPhysicianOrderPostSignSync } from "@/lib/services/physician-orders-supabase";
import { emitAgedPostSignSyncQueueAlerts } from "@/lib/services/physician-order-post-sign-runtime";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";

function readBearerToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  return authHeader.startsWith(prefix) ? authHeader.slice(prefix.length).trim() : null;
}

function getAcceptedRunnerSecrets() {
  return [...new Set([process.env.POF_POST_SIGN_SYNC_SECRET, process.env.CRON_SECRET].map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function getDefaultConfigError() {
  return "POF post-sign sync runner is not configured. Set POF_POST_SIGN_SYNC_SECRET for manual callers or CRON_SECRET for Vercel cron before scheduling this endpoint.";
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

async function handleRunnerRequest(request: NextRequest) {
  const acceptedSecrets = getAcceptedRunnerSecrets();
  if (acceptedSecrets.length === 0) {
    try {
      await recordImmediateSystemAlert({
        entityType: "physician_order",
        entityId: null,
        actorUserId: null,
        severity: "high",
        alertKey: "pof_post_sign_sync_runner_not_configured",
        metadata: {
          route: "/api/internal/pof-post-sign-sync",
          message: getDefaultConfigError()
        }
      });
    } catch (alertError) {
      console.error("[pof-post-sign-sync-route] unable to persist missing-config alert", alertError);
    }
    return NextResponse.json(
      {
        ok: false,
        error: getDefaultConfigError(),
        runnerConfigured: false
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
    const agedQueueSummary = await emitAgedPostSignSyncQueueAlerts({
      nowIso: now,
      serviceRole: true,
      actorUserId: null
    });
    const healthStatus = agedQueueSummary.agedQueueRows > 0 ? "degraded" : "healthy";
    return NextResponse.json({
      ok: true,
      timestamp: now,
      runnerConfigured: true,
      mode: "health",
      healthStatus,
      agedQueueRows: agedQueueSummary.agedQueueRows,
      agedQueueAlertsRaised: agedQueueSummary.alertsRaised,
      agedQueueAlertAgeMinutes: agedQueueSummary.alertAgeMinutes
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

  return NextResponse.json({
    ok: true,
    timestamp: now,
    runnerConfigured: true,
    mode: "run",
    healthStatus: result.agedQueueRows > 0 ? "degraded" : "healthy",
    ...result
  });
}

export async function GET(request: NextRequest) {
  return handleRunnerRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRunnerRequest(request);
}
