import { NextResponse } from "next/server";
import { toEasternISO } from "@/lib/timezone";

export async function GET() {
  return NextResponse.json({ ok: true, service: "operations-portal", timestamp: toEasternISO() });
}

