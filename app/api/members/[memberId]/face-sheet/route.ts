import { NextResponse } from "next/server";

import { generateMemberFaceSheetPdfAction } from "@/app/(portal)/members/[memberId]/face-sheet/actions";

export async function POST(
  _request: Request,
  context: { params: Promise<{ memberId: string }> }
) {
  const { memberId } = await context.params;
  const result = await generateMemberFaceSheetPdfAction({ memberId });
  const status = !result.ok && typeof result.error === "string" && result.error.toLowerCase().includes("access")
    ? 403
    : result.status === "error"
      ? 400
      : 200;

  return NextResponse.json(result, { status });
}
