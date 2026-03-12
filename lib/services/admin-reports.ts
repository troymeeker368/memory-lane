import "server-only";

import { resolveDateRange, type ReportDateRange } from "@/lib/services/report-date-range";

type StatusFilter = "On Time" | "Late" | "Missing";

export type { ReportDateRange };

export interface BaseReportFilters extends ReportDateRange {
  member?: string;
  staff?: string;
  status?: StatusFilter | "All";
  documentationType?: string;
}

function legacyAdminReportsRetired(functionName: string): never {
  throw new Error(
    `Legacy admin report service (${functionName}) is retired. Use lib/services/admin-reporting-foundation.ts instead.`
  );
}

export { resolveDateRange };

export async function getAdminReportLookups() {
  return legacyAdminReportsRetired("getAdminReportLookups");
}

export async function getAdminStaffProductivity(_filters: BaseReportFilters) {
  return legacyAdminReportsRetired("getAdminStaffProductivity");
}

export async function getAdminTimelyDocumentation(_filters: BaseReportFilters) {
  return legacyAdminReportsRetired("getAdminTimelyDocumentation");
}

export async function getAdminAncillaryAudit(_filters: BaseReportFilters) {
  return legacyAdminReportsRetired("getAdminAncillaryAudit");
}

export async function getAdminPayPeriodReview() {
  return legacyAdminReportsRetired("getAdminPayPeriodReview");
}

export async function getAdminPunchExceptions(_filters: ReportDateRange & { staff?: string }) {
  return legacyAdminReportsRetired("getAdminPunchExceptions");
}

export async function getAdminDocumentationByMember(_filters: BaseReportFilters) {
  return legacyAdminReportsRetired("getAdminDocumentationByMember");
}

export async function getAdminLastToileted() {
  return legacyAdminReportsRetired("getAdminLastToileted");
}

export async function getAdminCareTracker() {
  return legacyAdminReportsRetired("getAdminCareTracker");
}

export async function getAdminSalesPipelineSummary(_filters: ReportDateRange) {
  return legacyAdminReportsRetired("getAdminSalesPipelineSummary");
}

export async function getAdminCommunityPartnerPerformance(_filters: ReportDateRange) {
  return legacyAdminReportsRetired("getAdminCommunityPartnerPerformance");
}

export async function getAdminLeadActivityReport(_filters: ReportDateRange & { staff?: string; partner?: string; lead?: string }) {
  return legacyAdminReportsRetired("getAdminLeadActivityReport");
}

export async function getAdminAssessmentStatus(_filters: BaseReportFilters) {
  return legacyAdminReportsRetired("getAdminAssessmentStatus");
}

export async function getAdminMemberServiceUtilization(_filters: BaseReportFilters) {
  return legacyAdminReportsRetired("getAdminMemberServiceUtilization");
}

export async function getAdminReportGeneratedAt() {
  return legacyAdminReportsRetired("getAdminReportGeneratedAt");
}

export async function isDateInCurrentPayPeriod(_dateOnly: string) {
  return legacyAdminReportsRetired("isDateInCurrentPayPeriod");
}
