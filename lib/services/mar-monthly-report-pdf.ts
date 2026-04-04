import "server-only";

import type { MarMonthlyReportData, MarMonthlyReportType } from "@/lib/services/mar-monthly-report";
import type { AppRole } from "@/types/app";

async function loadMarMonthlyReportPdfModule() {
  return import("@/lib/documents/mar/mar-monthly-report-pdf");
}

export async function renderMarMonthlyReportPdfBytesForReport(report: MarMonthlyReportData) {
  const { renderMarMonthlyReportPdfBytesForReport } = await loadMarMonthlyReportPdfModule();
  return renderMarMonthlyReportPdfBytesForReport(report);
}

export async function buildMarMonthlyReportPdfDataUrl(input: {
  memberId: string;
  month: string;
  reportType: MarMonthlyReportType;
  generatedBy: {
    name: string;
    role: AppRole | null;
  };
  generatedAtIso?: string;
  serviceRole?: boolean;
}) {
  const { buildMarMonthlyReportPdfDataUrl } = await loadMarMonthlyReportPdfModule();
  return buildMarMonthlyReportPdfDataUrl(input);
}
