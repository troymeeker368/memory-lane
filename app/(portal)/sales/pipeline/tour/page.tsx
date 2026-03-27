import Link from "next/link";

import {
  parsePageNumber,
  renderSalesPipelineStagePage,
  SALES_PIPELINE_PAGE_SIZE
} from "@/app/(portal)/sales/pipeline/_stage-page";
import { requireModuleAccess } from "@/lib/auth";
import { getLeadList } from "@/lib/services/leads-read";
import { formatDate, formatOptionalDate } from "@/lib/utils";

export default async function SalesTourPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, params] = await Promise.all([requireModuleAccess("sales"), searchParams]);
  const page = parsePageNumber(params.page);
  const result = await getLeadList({ status: "open", stage: "Tour", page, pageSize: SALES_PIPELINE_PAGE_SIZE });

  return renderSalesPipelineStagePage({
    title: "Leads - Tour",
    rows: result.rows,
    page: result.page,
    pageSize: result.pageSize,
    totalRows: result.totalRows,
    totalPages: result.totalPages,
    searchParams: params,
    pathname: "/sales/pipeline/tour",
    emptyMessage: "No tour leads found.",
    emptyColSpan: 6,
    headerRow: (
      <tr>
        <th>Lead Name</th>
        <th>Caregiver</th>
        <th>Tour Date</th>
        <th>Tour Completed?</th>
        <th>Next Follow-Up</th>
        <th>Source</th>
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
        <td>{formatOptionalDate(lead.tour_date)}</td>
        <td>{lead.tour_completed ? "Yes" : "No"}</td>
        <td>{lead.next_follow_up_date ? `${formatDate(lead.next_follow_up_date)} (${lead.next_follow_up_type ?? "-"})` : "-"}</td>
        <td>{lead.lead_source}</td>
      </>
    )
  });
}
