import { getLeadDetail } from "@/lib/services/lead-detail-read-model";
import {
  getSalesFormLookupsSupabase,
  getSalesLeadListSupabase,
  getSalesRecentActivitySnapshotSupabase,
  type SalesPartnerRow,
  type SalesReferralSourceRow
} from "@/lib/services/sales-crm-supabase";

export type { SalesPartnerRow, SalesReferralSourceRow };

export async function getLeadById(leadId: string) {
  return getLeadDetail(leadId);
}

export async function getLeadDetailById(leadId: string) {
  return getLeadById(leadId);
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
