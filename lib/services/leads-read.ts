import { getLeadDetail } from "@/lib/services/lead-detail-read-model";
import {
  getSalesActivityContextLookupsSupabase,
  getSalesFormLookupsSupabase,
  getSalesLeadFollowUpDashboardSupabase,
  getSalesHomeSnapshotSupabase,
  getSalesLeadByIdSupabase,
  getSalesLeadForEnrollmentSupabase,
  getSalesLeadListSupabase,
  listSalesLeadPickerOptionsSupabase,
  listSalesPartnerPickerOptionsSupabase,
  getSalesRecentActivitySnapshotSupabase,
  getSalesSummarySnapshotSupabase,
  listEnrollmentPacketEligibleLeadPickerSupabase,
  resolveSalesPartnerAndReferralSupabase,
  type SalesLeadEnrollmentRow,
  type SalesEnrollmentPacketEligibleLeadRow,
  type SalesLeadPickerRow,
  type SalesPartnerPickerRow,
  type SalesPartnerRow,
  type SalesReferralSourceRow
} from "@/lib/services/sales-crm-read-model";

export type {
  SalesEnrollmentPacketEligibleLeadRow,
  SalesLeadEnrollmentRow,
  SalesLeadPickerRow,
  SalesPartnerPickerRow,
  SalesPartnerRow,
  SalesReferralSourceRow
};

export async function getLeadById(leadId: string) {
  return getLeadDetail(leadId);
}

export async function getLeadDetailById(leadId: string) {
  return getLeadById(leadId);
}

export async function getLeadRecordById(...args: Parameters<typeof getSalesLeadByIdSupabase>) {
  return getSalesLeadByIdSupabase(...args);
}

export async function getLeadFormLookups(...args: Parameters<typeof getSalesFormLookupsSupabase>) {
  return getSalesFormLookupsSupabase(...args);
}

export async function getLeadActivityContextLookups(...args: Parameters<typeof getSalesActivityContextLookupsSupabase>) {
  return getSalesActivityContextLookupsSupabase(...args);
}

export async function getLeadList(...args: Parameters<typeof getSalesLeadListSupabase>) {
  return getSalesLeadListSupabase(...args);
}

export async function getLeadFollowUpDashboard(...args: Parameters<typeof getSalesLeadFollowUpDashboardSupabase>) {
  return getSalesLeadFollowUpDashboardSupabase(...args);
}

export async function getLeadActivitySnapshot(...args: Parameters<typeof getSalesRecentActivitySnapshotSupabase>) {
  return getSalesRecentActivitySnapshotSupabase(...args);
}

export async function getLeadReferralLinkage(...args: Parameters<typeof resolveSalesPartnerAndReferralSupabase>) {
  return resolveSalesPartnerAndReferralSupabase(...args);
}

export async function getLeadEnrollmentSnapshot(...args: Parameters<typeof getSalesLeadForEnrollmentSupabase>) {
  return getSalesLeadForEnrollmentSupabase(...args);
}

export async function listEnrollmentPacketEligibleLeadPicker(...args: Parameters<typeof listEnrollmentPacketEligibleLeadPickerSupabase>) {
  return listEnrollmentPacketEligibleLeadPickerSupabase(...args);
}

export async function listSalesLeadPickerOptions(...args: Parameters<typeof listSalesLeadPickerOptionsSupabase>) {
  return listSalesLeadPickerOptionsSupabase(...args);
}

export async function listSalesPartnerPickerOptions(...args: Parameters<typeof listSalesPartnerPickerOptionsSupabase>) {
  return listSalesPartnerPickerOptionsSupabase(...args);
}

export async function getLeadHomeSnapshot(...args: Parameters<typeof getSalesHomeSnapshotSupabase>) {
  return getSalesHomeSnapshotSupabase(...args);
}

export async function getLeadSummarySnapshot(...args: Parameters<typeof getSalesSummarySnapshotSupabase>) {
  return getSalesSummarySnapshotSupabase(...args);
}
