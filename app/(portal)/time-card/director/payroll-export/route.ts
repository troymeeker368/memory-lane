import { NextResponse } from "next/server";

import { buildDirectorPayrollExportDownload } from "@/lib/payroll/payroll-export";

function firstString(value: string | null) {
  return value?.trim() || null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const employeeId = firstString(url.searchParams.get("employeeId"));
    const overridePayPeriodStart = firstString(url.searchParams.get("overridePayPeriodStart"));

    const download = await buildDirectorPayrollExportDownload({
      employeeId,
      overridePayPeriodStart
    });

    if (!download.bytes || !download.fileName || !download.contentType) {
      return new NextResponse("No payroll timesheets found for the selected pay period.", {
        status: 404
      });
    }

    return new NextResponse(new Uint8Array(download.bytes), {
      status: 200,
      headers: {
        "Content-Type": download.contentType,
        "Content-Disposition": `attachment; filename="${download.fileName}"`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate payroll export.";
    const status = /requires manager\/director\/admin access/i.test(message) ? 403 : 400;
    return new NextResponse(message, { status });
  }
}
