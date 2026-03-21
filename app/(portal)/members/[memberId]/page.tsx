import Link from "next/link";
import { notFound } from "next/navigation";

import { MemberStatusToggle } from "@/components/forms/member-status-toggle";
import { Card, CardTitle } from "@/components/ui/card";
import { RelatedSection } from "@/components/ui/related-section";
import { requireModuleAccess } from "@/lib/auth";
import { canAccessClinicalDocumentationForRole } from "@/lib/permissions";
import { canAccessCarePlansForRole } from "@/lib/services/care-plan-authorization";
import { getMemberDetail } from "@/lib/services/relations";
import { formatDate, formatDateTime, formatOptionalDate } from "@/lib/utils";

export default async function MemberDetailPage({ params }: { params: Promise<{ memberId: string }> }) {
  const profile = await requireModuleAccess("documentation");
  const canManage = profile.role === "admin" || profile.role === "manager";
  const canViewMhp = profile.role === "admin" || profile.role === "nurse";
  const canViewCarePlans = canAccessCarePlansForRole(profile.role);
  const canViewAssessments = canAccessClinicalDocumentationForRole(profile.role);
  const { memberId } = await params;
  const detail = await getMemberDetail(memberId, { role: profile.role, staffUserId: profile.id });

  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-center gap-3">
          <CardTitle>{detail.member.display_name}</CardTitle>
        </div>
        {canManage ? (
          <div id="discharge-actions" className="mt-2 flex justify-center">
            <MemberStatusToggle memberId={detail.member.id} memberName={detail.member.display_name} status={detail.member.status} />
          </div>
        ) : null}
        <div className="mt-2 grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Status</p><p className="font-semibold">{detail.member.status}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Discharge Date</p><p className="font-semibold">{formatOptionalDate(detail.member.discharge_date)}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Participation Log Entries</p><p className="font-semibold">{detail.counts.dailyActivities}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Health Entries</p><p className="font-semibold">{detail.counts.bloodSugar + detail.marToday.length + (canViewCarePlans ? detail.carePlans.length : 0)}</p></div>
        </div>
        {detail.member.status === "inactive" ? (
          <div className="mt-3 rounded-lg border border-border bg-brandPale p-3 text-sm">
            <p className="font-semibold">Discharge Summary</p>
            <p className="text-muted">Reason: {detail.member.discharge_reason ?? "-"}</p>
            <p className="text-muted">Disposition: {detail.member.discharge_disposition ?? "-"}</p>
            <p className="text-muted">Recorded By: {detail.member.discharged_by ?? "-"}</p>
          </div>
        ) : null}
        {canViewMhp ? (
          <div className="mt-3">
            <Link className="font-semibold text-brand" href={`/health/member-health-profiles/${detail.member.id}`}>
              Open Member Health Profile
            </Link>
          </div>
        ) : null}
      </Card>

      <RelatedSection title="Toilet Log" count={detail.counts.toilets} viewAllHref="/documentation/toilet" addHref="/documentation/toilet">
        <div className="space-y-2">
          {detail.toilets.slice(0, 5).map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDateTime(row.event_at)} - {row.use_type}</p>
              <p className="text-muted">Staff: {row.staff_name}</p>
              <Link className="font-semibold text-brand" href="/documentation/toilet">Open Workflow</Link>
            </div>
          ))}
        </div>
      </RelatedSection>

      <RelatedSection title="Transportation Log" count={detail.counts.transportation} viewAllHref="/documentation/transportation" addHref="/documentation/transportation">
        <div className="space-y-2">
          {detail.transportation.slice(0, 5).map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDate(row.service_date)} - {row.pick_up_drop_off} ({row.transport_type})</p>
              <p className="text-muted">Staff: {row.staff_name}</p>
              <Link className="font-semibold text-brand" href="/documentation/transportation">Open Workflow</Link>
            </div>
          ))}
        </div>
      </RelatedSection>

      <RelatedSection title="Shower Log" count={detail.counts.showers} viewAllHref="/documentation/shower" addHref="/documentation/shower">
        <div className="space-y-2">
          {detail.showers.slice(0, 5).map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDateTime(row.event_at)} - Laundry: {row.laundry ? "Yes" : "No"}</p>
              <p className="text-muted">Staff: {row.staff_name}</p>
              <Link className="font-semibold text-brand" href="/documentation/shower">Open Workflow</Link>
            </div>
          ))}
        </div>
      </RelatedSection>

      <RelatedSection title="Participation Log" count={detail.counts.dailyActivities} viewAllHref="/documentation/activity" addHref="/documentation/activity">
        <div className="space-y-2">
          {detail.dailyActivities.slice(0, 5).map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDate(row.activity_date)} - A1/A2/A3/A4/A5: {row.activity_1_level}/{row.activity_2_level}/{row.activity_3_level}/{row.activity_4_level}/{row.activity_5_level}</p>
              <p className="text-muted">Staff: {row.staff_name}</p>
              <Link className="font-semibold text-brand" href="/documentation/activity">Open Workflow</Link>
            </div>
          ))}
        </div>
      </RelatedSection>

      <RelatedSection title="Blood Sugar Testing" count={detail.counts.bloodSugar} viewAllHref="/documentation/blood-sugar" addHref="/documentation/blood-sugar">
        <div className="space-y-2">
          {detail.bloodSugar.slice(0, 5).map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDateTime(row.checked_at)} - {row.reading_mg_dl} mg/dL</p>
              <p className="text-muted">Nurse: {row.nurse_name}</p>
              <Link className="font-semibold text-brand" href="/documentation/blood-sugar">Open Workflow</Link>
            </div>
          ))}
        </div>
      </RelatedSection>

      <RelatedSection title="Ancillary Charges" count={detail.counts.ancillary} viewAllHref="/ancillary" addHref="/ancillary">
        <div className="space-y-2">
          {detail.ancillary.slice(0, 5).map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDate(row.service_date)} - {row.category_name} (${(row.amount_cents / 100).toFixed(2)})</p>
              <p className="text-muted">Staff: {row.staff_name}</p>
              <Link className="font-semibold text-brand" href="/ancillary">Open Workflow</Link>
            </div>
          ))}
        </div>
      </RelatedSection>

      {canViewAssessments ? (
      <RelatedSection title="Assessments" count={detail.counts.assessments} viewAllHref="/health/assessment" addHref="/health/assessment">
        <div className="space-y-2">
          {detail.member.latest_assessment_id ? (
            <div className="rounded-lg border border-border bg-brandPale p-3 text-sm">
              <p className="font-semibold">Latest Assessment Snapshot</p>
              <p className="text-muted">Date: {formatOptionalDate(detail.member.latest_assessment_date)} | Score: {detail.member.latest_assessment_score ?? "-"} | Track: {detail.member.latest_assessment_track ?? "-"}</p>
              <Link className="font-semibold text-brand" href={`/health/assessment/${detail.member.latest_assessment_id}`}>Open Latest Assessment</Link>
            </div>
          ) : null}

          {detail.assessments.slice(0, 5).map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDate(row.assessment_date)} - Score: {row.total_score ?? "-"} ({row.recommended_track ?? "-"})</p>
              <p className="text-muted">Completed By: {row.completed_by ?? row.reviewer_name ?? "-"} | Admission Review: {row.admission_review_required ? "Required" : "No"}</p>
              <Link className="font-semibold text-brand" href={`/health/assessment/${row.id}`}>Open Assessment Detail</Link>
            </div>
          ))}
        </div>
      </RelatedSection>
      ) : null}

      {canViewCarePlans ? (
      <RelatedSection title="Care Plans" count={detail.carePlans.length} viewAllHref="/health/care-plans/list" addHref={`/health/care-plans/new?memberId=${detail.member.id}`}>
        <div className="space-y-2">
          {detail.latestCarePlan ? (
            <div className="rounded-lg border border-border bg-brandPale p-3 text-sm">
              <p className="font-semibold">Most Recent Care Plan: {detail.latestCarePlan.track}</p>
              <p className="text-muted">Review Date: {formatDate(detail.latestCarePlan.reviewDate)} | Next Due: {formatDate(detail.latestCarePlan.nextDueDate)} ({detail.latestCarePlan.status})</p>
              <div className="mt-2 flex flex-wrap gap-3">
                <Link className="font-semibold text-brand" href={`/health/care-plans/${detail.latestCarePlan.id}`}>Review / Update Latest Care Plan</Link>
                <Link className="font-semibold text-brand" href={`/health/care-plans/member/${detail.member.id}/latest`}>Open Latest From Member Context</Link>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">No care plan found for this member yet.</p>
              <Link className="font-semibold text-brand" href={`/health/care-plans/new?memberId=${detail.member.id}`}>Create First Care Plan</Link>
            </div>
          )}

          {detail.carePlans.slice(0, 5).map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{row.track} - Next Due: {formatDate(row.nextDueDate)} ({row.status})</p>
              <p className="text-muted">Enrollment: {formatDate(row.enrollmentDate)} | Review Date: {formatDate(row.reviewDate)} | Last Completed: {formatOptionalDate(row.lastCompletedDate)}</p>
              <Link className="font-semibold text-brand" href={`/health/care-plans/${row.id}`}>Open Care Plan</Link>
            </div>
          ))}
        </div>
      </RelatedSection>
      ) : null}

      <RelatedSection title="Photos / Documents" count={detail.counts.photos} viewAllHref="/documentation/photo-upload" addHref="/documentation/photo-upload">
        <div className="space-y-2">
          {detail.photos.slice(0, 5).map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">Uploaded {formatDateTime(row.uploaded_at)}</p>
              <p className="text-muted">Taken by: {row.uploaded_by_name}</p>
              <a className="font-semibold text-brand" href={row.photo_url} target="_blank" rel="noopener noreferrer">Open Photo</a>
            </div>
          ))}
        </div>
      </RelatedSection>

      <RelatedSection title="MAR / Health Actions" count={detail.marToday.length} viewAllHref="/health/mar" addHref="/health/mar">
        <div className="space-y-2">
          {detail.marToday.map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDate(row.date)} - {row.medication} {row.dose}</p>
              <p className="text-muted">{row.route} {row.frequency} at {row.scheduled_time} ({row.action}) by {row.staff}</p>
            </div>
          ))}
        </div>
      </RelatedSection>
    </div>
  );
}











