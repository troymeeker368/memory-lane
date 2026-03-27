import Link from "next/link";

import { EnrollMemberAction } from "@/components/sales/enroll-member-action";
import {
  parsePageNumber,
  renderSalesPipelineStagePage,
  SALES_PIPELINE_PAGE_SIZE
} from "@/app/(portal)/sales/pipeline/_stage-page";
import { requireModuleAccess } from "@/lib/auth";
import { getLeadList } from "@/lib/services/leads-read";
import { formatDate, formatOptionalDate } from "@/lib/utils";

export default async function SalesEipPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, params] = await Promise.all([requireModuleAccess("sales"), searchParams]);
  const page = parsePageNumber(params.page);
  const result = await getLeadList({
    status: "open",
    stage: "Enrollment in Progress",
    page,
    pageSize: SALES_PIPELINE_PAGE_SIZE
  });

  return renderSalesPipelineStagePage({
    title: "Leads - Enrollment in Progress",
    rows: result.rows,
    page: result.page,
    pageSize: result.pageSize,
    totalRows: result.totalRows,
    totalPages: result.totalPages,
    searchParams: params,
    pathname: "/sales/pipeline/eip",
    emptyMessage: "No enrollment-in-progress leads found.",
    emptyColSpan: 7,
    headerRow: (
      <tr>
        <th>Lead Name</th>
        <th>Stage</th>
        <th>Discovery Date</th>
        <th>Projected Start Date</th>
        <th>Caregiver</th>
        <th>Follow-Up</th>
        <th>Actions</th>
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
        <td>{formatOptionalDate(lead.discovery_date)}</td>
        <td>{formatOptionalDate(lead.member_start_date)}</td>
        <td>{lead.caregiver_name}</td>
        <td>{lead.next_follow_up_date ? `${formatDate(lead.next_follow_up_date)} (${lead.next_follow_up_type ?? "-"})` : "-"}</td>
        <td>
          <EnrollMemberAction leadId={lead.id} />
        </td>
      </>
    )
  });
}
