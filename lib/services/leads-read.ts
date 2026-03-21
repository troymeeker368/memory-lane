import { getLeadDetail } from "@/lib/services/lead-detail-read-model";
import {
  getSalesFormLookupsSupabase,
  getSalesHomeSnapshotSupabase,
  getSalesLeadByIdSupabase,
  getSalesLeadForEnrollmentSupabase,
  getSalesLeadListSupabase,
  getSalesRecentActivitySnapshotSupabase,
  getSalesSummarySnapshotSupabase,
  resolveSalesPartnerAndReferralSupabase,
  type SalesLeadEnrollmentRow,
  type SalesPartnerRow,
  type SalesReferralSourceRow
} from "@/lib/services/sales-crm-read-model";

export type { SalesLeadEnrollmentRow, SalesPartnerRow, SalesReferralSourceRow };

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

export async function getLeadList(...args: Parameters<typeof getSalesLeadListSupabase>) {
  return getSalesLeadListSupabase(...args);
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

export async function getLeadHomeSnapshot(...args: Parameters<typeof getSalesHomeSnapshotSupabase>) {
  return getSalesHomeSnapshotSupabase(...args);
}

export async function getLeadSummarySnapshot(...args: Parameters<typeof getSalesSummarySnapshotSupabase>) {
  return getSalesSummarySnapshotSupabase(...args);
}
