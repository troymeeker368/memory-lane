import { NextRequest, NextResponse } from "next/server";

import { retryQueuedPhysicianOrderPostSignSync } from "@/lib/services/physician-orders-supabase";
import { toEasternISO } from "@/lib/timezone";

function readBearerToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  return authHeader.startsWith(prefix) ? authHeader.slice(prefix.length).trim() : null;
}

export async function POST(request: NextRequest) {
  const expectedSecret = String(process.env.POF_POST_SIGN_SYNC_SECRET ?? "").trim();
  if (!expectedSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "POF post-sign sync runner is not configured. Set POF_POST_SIGN_SYNC_SECRET before scheduling this endpoint."
      },
      { status: 503 }
    );
  }

  const providedSecret = readBearerToken(request);
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let limit = 25;
  try {
    const body = (await request.json().catch(() => null)) as { limit?: number } | null;
    if (body?.limit != null) {
      const parsed = Number(body.limit);
      if (Number.isFinite(parsed)) {
        limit = Math.min(100, Math.max(1, Math.trunc(parsed)));
      }
    }
  } catch {
    limit = 25;
  }

  const result = await retryQueuedPhysicianOrderPostSignSync({
    limit,
    serviceRole: true
  });

  return NextResponse.json({
    ok: true,
    timestamp: toEasternISO(),
    ...result
  });
}
