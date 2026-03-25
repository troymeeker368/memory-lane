import Link from "next/link";

import { QuickEditAncillary } from "@/components/forms/record-actions";
import { AncillaryChargeForm } from "@/components/forms/ancillary-charge-form";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import { getAncillarySummary, listMemberAncillaryChargeLogs } from "@/lib/services/ancillary";
import { formatDate } from "@/lib/utils";
import type { AppRole } from "@/types/app";

export default async function MemberCommandCenterAdditionalChargesTab({
  memberId,
  memberName,
  role,
  actorUserId
}: {
  memberId: string;
  memberName: string;
  role: AppRole;
  actorUserId: string;
}) {
  const [summary, rows] = await Promise.all([
    getAncillarySummary(undefined, { role, staffUserId: actorUserId }),
    listMemberAncillaryChargeLogs({ memberId, limit: 25 }, { role, staffUserId: actorUserId })
  ]);

  const canManageEntries = role === "admin" || role === "manager" || role === "director";

  return (
    <Card id="additional-charges">
      <SectionHeading
        title="Additional Charges"
        lastUpdatedAt={rows[0]?.created_at ?? null}
        lastUpdatedBy={rows[0]?.staff_name ?? null}
      />

      <div className="mt-3 rounded-lg border border-border p-3">
        <p className="text-sm text-muted">
          Charges entered here stay scoped to {memberName} from the current MCC context while still using the canonical ancillary workflow and pricing categories.
        </p>
        <div className="mt-3">
          <AncillaryChargeForm
            fixedMember={{ id: memberId, display_name: memberName }}
            categories={summary.categories}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/ancillary" className="font-semibold text-brand">
          Open Full Ancillary Workflow
        </Link>
        {canManageEntries ? (
          <Link href="/reports/monthly-ancillary" className="font-semibold text-brand">
            Open Monthly Ancillary Report
          </Link>
        ) : null}
      </div>

      <div className="mt-3 rounded-lg border border-border p-3 table-wrap">
        <p className="text-sm font-semibold text-fg">Recent Charges for {memberName}</p>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Qty</th>
              <th>Amount</th>
              <th>Source</th>
              <th>Notes</th>
              {canManageEntries ? <th>Edit</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={canManageEntries ? 7 : 6} className="text-sm text-muted">
                  No additional charges logged for this member yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id ?? `${row.service_date}-${row.category_name}`}>
                  <td>{row.service_date ? formatDate(row.service_date) : "-"}</td>
                  <td>{row.category_name ?? "-"}</td>
                  <td>{row.quantity ?? 1}</td>
                  <td>{typeof row.amount_cents === "number" ? `$${(row.amount_cents / 100).toFixed(2)}` : "-"}</td>
                  <td>{row.source_entity ?? "Manual"}</td>
                  <td>{row.notes ?? row.reconciliation_note ?? "-"}</td>
                  {canManageEntries ? (
                    <td>{row.id ? <QuickEditAncillary id={row.id} notes={row.notes ?? row.reconciliation_note ?? null} /> : null}</td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
