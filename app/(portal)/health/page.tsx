import Link from "next/link";

import { BloodSugarForm } from "@/components/forms/workflow-forms";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getMockDb } from "@/lib/mock-repo";
import { getCarePlanDashboard } from "@/lib/services/care-plans";
import { getMembers } from "@/lib/services/documentation";
import { getHealthSnapshot } from "@/lib/services/health-workflows";
import { getClinicalOverview } from "@/lib/services/health";
import { formatDateTime, formatOptionalDateTime } from "@/lib/utils";

interface MarRow {
  id: string;
  member_name: string;
  medication_name: string;
  due_at: string;
  administered_at: string | null;
  nurse_name: string | null;
  status: string;
}

interface BloodSugarRow {
  id: string;
  checked_at: string;
  member_name: string;
  reading_mg_dl: number | string;
  nurse_name: string | null;
  notes: string | null;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toMarRows(rows: unknown[]): MarRow[] {
  return rows.map((row, idx) => {
    const candidate = row as Partial<MarRow>;
    return {
      id: String(candidate.id ?? `mar-row-${idx}`),
      member_name: String(candidate.member_name ?? "Member"),
      medication_name: String(candidate.medication_name ?? "Medication"),
      due_at: String(candidate.due_at ?? ""),
      administered_at: candidate.administered_at ? String(candidate.administered_at) : null,
      nurse_name: candidate.nurse_name ? String(candidate.nurse_name) : null,
      status: String(candidate.status ?? "scheduled")
    };
  });
}

function toBloodSugarRows(rows: unknown[]): BloodSugarRow[] {
  return rows.map((row, idx) => {
    const candidate = row as Partial<BloodSugarRow>;
    return {
      id: String(candidate.id ?? `bg-row-${idx}`),
      checked_at: String(candidate.checked_at ?? ""),
      member_name: String(candidate.member_name ?? "Member"),
      reading_mg_dl: candidate.reading_mg_dl ?? "-",
      nurse_name: candidate.nurse_name ? String(candidate.nurse_name) : null,
      notes: candidate.notes ? String(candidate.notes) : null
    };
  });
}

export default async function HealthPage() {
  await requireModuleAccess("health");
  const [{ mar, bloodSugar }, members, snapshot, carePlans] = await Promise.all([
    getClinicalOverview(),
    getMembers(),
    getHealthSnapshot(),
    Promise.resolve(getCarePlanDashboard())
  ]);

  const marRows = toMarRows(mar as unknown[]);
  const bloodSugarRows = toBloodSugarRows(bloodSugar as unknown[]);
  const now = new Date();
  const fourHoursAhead = new Date(now.getTime() + 4 * 60 * 60 * 1000);

  const dueMedicationRows = toMarRows(snapshot.marToday as unknown[])
    .filter((row) => row.status !== "administered")
    .filter((row) => {
      const dueAt = parseDate(row.due_at);
      if (!dueAt) return false;
      return dueAt <= fourHoursAhead;
    })
    .sort((left, right) => left.due_at.localeCompare(right.due_at));

  const overdueMedicationRows = dueMedicationRows.filter((row) => {
    const dueAt = parseDate(row.due_at);
    return Boolean(dueAt && dueAt < now);
  });

  const recentHealthDocs = [
    ...bloodSugarRows.slice(0, 8).map((row) => ({
      id: `bg-${row.id}`,
      when: row.checked_at,
      memberName: row.member_name,
      source: "Blood Sugar",
      detail: `${row.reading_mg_dl} mg/dL`
    })),
    ...marRows
      .filter((row) => Boolean(row.administered_at))
      .slice(0, 8)
      .map((row) => ({
        id: `mar-${row.id}`,
        when: row.administered_at as string,
        memberName: row.member_name,
        source: "MAR",
        detail: row.medication_name
      }))
  ].sort((left, right) => (left.when < right.when ? 1 : -1));

  const db = getMockDb();
  const mccByMember = new Map(db.memberCommandCenters.map((row) => [row.member_id, row] as const));
  const mhpByMember = new Map(db.memberHealthProfiles.map((row) => [row.member_id, row] as const));
  const careAlerts = db.members
    .filter((member) => member.status === "active")
    .map((member) => {
      const mcc = mccByMember.get(member.id);
      const mhp = mhpByMember.get(member.id);
      const flags: string[] = [];
      const allergyText = `${member.allergies ?? ""} ${mcc?.food_allergies ?? ""} ${mcc?.medication_allergies ?? ""} ${mcc?.environmental_allergies ?? ""}`.trim();
      const dietType = (mcc?.diet_type ?? mhp?.diet_type ?? "").trim().toLowerCase();
      const dietaryRestrictions = `${mcc?.dietary_preferences_restrictions ?? ""} ${mhp?.dietary_restrictions ?? ""}`.trim();
      const codeStatus = (mcc?.code_status ?? mhp?.code_status ?? member.code_status ?? "").trim();

      if (allergyText.length > 0) flags.push("Allergies");
      if ((dietType && dietType !== "regular") || dietaryRestrictions.length > 0) flags.push("Special diet");
      if (codeStatus === "DNR") flags.push("DNR");
      if ((mhp?.important_alerts ?? "").trim().length > 0 || (mcc?.command_center_notes ?? "").trim().length > 0) {
        flags.push("Care alert");
      }
      if ((mhp?.cognitive_behavior_comments ?? "").trim().length > 0) flags.push("Behavior notes");

      return {
        memberId: member.id,
        memberName: member.display_name,
        flags,
        summary:
          (mhp?.important_alerts ?? "").trim() ||
          (mcc?.command_center_notes ?? "").trim() ||
          dietaryRestrictions ||
          (mhp?.cognitive_behavior_comments ?? "").trim() ||
          "-"
      };
    })
    .filter((row) => row.flags.length > 0)
    .sort((left, right) => left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" }))
    .slice(0, 12);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Nursing Dashboard</CardTitle>
        <p className="mt-1 text-sm text-muted">Medication priorities, health documentation, and member care alerts.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Meds Due (4h)</p><p className="text-base font-semibold">{dueMedicationRows.length}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Medication Alerts</p><p className="text-base font-semibold">{overdueMedicationRows.length}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Recent Health Docs</p><p className="text-base font-semibold">{recentHealthDocs.length}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Members w/ Alerts</p><p className="text-base font-semibold">{careAlerts.length}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Care Plans Due Soon</p><p className="text-base font-semibold">{carePlans.summary.dueSoon}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Care Plans Overdue</p><p className="text-base font-semibold">{carePlans.summary.overdue}</p></div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="table-wrap">
          <CardTitle>Medication-Related Alerts</CardTitle>
          <table className="mt-3">
            <thead>
              <tr>
                <th>Member</th>
                <th>Medication</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {dueMedicationRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-sm text-muted">No medication alerts in the next 4 hours.</td>
                </tr>
              ) : (
                dueMedicationRows.slice(0, 12).map((row) => (
                  <tr key={row.id}>
                    <td>{row.member_name}</td>
                    <td>{row.medication_name}</td>
                    <td>{formatDateTime(row.due_at)}</td>
                    <td>{parseDate(row.due_at) && (parseDate(row.due_at) as Date) < now ? "Overdue" : "Scheduled"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>

        <Card className="table-wrap">
          <CardTitle>Recent Health Documentation</CardTitle>
          <table className="mt-3">
            <thead>
              <tr>
                <th>When</th>
                <th>Member</th>
                <th>Type</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {recentHealthDocs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-sm text-muted">No recent health documentation.</td>
                </tr>
              ) : (
                recentHealthDocs.slice(0, 12).map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.when)}</td>
                    <td>{row.memberName}</td>
                    <td>{row.source}</td>
                    <td>{row.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="table-wrap">
          <CardTitle>Allergy / Diet / Care Alerts</CardTitle>
          <table className="mt-3">
            <thead>
              <tr>
                <th>Member</th>
                <th>Flags</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {careAlerts.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-sm text-muted">No care alerts flagged.</td>
                </tr>
              ) : (
                careAlerts.map((row) => (
                  <tr key={row.memberId}>
                    <td>
                      <Link href={`/health/member-health-profiles/${row.memberId}`} className="font-semibold text-brand">
                        {row.memberName}
                      </Link>
                    </td>
                    <td>{row.flags.join(", ")}</td>
                    <td>{row.summary}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardTitle>Recent Incidents</CardTitle>
          <div className="mt-3 space-y-2">
            <p className="text-sm text-muted">
              Incident capture and follow-up tracking will appear here once the incident workflow is enabled.
            </p>
            <div className="rounded-lg border border-border p-3 text-sm text-muted">
              Placeholder area reserved for incident alerts, open follow-ups, and escalations.
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>Health Unit Quick Access</CardTitle>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href="/documentation/blood-sugar" className="font-semibold text-brand">Blood Sugar Workflow</Link>
          <Link href="/health/assessment" className="font-semibold text-brand">New Intake Assessment</Link>
          <Link href="/health/physician-orders" className="font-semibold text-brand">Physician Orders / POF</Link>
          <Link href="/health/member-health-profiles" className="font-semibold text-brand">Member Health Profiles</Link>
          <Link href="/health/care-plans" className="font-semibold text-brand">Care Plans</Link>
        </div>
      </Card>

      <Card>
        <CardTitle>Blood Sugar Testing Entry</CardTitle>
        <div className="mt-3">
          <BloodSugarForm members={members} />
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>MAR / Today</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Medication</th>
              <th>Due</th>
              <th>Administered</th>
              <th>Nurse</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {marRows.map((row) => (
              <tr key={row.id}>
                <td>{row.member_name}</td>
                <td>{row.medication_name}</td>
                <td>{formatDateTime(row.due_at)}</td>
                <td>{formatOptionalDateTime(row.administered_at)}</td>
                <td>{row.nurse_name ?? "-"}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Blood Sugar History</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Checked At</th>
              <th>Member</th>
              <th>Reading (mg/dL)</th>
              <th>Nurse</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {bloodSugarRows.map((row) => (
              <tr key={row.id}>
                <td>{formatDateTime(row.checked_at)}</td>
                <td>{row.member_name}</td>
                <td>{row.reading_mg_dl}</td>
                <td>{row.nurse_name ?? "-"}</td>
                <td>{row.notes ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
