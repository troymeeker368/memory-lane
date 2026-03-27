import Link from "next/link";

import {
  parsePageNumber,
  renderSalesPipelineStagePage,
  SALES_PIPELINE_PAGE_SIZE
} from "@/app/(portal)/sales/pipeline/_stage-page";
import { requireModuleAccess } from "@/lib/auth";
import { getLeadList } from "@/lib/services/leads-read";

export default async function SalesReferralsOnlyPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, params] = await Promise.all([requireModuleAccess("sales"), searchParams]);
  const page = parsePageNumber(params.page);
  const result = await getLeadList({ status: "open", referralOnly: true, page, pageSize: SALES_PIPELINE_PAGE_SIZE });

  return renderSalesPipelineStagePage({
    title: "Leads - Referrals Only",
    rows: result.rows,
    page: result.page,
    pageSize: result.pageSize,
    totalRows: result.totalRows,
    totalPages: result.totalPages,
    searchParams: params,
    pathname: "/sales/pipeline/referrals-only",
    emptyMessage: "No referral leads found.",
    emptyColSpan: 6,
    headerRow: (
      <tr>
        <th>Lead Name</th>
        <th>Stage</th>
        <th>Caregiver</th>
        <th>Source</th>
        <th>Referral Name</th>
        <th>Created By</th>
      </tr>
    ),
    renderRow: (lead) => (
      <>
        <td>
          <Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>
            {lead.member_name}
          </Link>
        </td>
        <td>{lead.stage}</td>
        <td>{lead.caregiver_name}</td>
        <td>{lead.lead_source}</td>
        <td>{lead.referral_name ?? "-"}</td>
        <td>{lead.created_by_name}</td>
      </>
    )
  });
}
