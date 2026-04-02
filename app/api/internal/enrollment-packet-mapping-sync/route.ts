import { NextRequest, NextResponse } from "next/server";

import {
  emitEnrollmentPacketMappingRetryHealthAlerts,
  retryFailedEnrollmentPacketMappings
} from "@/lib/services/enrollment-packet-mapping-runtime";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";

function readBearerToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  return authHeader.startsWith(prefix) ? authHeader.slice(prefix.length).trim() : null;
}

function getAcceptedRunnerSecrets() {
  return [
    ...new Set(
      [process.env.ENROLLMENT_PACKET_MAPPING_SYNC_SECRET, process.env.CRON_SECRET]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  ];
}

function getDefaultConfigError() {
  return "Enrollment packet mapping retry runner is not configured. Set ENROLLMENT_PACKET_MAPPING_SYNC_SECRET for manual callers or CRON_SECRET for Vercel cron before scheduling this endpoint.";
}

function parseLimitValue(value: string | number | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
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
        entityType: "enrollment_packet_request",
        entityId: null,
        actorUserId: null,
        severity: "high",
        alertKey: "enrollment_packet_mapping_sync_runner_not_configured",
        metadata: {
          route: "/api/internal/enrollment-packet-mapping-sync",
          message: getDefaultConfigError()
        }
      });
    } catch (alertError) {
      console.error("[enrollment-packet-mapping-sync-route] unable to persist missing-config alert", alertError);
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
    const healthSummary = await emitEnrollmentPacketMappingRetryHealthAlerts({
      nowIso: now,
      actorUserId: null
    });
    const healthStatus =
      healthSummary.agedQueueRows > 0 || healthSummary.staleClaimRows > 0 ? "degraded" : "healthy";
    return NextResponse.json({
      ok: true,
      timestamp: now,
      runnerConfigured: true,
      mode: "health",
      healthStatus,
      agedQueueRows: healthSummary.agedQueueRows,
      agedQueueAlertsRaised: healthSummary.agedQueueAlertsRaised,
      agedQueueAlertAgeMinutes: healthSummary.alertAgeMinutes,
      staleClaimRows: healthSummary.staleClaimRows,
      staleClaimAlertsRaised: healthSummary.staleClaimAlertsRaised,
      staleClaimAgeMinutes: healthSummary.staleClaimAgeMinutes
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

  const result = await retryFailedEnrollmentPacketMappings({ limit });

  return NextResponse.json({
    ok: true,
    timestamp: now,
    runnerConfigured: true,
    mode: "run",
    healthStatus: result.agedQueueRows > 0 || result.staleClaimRows > 0 ? "degraded" : "healthy",
    ...result
  });
}

export async function GET(request: NextRequest) {
  return handleRunnerRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRunnerRequest(request);
}
