"use server";

import type { generateMonthlyMarReportPdfAction as generateMonthlyMarReportPdfActionImpl } from "./actions-impl";

type GenerateMonthlyMarReportPdfInput = Parameters<typeof generateMonthlyMarReportPdfActionImpl>[0];

export async function generateMonthlyMarReportPdfAction(raw: GenerateMonthlyMarReportPdfInput) {
  const { generateMonthlyMarReportPdfAction } = await import("./actions-impl");
  return generateMonthlyMarReportPdfAction(raw);
}
