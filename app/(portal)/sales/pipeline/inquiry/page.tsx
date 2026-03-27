import Link from "next/link";

import {
  parsePageNumber,
  renderSalesPipelineStagePage,
  SALES_PIPELINE_PAGE_SIZE
} from "@/app/(portal)/sales/pipeline/_stage-page";
import { requireModuleAccess } from "@/lib/auth";
import { getLeadList } from "@/lib/services/leads-read";
import { formatDate } from "@/lib/utils";

export default async function SalesInquiryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, params] = await Promise.all([requireModuleAccess("sales"), searchParams]);
  const page = parsePageNumber(params.page);
  const result = await getLeadList({ status: "open", stage: "Inquiry", page, pageSize: SALES_PIPELINE_PAGE_SIZE });

  return renderSalesPipelineStagePage({
    title: "Leads - Inquiry",
    rows: result.rows,
    page: result.page,
    pageSize: result.pageSize,
    totalRows: result.totalRows,
    totalPages: result.totalPages,
    searchParams: params,
    pathname: "/sales/pipeline/inquiry",
    emptyMessage: "No inquiry leads found.",
    emptyColSpan: 8,
    headerRow: (
      <tr>
        <th>Lead Name</th>
        <th>Caregiver</th>
        <th>Relationship</th>
        <th>Inquiry Date</th>
        <th>Source</th>
        <th>Referral Name</th>
        <th>Likelihood</th>
        <th>Notes</th>
      </tr>
    ),
    renderRow: (lead) => (
      <>
        <td>
          <Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>
            {lead.member_name}
          </Link>
        </td>
        <td>{lead.caregiver_name}</td>
        <td>{lead.caregiver_relationship ?? "-"}</td>
        <td>{lead.inquiry_date ? formatDate(lead.inquiry_date) : "-"}</td>
        <td>{lead.lead_source}</td>
        <td>{lead.referral_name ?? "-"}</td>
        <td>{lead.likelihood ?? "-"}</td>
        <td>{lead.notes_summary ?? "-"}</td>
      </>
    )
  });
}
