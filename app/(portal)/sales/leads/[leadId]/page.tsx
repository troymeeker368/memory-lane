import Link from "next/link";
import { notFound } from "next/navigation";

import { EnrollMemberAction } from "@/components/sales/enroll-member-action";
import { LeadContactQuickActions } from "@/components/sales/lead-contact-quick-actions";
import { SendEnrollmentPacketAction } from "@/components/sales/send-enrollment-packet-action";
import { Card, CardTitle } from "@/components/ui/card";
import { RelatedSection } from "@/components/ui/related-section";
import { requireModuleAccess } from "@/lib/auth";
import { canonicalLeadStage, isEnrollmentPacketEligibleLeadState } from "@/lib/canonical";
import { formatPhoneDisplay } from "@/lib/phone";
import { getEnrollmentPricingOverview } from "@/lib/services/enrollment-pricing";
import { listOperationalEnrollmentPackets } from "@/lib/services/enrollment-packets";
import { getLeadById } from "@/lib/services/leads-read";
import { formatDate, formatDateTime, formatOptionalDateTime } from "@/lib/utils";

export default async function LeadDetailPage({ params }: { params: Promise<{ leadId: string }> }) {
  await requireModuleAccess("sales");
  const { leadId } = await params;
  const [detail, pricingOverview] = await Promise.all([
    getLeadById(leadId),
    getEnrollmentPricingOverview()
  ]);

  if (!detail) notFound();

  const lead = detail.lead;
  const showEnrollMemberAction = canonicalLeadStage(lead.stage) === "Enrollment in Progress";
  const showSendEnrollmentPacketAction = isEnrollmentPacketEligibleLeadState({
    requestedStage: lead.stage,
    requestedStatus: lead.status
  });
  const packets = await listOperationalEnrollmentPackets({
    leadId: lead.id,
    includeCompleted: true,
    limit: 20
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>{lead.member_name || "Lead"}</CardTitle>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Stage / Status</p><p className="font-semibold">{lead.stage} / {lead.status}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Inquiry Date</p><p className="font-semibold">{formatDate(lead.inquiry_date)}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Lead Source</p><p className="font-semibold">{lead.lead_source}</p></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link className="font-semibold text-brand" href={`/sales/new-entries/log-lead-activity?leadId=${lead.id}`}>Log Lead Activity</Link>
          <Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}/edit`}>Edit Lead</Link>
          {detail.partner ? <Link className="font-semibold text-brand" href={`/sales/community-partners/organizations/${detail.partner.id}`}>View Community Partner</Link> : null}
          {detail.referralSource ? <Link className="font-semibold text-brand" href={`/sales/community-partners/referral-sources/${detail.referralSource.id}`}>View Referral Source</Link> : null}
        </div>
        {showEnrollMemberAction || showSendEnrollmentPacketAction ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {showEnrollMemberAction ? <EnrollMemberAction leadId={lead.id} /> : null}
            {showSendEnrollmentPacketAction ? (
              <SendEnrollmentPacketAction
                leadId={lead.id}
                defaultCaregiverEmail={lead.caregiver_email}
                defaultRequestedStartDate={lead.member_start_date}
                pricingPreview={{
                  communityFeeAmount: pricingOverview.activeCommunityFee?.amount ?? null,
                  dailyRates: pricingOverview.activeDailyRates.map((tier) => ({
                    id: tier.id,
                    label: tier.label,
                    minDaysPerWeek: tier.minDaysPerWeek,
                    maxDaysPerWeek: tier.maxDaysPerWeek,
                    dailyRate: tier.dailyRate
                  })),
                  issues: pricingOverview.issues
                }}
              />
            ) : null}
          </div>
        ) : null}
        <div className="mt-3">
          <LeadContactQuickActions
            leadId={lead.id}
            memberName={lead.member_name}
            caregiverEmail={lead.caregiver_email}
            caregiverPhone={lead.caregiver_phone}
          />
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Caregiver / Contact Info</CardTitle>
        <table>
          <thead><tr><th>Caregiver</th><th>Relationship</th><th>Email</th><th>Phone</th><th>Referral Name</th><th>Likelihood</th><th>Next Follow-Up</th></tr></thead>
          <tbody><tr><td>{lead.caregiver_name}</td><td>{lead.caregiver_relationship ?? "-"}</td><td>{lead.caregiver_email ?? "-"}</td><td>{formatPhoneDisplay(lead.caregiver_phone)}</td><td>{lead.referral_name ?? "-"}</td><td>{lead.likelihood ?? "-"}</td><td>{lead.next_follow_up_date ? `${formatDate(lead.next_follow_up_date)} (${lead.next_follow_up_type ?? "-"})` : "-"}</td></tr></tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Enrollment Packets</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Sent</th>
              <th>Last Activity</th>
              <th>Completed</th>
              <th>Voided</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {packets.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-sm text-muted">
                  No enrollment packets issued for this lead yet.
                </td>
              </tr>
            ) : (
              packets.map((packet) => (
                <tr key={packet.id}>
                  <td className="capitalize">{packet.status.replaceAll("_", " ")}</td>
                  <td>{packet.sentAt ? formatDateTime(packet.sentAt) : "-"}</td>
                  <td>{formatDateTime(packet.lastFamilyActivityAt ?? packet.updatedAt)}</td>
                  <td>
                    {formatOptionalDateTime(
                      packet.completedAt ??
                        (packet.status === "completed" ? packet.lastFamilyActivityAt ?? packet.updatedAt : null)
                    )}
                  </td>
                  <td>{packet.voidedAt ? formatDateTime(packet.voidedAt) : "-"}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <Link className="font-semibold text-brand" href={`/sales/pipeline/enrollment-packets/${packet.id}`}>
                        Open
                      </Link>
                      <Link className="font-semibold text-brand" href="/sales/pipeline/enrollment-packets">
                        All Packets
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {detail.partner ? (
        <Card>
          <CardTitle>Linked Community Partner</CardTitle>
          <p className="text-sm font-semibold">{detail.partner.organization_name}</p>
          <p className="text-sm text-muted">{detail.partner.contact_name || "-"} | {formatPhoneDisplay(detail.partner.primary_phone)}</p>
          <Link className="text-sm font-semibold text-brand" href={`/sales/community-partners/organizations/${detail.partner.id}`}>Open Community Partner Detail</Link>
        </Card>
      ) : null}

      {detail.referralSource ? (
        <Card>
          <CardTitle>Linked Referral Source</CardTitle>
          <p className="text-sm font-semibold">{detail.referralSource.contact_name} - {detail.referralSource.organization_name}</p>
          <p className="text-sm text-muted">{formatPhoneDisplay(detail.referralSource.primary_phone)} | {detail.referralSource.primary_email || "-"}</p>
          <Link className="text-sm font-semibold text-brand" href={`/sales/community-partners/referral-sources/${detail.referralSource.id}`}>Open Referral Source Detail</Link>
        </Card>
      ) : null}

      <RelatedSection title="Lead Activity History" count={detail.activities.length} viewAllHref="/sales/new-entries/log-lead-activity" addHref={`/sales/new-entries/log-lead-activity?leadId=${lead.id}`}>
        <div className="space-y-2">
          {detail.activities.slice(0, 20).map((activity) => (
            <div key={activity.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDateTime(activity.activity_at)} - {activity.activity_type}</p>
              <p className="text-muted">Outcome: {activity.outcome}</p>
              <p className="text-muted">Next: {activity.next_follow_up_date ? `${formatDate(activity.next_follow_up_date)} (${activity.next_follow_up_type ?? "-"})` : "-"}</p>
              <p>{activity.notes ?? "-"}</p>
            </div>
          ))}
        </div>
      </RelatedSection>

      <RelatedSection title="Stage / Status History" count={detail.stageHistory.length} viewAllHref={`/sales/leads/${lead.id}`} addHref={`/sales/leads/${lead.id}/edit`}>
        <div className="space-y-2">
          {detail.stageHistory.slice(0, 20).map((history) => (
            <div key={history.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDateTime(history.changed_at)}</p>
              <p className="text-muted">
                Stage: {history.from_stage ?? "N/A"} {" -> "} {history.to_stage}
              </p>
              <p className="text-muted">
                Status: {history.from_status ?? "N/A"} {" -> "} {history.to_status}
              </p>
              <p className="text-muted">
                By: {history.changed_by_name} | Source: {history.source}
              </p>
              <p>{history.reason ?? "-"}</p>
            </div>
          ))}
        </div>
      </RelatedSection>

      <RelatedSection
        title="Related Partner Activities"
        count={detail.partnerActivities.length}
        viewAllHref="/sales/new-entries/log-partner-activities"
        addHref={`/sales/new-entries/log-partner-activities?leadId=${lead.id}${detail.partner ? `&partnerId=${detail.partner.id}` : ""}${detail.referralSource ? `&referralSourceId=${detail.referralSource.id}` : ""}`}
      >
        <div className="space-y-2">
          {detail.partnerActivities.slice(0, 20).map((activity) => (
            <div key={activity.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDateTime(activity.activity_at)} - {activity.activity_type}</p>
              <p className="text-muted">Organization: {activity.organization_name || "-"} | Contact: {activity.contact_name || "-"}</p>
              <p>{activity.notes || "-"}</p>
            </div>
          ))}
        </div>
      </RelatedSection>
    </div>
  );
}
