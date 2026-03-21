import {
  getSalesPartnerDirectoryPageSupabase,
  getSalesReferralSourceDirectoryPageSupabase,
  getSalesReferralSourcesForPartnerIdsSupabase,
  type SalesPartnerRow,
  type SalesReferralSourceRow
} from "@/lib/services/sales-crm-read-model";

export type { SalesPartnerRow, SalesReferralSourceRow };

export async function getCommunityPartnerDirectory(...args: Parameters<typeof getSalesPartnerDirectoryPageSupabase>) {
  return getSalesPartnerDirectoryPageSupabase(...args);
}

export async function getReferralSourceDirectory(...args: Parameters<typeof getSalesReferralSourceDirectoryPageSupabase>) {
  return getSalesReferralSourceDirectoryPageSupabase(...args);
}

export async function getReferralSourcesForPartners(...args: Parameters<typeof getSalesReferralSourcesForPartnerIdsSupabase>) {
  return getSalesReferralSourcesForPartnerIdsSupabase(...args);
}
