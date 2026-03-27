import Link from "next/link";

import {
  parsePageNumber,
  renderSalesPipelineStagePage,
  SALES_PIPELINE_PAGE_SIZE
} from "@/app/(portal)/sales/pipeline/_stage-page";
import { requireModuleAccess } from "@/lib/auth";
import { getLeadList } from "@/lib/services/leads-read";
import { formatOptionalDate } from "@/lib/utils";

export default async function SalesLostPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, params] = await Promise.all([requireModuleAccess("sales"), searchParams]);
  const page = parsePageNumber(params.page);
  const result = await getLeadList({ status: "lost", page, pageSize: SALES_PIPELINE_PAGE_SIZE });

  return renderSalesPipelineStagePage({
    title: "Closed - Lost",
    rows: result.rows,
    page: result.page,
    pageSize: result.pageSize,
    totalRows: result.totalRows,
    totalPages: result.totalPages,
    searchParams: params,
    pathname: "/sales/pipeline/closed-lost",
    emptyMessage: "No lost leads found.",
    emptyColSpan: 6,
    headerRow: (
      <tr>
        <th>Lead Name</th>
        <th>Caregiver</th>
        <th>Source</th>
        <th>Lost Reason</th>
        <th>Closed Date</th>
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
        <td>{lead.lead_source}</td>
        <td>{lead.lost_reason ?? "-"}</td>
        <td>{formatOptionalDate(lead.closed_date)}</td>
        <td>{lead.notes_summary ?? "-"}</td>
      </>
    )
  });
}
