import { NextRequest, NextResponse } from "next/server";

import {
  retryFailedEnrollmentPacketMappings
} from "@/lib/services/enrollment-packet-mapping-runtime";
import {
  getAcceptedEnrollmentPacketMappingRunnerSecrets,
  getEnrollmentPacketMappingRunnerConfigError,
  getEnrollmentPacketMappingRunnerHealth
} from "@/lib/services/internal-runner-health";
import { toEasternISO } from "@/lib/timezone";

function readBearerToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  return authHeader.startsWith(prefix) ? authHeader.slice(prefix.length).trim() : null;
}

function getAcceptedRunnerSecrets() {
  return getAcceptedEnrollmentPacketMappingRunnerSecrets();
}

function getDefaultConfigError() {
  return getEnrollmentPacketMappingRunnerConfigError();
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
    const health = await getEnrollmentPacketMappingRunnerHealth({ actorUserId: null });
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
    const health = await getEnrollmentPacketMappingRunnerHealth({ nowIso: now, actorUserId: null });
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

  const result = await retryFailedEnrollmentPacketMappings({ limit });
  const health = await getEnrollmentPacketMappingRunnerHealth({
    nowIso: now,
    actorUserId: null,
    summary: {
      agedQueueRows: result.agedQueueRows,
      agedQueueAlertsRaised: result.agedQueueAlertsRaised,
      agedQueueAlertAgeMinutes: result.agedQueueAlertAgeMinutes,
      followUpAgedQueueRows: result.followUpAgedQueueRows,
      followUpAgedQueueAlertsRaised: result.followUpAgedQueueAlertsRaised,
      followUpAgedQueueAlertAgeMinutes: result.followUpAgedQueueAlertAgeMinutes,
      staleClaimRows: result.staleClaimRows,
      staleClaimAlertsRaised: result.staleClaimAlertsRaised,
      staleClaimAgeMinutes: result.staleClaimAgeMinutes
    }
  });

  return NextResponse.json({
    ok: true,
    timestamp: now,
    runnerConfigured: true,
    mode: "run",
    healthStatus: health.healthStatus,
    healthReason: health.healthReason,
    ...result
  });
}

export async function GET(request: NextRequest) {
  return handleRunnerRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRunnerRequest(request);
}
