import { NextRequest, NextResponse } from "next/server";

import { listMemberSearchLookupSupabase } from "@/lib/services/shared-lookups-supabase";
import { createClient } from "@/lib/supabase/server";

function parseLimit(value: string | null, fallback = 25) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(50, Math.floor(parsed));
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";
  const statusParam = request.nextUrl.searchParams.get("status");
  const status = statusParam === "all" || statusParam === "inactive" ? statusParam : "active";
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const minQueryLength = parseLimit(request.nextUrl.searchParams.get("minQueryLength"), 2);

  const rows = await listMemberSearchLookupSupabase({
    q,
    status,
    limit,
    minQueryLength
  });

  return NextResponse.json({
    rows
  });
}
