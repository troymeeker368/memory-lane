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

export async function getAdminStaffProductivity(filters: BaseReportFilters) {
  void filters;
  return legacyAdminReportsRetired("getAdminStaffProductivity");
}

export async function getAdminTimelyDocumentation(filters: BaseReportFilters) {
  void filters;
  return legacyAdminReportsRetired("getAdminTimelyDocumentation");
}

export async function getAdminAncillaryAudit(filters: BaseReportFilters) {
  void filters;
  return legacyAdminReportsRetired("getAdminAncillaryAudit");
}

export async function getAdminPayPeriodReview() {
  return legacyAdminReportsRetired("getAdminPayPeriodReview");
}

export async function getAdminPunchExceptions(filters: ReportDateRange & { staff?: string }) {
  void filters;
  return legacyAdminReportsRetired("getAdminPunchExceptions");
}

export async function getAdminDocumentationByMember(filters: BaseReportFilters) {
  void filters;
  return legacyAdminReportsRetired("getAdminDocumentationByMember");
}

export async function getAdminLastToileted() {
  return legacyAdminReportsRetired("getAdminLastToileted");
}

export async function getAdminCareTracker() {
  return legacyAdminReportsRetired("getAdminCareTracker");
}

export async function getAdminSalesPipelineSummary(filters: ReportDateRange) {
  void filters;
  return legacyAdminReportsRetired("getAdminSalesPipelineSummary");
}

export async function getAdminCommunityPartnerPerformance(filters: ReportDateRange) {
  void filters;
  return legacyAdminReportsRetired("getAdminCommunityPartnerPerformance");
}

export async function getAdminLeadActivityReport(filters: ReportDateRange & { staff?: string; partner?: string; lead?: string }) {
  void filters;
  return legacyAdminReportsRetired("getAdminLeadActivityReport");
}

export async function getAdminAssessmentStatus(filters: BaseReportFilters) {
  void filters;
  return legacyAdminReportsRetired("getAdminAssessmentStatus");
}

export async function getAdminMemberServiceUtilization(filters: BaseReportFilters) {
  void filters;
  return legacyAdminReportsRetired("getAdminMemberServiceUtilization");
}

export async function getAdminReportGeneratedAt() {
  return legacyAdminReportsRetired("getAdminReportGeneratedAt");
}

export async function isDateInCurrentPayPeriod(dateOnly: string) {
  void dateOnly;
  return legacyAdminReportsRetired("isDateInCurrentPayPeriod");
}
