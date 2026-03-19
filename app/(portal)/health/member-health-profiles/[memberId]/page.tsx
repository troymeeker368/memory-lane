import Link from "next/link";
import { notFound } from "next/navigation";

import { MhpMedicalDietFields } from "@/components/forms/mhp-medical-diet-fields";
import {
  MhpAllergiesSection,
  MhpDiagnosesSection,
  MhpEquipmentSection,
  MhpLegalForm,
  MhpMedicationsSection,
  MhpNotesSection,
  MhpOverviewForm,
  MhpPhotoUploader,
  MhpProvidersSection,
  MhpTrackBannerEditor
} from "@/components/forms/mhp-shells";
import { SegmentedChoiceGroup } from "@/components/forms/segmented-choice-group";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { MemberStatusToggle } from "@/components/forms/member-status-toggle";
import { requireRoles } from "@/lib/auth";
import { formatBillingPayorDisplayName, getBillingPayorContact } from "@/lib/services/billing-payor-contacts";
import { getCarePlansForMember, getMemberCarePlanSummary } from "@/lib/services/care-plans";
import { getPhysicianOrdersForMember } from "@/lib/services/physician-orders-supabase";
import { getMemberProgressNoteSummary } from "@/lib/services/progress-notes";
import {
  MHP_TABS,
  type MhpTab,
  getMemberHealthProfileDetailSupabase
} from "@/lib/services/member-health-profiles-supabase";
import {
  MHP_AMBULATION_OPTIONS,
  MHP_BLADDER_CONTINENCE_OPTIONS,
  MHP_BOWEL_CONTINENCE_OPTIONS,
  MHP_DENTAL_OPTIONS,
  MHP_DRESSING_OPTIONS,
  MHP_HEARING_OPTIONS,
  MHP_SELF_MEDICATE_OPTIONS,
  MHP_SPEECH_STATUS_OPTIONS,
  MHP_TOILETING_OPTIONS,
  MHP_TRANSFER_SUPPORT_OPTIONS,
  MHP_VISION_OPTIONS
} from "@/lib/services/mhp-functional-options";
import { formatDate, formatDateTime, formatOptionalDate } from "@/lib/utils";
import {
  saveMhpCognitiveBehaviorAction,
  saveMhpFunctionalAction,
  saveMhpMedicalAction
} from "@/app/(portal)/health/member-health-profiles/profile-actions";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function resolveTab(raw: string | undefined): MhpTab {
  if (raw && MHP_TABS.includes(raw as MhpTab)) return raw as MhpTab;
  return "overview";
}

function boolSelect(name: string, value: boolean | null | undefined) {
  const normalized = value == null ? "" : value ? "true" : "false";
  return (
    <select name={name} defaultValue={normalized} className="h-10 rounded-lg border border-border px-3">
      <option value="">Not recorded</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>
  );
}

const TAB_LABELS: Record<MhpTab, string> = {
  overview: "Overview",
  medical: "Medical",
  functional: "Functional",
  "cognitive-behavioral": "Cognitive / Behavioral",
  equipment: "Equipment",
  legal: "Legal",
  notes: "Notes"
};

const DIET_TYPE_OPTIONS = ["Regular", "Diabetic", "Low Sodium", "Pureed", "Renal", "Heart Healthy", "Other"] as const;
const DIET_TEXTURE_OPTIONS = ["Regular", "Mechanical Soft", "Chopped", "Ground", "Pureed", "Nectar Thick", "Honey Thick"] as const;
const NOTE_TYPE_OPTIONS = ["Clinical", "Behavioral", "Caregiver Communication", "Incident Follow-up", "Care Plan", "General"] as const;

function clinicalSyncLabel(status: "not_signed" | "pending" | "queued" | "failed" | "synced") {
  if (status === "synced") return "Synced";
  if (status === "failed") return "Failed";
  if (status === "queued") return "Queued";
  if (status === "pending") return "Pending";
  return "-";
}
const EQUIPMENT_STATUS_OPTIONS = ["Active", "Inactive"] as const;
const MEDICATION_ROUTE_OPTIONS = ["PO", "SQ", "IM", "TD", "INH", "Topical", "Ophthalmic", "Otic"] as const;

function Field({ label, name, defaultValue }: { label: string; name: string; defaultValue?: string }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <input name={name} defaultValue={defaultValue ?? ""} className="h-10 w-full rounded-lg border border-border px-3" />
    </label>
  );
}

function Area({ label, name, defaultValue }: { label: string; name: string; defaultValue?: string }) {
  return (
    <label className="space-y-1 text-sm md:col-span-2">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <textarea name={name} defaultValue={defaultValue ?? ""} className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" />
    </label>
  );
}

function latestTimestamp(values: Array<string | null | undefined>) {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) return null;
  return valid.reduce((latest, current) => {
    const latestMs = Number.isNaN(Date.parse(latest)) ? 0 : Date.parse(latest);
    const currentMs = Number.isNaN(Date.parse(current)) ? 0 : Date.parse(current);
    return currentMs > latestMs ? current : latest;
  });
}

function latestUpdatedBy<T>(
  rows: T[],
  getTimestamp: (row: T) => string | null | undefined,
  getBy: (row: T) => string | null | undefined
) {
  let latestAt: string | null = null;
  let latestBy: string | null = null;
  rows.forEach((row) => {
    const currentAt = getTimestamp(row);
    if (!currentAt) return;
    if (!latestAt) {
      latestAt = currentAt;
      latestBy = getBy(row) ?? null;
      return;
    }
    const latestMs = Number.isNaN(Date.parse(latestAt)) ? 0 : Date.parse(latestAt);
    const currentMs = Number.isNaN(Date.parse(currentAt)) ? 0 : Date.parse(currentAt);
    if (currentMs > latestMs) {
      latestAt = currentAt;
      latestBy = getBy(row) ?? null;
    }
  });
  return latestBy;
}

function orientationDefaultValue(raw: string | null | undefined) {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "";
  if (value === "yes" || value === "y" || value === "true" || value === "verified") return "Yes";
  if (value === "no" || value === "n" || value === "false" || value === "not verified") return "No";
  return "Yes";
}

function SectionHeading({
  title,
  lastUpdatedAt,
  lastUpdatedBy
}: {
  title: string;
  lastUpdatedAt: string | null | undefined;
  lastUpdatedBy: string | null | undefined;
}) {
  return (
    <div className="flex w-full flex-wrap items-baseline justify-start gap-x-3 gap-y-1 text-left">
      <CardTitle className="text-left">{title}</CardTitle>
      <span className="text-left text-xs font-normal text-muted">
        Last updated: {lastUpdatedAt ? formatDateTime(lastUpdatedAt) : "-"} | Last updated by: {lastUpdatedBy ?? "-"}
      </span>
    </div>
  );
}

export default async function MemberHealthProfileDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentProfile = await requireRoles(["admin", "nurse"]);
  const canManageMemberStatus = currentProfile.role === "admin" || currentProfile.role === "manager";
  const { memberId } = await params;
  const query = await searchParams;
  const tab = resolveTab(firstString(query.tab));

  const detail = await getMemberHealthProfileDetailSupabase(memberId);
  if (!detail) notFound();

  const { member, profile } = detail;
  const codeStatusBanner = profile.code_status ?? member.code_status ?? "-";
  const codeStatusStyle =
    codeStatusBanner === "DNR"
      ? { color: "#b91c1c" }
      : codeStatusBanner === "Full Code"
        ? { color: "#99CC33" }
        : undefined;
  const genderDefault =
    (profile.gender ?? "").toLowerCase().startsWith("f") ? "F" : (profile.gender ?? "").toLowerCase().startsWith("m") ? "M" : "";
  const rawDietType = profile.diet_type ?? "Regular";
  const dietTypeDefault = DIET_TYPE_OPTIONS.includes(rawDietType as (typeof DIET_TYPE_OPTIONS)[number]) ? rawDietType : "Other";
  const dietTypeOtherDefault = dietTypeDefault === "Other" ? (profile.diet_type ?? "") : "";
  const dietTextureDefault = profile.diet_texture ?? "Regular";
  const diagnosesUpdatedAt = latestTimestamp(detail.diagnoses.map((row) => row.updated_at));
  const providersUpdatedAt = latestTimestamp(detail.providers.map((row) => row.updated_at));
  const medicationsUpdatedAt = latestTimestamp(detail.medications.map((row) => row.updated_at));
  const allergiesUpdatedAt = latestTimestamp(detail.allergies.map((row) => row.updated_at));
  const equipmentUpdatedAt = latestTimestamp(detail.equipment.map((row) => row.updated_at));
  const notesUpdatedAt = latestTimestamp(detail.notes.map((row) => row.updated_at));
  const assessmentsUpdatedAt = latestTimestamp(detail.assessments.map((row) => row.created_at));
  const profileUpdatedBy = profile.updated_by_name ?? detail.lastUpdatedBy ?? null;
  const diagnosesUpdatedBy = latestUpdatedBy(detail.diagnoses, (row) => row.updated_at, (row) => row.created_by_name);
  const providersUpdatedBy = latestUpdatedBy(detail.providers, (row) => row.updated_at, (row) => row.created_by_name);
  const medicationsUpdatedBy = latestUpdatedBy(detail.medications, (row) => row.updated_at, (row) => row.created_by_name);
  const allergiesUpdatedBy = latestUpdatedBy(detail.allergies, (row) => row.updated_at, (row) => row.created_by_name);
  const equipmentUpdatedBy = latestUpdatedBy(detail.equipment, (row) => row.updated_at, (row) => row.created_by_name);
  const notesUpdatedBy = latestUpdatedBy(detail.notes, (row) => row.updated_at, (row) => row.created_by_name);
  const assessmentsUpdatedBy = latestUpdatedBy(detail.assessments, (row) => row.created_at, (row) => row.completed_by);
  const relatedCarePlans = await getCarePlansForMember(member.id);
  const billingPayor = await getBillingPayorContact(member.id, {
    source: "MemberHealthProfileDetailPage"
  });
  const carePlansUpdatedAt = latestTimestamp(relatedCarePlans.map((row) => row.updatedAt));
  const carePlansUpdatedBy = latestUpdatedBy(relatedCarePlans, (row) => row.updatedAt, (row) => row.completedBy);
  const relatedPhysicianOrders = await getPhysicianOrdersForMember(member.id);
  const physicianOrdersUpdatedAt = latestTimestamp(relatedPhysicianOrders.map((row) => row.updatedAt));
  const physicianOrdersUpdatedBy = latestUpdatedBy(relatedPhysicianOrders, (row) => row.updatedAt, (row) => row.updatedByName);
  const carePlanSummary = await getMemberCarePlanSummary(member.id);
  const progressNoteSummary = await getMemberProgressNoteSummary(member.id);
  const latestIntakeAssessment = detail.assessments[0] ?? null;
  const trackFromRecord = member.latest_assessment_track ?? latestIntakeAssessment?.recommended_track ?? null;
  const trackSourceText = latestIntakeAssessment
    ? `Latest intake: ${formatDate(latestIntakeAssessment.assessment_date)}`
    : "No intake assessment";

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-4 flex flex-col items-center gap-2">
          <MhpPhotoUploader
            memberId={member.id}
            returnTab={tab}
            profileImageUrl={profile.profile_image_url ?? null}
            displayName={member.display_name}
          />
          <div className="text-center">
            <p className="text-2xl font-bold text-primary-text">{member.display_name}</p>
            <p className="text-sm font-semibold text-muted">Member Health Profile</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <BackArrowButton
            fallbackHref="/health/member-health-profiles"
            forceFallback
            ariaLabel="Back to member health profile list"
          />
          <Link href={`/operations/member-command-center/${member.id}`} className="font-semibold text-brand">Member Command Center</Link>
          <Link href={`/members/${member.id}`} className="font-semibold text-brand">Member Detail</Link>
          <Link href={`/health/assessment?memberId=${member.id}`} className="font-semibold text-brand">New Intake Assessment</Link>
          <Link href={carePlanSummary.actionHref} className="font-semibold text-brand">{carePlanSummary.actionLabel}</Link>
          <Link href={`/health/progress-notes?memberId=${member.id}`} className="font-semibold text-brand">Progress Notes</Link>
          <Link href={`/health/physician-orders?memberId=${member.id}`} className="font-semibold text-brand">Physician Orders</Link>
        </div>
        <div id="discharge-actions" className="mt-2 flex justify-center gap-2">
          <Link
            href={`/health/physician-orders/new?memberId=${member.id}`}
            className="inline-flex h-9 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-[#12357e]"
          >
            New POF
          </Link>
          <Link
            href={`/members/${member.id}/face-sheet?from=mhp`}
            className="inline-flex h-9 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-[#12357e]"
          >
            Face Sheet
          </Link>
          <Link
            href={`/members/${member.id}/name-badge?from=mhp`}
            className="inline-flex h-9 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-[#12357e]"
          >
            Generate Name Badge
          </Link>
          {canManageMemberStatus ? (
            <MemberStatusToggle memberId={member.id} memberName={member.display_name} status={member.status} />
          ) : null}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-6">
          <div className="rounded-lg border border-border p-3 text-center"><p className="text-xs text-muted">DOB</p><p className="font-semibold">{formatOptionalDate(member.dob)}</p></div>
          <div className="rounded-lg border border-border p-3 text-center"><p className="text-xs text-muted">Enrollment</p><p className="font-semibold">{formatOptionalDate(member.enrollment_date)}</p></div>
          <div className="rounded-lg border border-border p-3 text-center"><p className="text-xs text-muted">Code Status</p><p className="font-semibold" style={codeStatusStyle}>{codeStatusBanner}</p></div>
          <div className="rounded-lg border border-border p-3 text-center">
            <p className="text-xs text-muted">Next Care Plan Due</p>
            <p className="font-semibold">{carePlanSummary.nextDueDate ? formatDate(carePlanSummary.nextDueDate) : "-"}</p>
            <p className="text-xs text-muted">{carePlanSummary.status ?? "No enrollment date"}</p>
          </div>
          <div className="rounded-lg border border-border p-3 text-center">
            <p className="text-xs text-muted">Next Progress Note Due</p>
            <p className="font-semibold">{progressNoteSummary?.nextProgressNoteDueDate ? formatDate(progressNoteSummary.nextProgressNoteDueDate) : "-"}</p>
            <p className="text-xs text-muted">
              {progressNoteSummary?.dataIssue ?? (progressNoteSummary ? progressNoteSummary.complianceStatus.replaceAll("_", " ") : "No enrollment date")}
            </p>
          </div>
          <MhpTrackBannerEditor
            memberId={member.id}
            initialTrack={trackFromRecord}
            sourceText={trackSourceText}
            reviewHref={carePlanSummary.actionHref}
          />
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap gap-2">
          {MHP_TABS.map((item) => (
            <Link
              key={item}
              href={`/health/member-health-profiles/${member.id}?tab=${item}`}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${item === tab ? "border-brand bg-brand text-white" : "border-border text-primary-text"}`}
            >
              {TAB_LABELS[item]}
            </Link>
          ))}
        </div>
      </Card>

      {tab === "overview" ? (
        <div className="space-y-4">
          <Card>
            <SectionHeading title="Overview" lastUpdatedAt={profile.updated_at} lastUpdatedBy={profileUpdatedBy} />
            <MhpOverviewForm
              memberId={member.id}
              memberDob={member.dob ?? ""}
              genderDefault={genderDefault}
              billingPayorDisplay={formatBillingPayorDisplayName(billingPayor)}
              originalReferralSource={profile.original_referral_source ?? ""}
              photoConsent={profile.photo_consent}
              primaryCaregiverName={profile.primary_caregiver_name ?? ""}
              primaryCaregiverPhone={profile.primary_caregiver_phone ?? ""}
              responsiblePartyName={profile.responsible_party_name ?? ""}
              responsiblePartyPhone={profile.responsible_party_phone ?? ""}
              importantAlerts={profile.important_alerts ?? ""}
            />
          </Card>

          <Card className="table-wrap">
            <SectionHeading title="Related Care Plans" lastUpdatedAt={carePlansUpdatedAt} lastUpdatedBy={carePlansUpdatedBy} />
            <table className="mt-3">
              <thead><tr><th>Track</th><th>Review Date</th><th>Next Due</th><th>Status</th><th>Completed By</th><th>Open</th></tr></thead>
              <tbody>
                {relatedCarePlans.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-sm text-muted">No care plans found for this member yet.</td>
                  </tr>
                ) : (
                  relatedCarePlans.slice(0, 25).map((row) => (
                    <tr key={row.id}>
                      <td>{row.track}</td>
                      <td>{formatDate(row.reviewDate)}</td>
                      <td>{formatDate(row.nextDueDate)}</td>
                      <td>{row.status}</td>
                      <td>{row.completedBy ?? "-"}</td>
                      <td><Link className="font-semibold text-brand" href={`/health/care-plans/${row.id}`}>Open</Link></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>

          <Card className="table-wrap">
            <SectionHeading title="Related Intake Assessments" lastUpdatedAt={assessmentsUpdatedAt} lastUpdatedBy={assessmentsUpdatedBy} />
            <table className="mt-3">
              <thead><tr><th>Date</th><th>Score</th><th>Track</th><th>Completed By</th><th>Open</th></tr></thead>
              <tbody>
                {detail.assessments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-sm text-muted">No intake assessments found for this member yet.</td>
                  </tr>
                ) : (
                  detail.assessments.slice(0, 25).map((row) => (
                    <tr key={row.id}>
                      <td>{formatDate(row.assessment_date)}</td>
                      <td>{row.total_score}</td>
                      <td>{row.recommended_track}</td>
                      <td>{row.completed_by}</td>
                      <td><Link className="font-semibold text-brand" href={`/health/assessment/${row.id}`}>Open</Link></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>

          <Card className="table-wrap">
            <SectionHeading title="Related Physician Orders / POF" lastUpdatedAt={physicianOrdersUpdatedAt} lastUpdatedBy={physicianOrdersUpdatedBy} />
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href={`/health/physician-orders?memberId=${member.id}`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
                Open Member POF List
              </Link>
              <Link href={`/health/physician-orders/new?memberId=${member.id}`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
                New Physician Order
              </Link>
            </div>
            <table className="mt-3">
              <thead><tr><th>Status</th><th>Clinical Sync</th><th>Provider</th><th>Sent</th><th>Signed</th><th>Updated</th><th>Open</th></tr></thead>
              <tbody>
                {relatedPhysicianOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-sm text-muted">No physician orders found for this member yet.</td>
                  </tr>
                ) : (
                  relatedPhysicianOrders.slice(0, 25).map((row) => (
                    <tr key={row.id}>
                      <td>{row.status}</td>
                      <td>{clinicalSyncLabel(row.clinicalSyncStatus)}</td>
                      <td>{row.providerName ?? "-"}</td>
                      <td>{row.completedDate ? formatDate(row.completedDate) : "-"}</td>
                      <td>{row.signedDate ? formatDate(row.signedDate) : "-"}</td>
                      <td>{formatDateTime(row.updatedAt)}</td>
                      <td><Link className="font-semibold text-brand" href={`/health/physician-orders/${row.id}?from=mhp`}>Open</Link></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </div>
      ) : null}

      {tab === "medical" ? (
        <div className="space-y-4">
          <Card>
            <SectionHeading title="Diet & Allergies Profile" lastUpdatedAt={profile.updated_at} lastUpdatedBy={profileUpdatedBy} />
            <form action={saveMhpMedicalAction} className="mt-3 grid gap-3 md:grid-cols-2">
              <input type="hidden" name="memberId" value={member.id} />
              <MhpMedicalDietFields
                dietTypeDefault={dietTypeDefault}
                dietTypeOtherDefault={dietTypeOtherDefault}
                textureDefault={dietTextureDefault}
                dietTypeOptions={DIET_TYPE_OPTIONS}
                dietTextureOptions={DIET_TEXTURE_OPTIONS}
              />
              <Field label="Swallowing Difficulty" name="swallowingDifficulty" defaultValue={profile.swallowing_difficulty ?? ""} />
              <Field label="Supplements" name="supplements" defaultValue={profile.supplements ?? ""} />
              <Area label="Dietary Restrictions" name="dietaryRestrictions" defaultValue={profile.dietary_restrictions ?? ""} />
              <Area label="Foods to Omit" name="foodsToOmit" defaultValue={profile.foods_to_omit ?? ""} />
              <div className="md:col-span-2"><button type="submit" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">Save Medical Profile</button></div>
            </form>
          </Card>

          <Card className="table-wrap">
            <SectionHeading title="Diagnoses" lastUpdatedAt={diagnosesUpdatedAt} lastUpdatedBy={diagnosesUpdatedBy} />
            <MhpDiagnosesSection
              memberId={member.id}
              initialRows={detail.diagnoses.map((row) => ({
                id: row.id,
                diagnosis_type: row.diagnosis_type,
                diagnosis_name: row.diagnosis_name,
                date_added: row.date_added
              }))}
            />
          </Card>

          <Card className="table-wrap">
            <SectionHeading title="Providers" lastUpdatedAt={providersUpdatedAt} lastUpdatedBy={providersUpdatedBy} />
            <MhpProvidersSection
              memberId={member.id}
              providerDirectory={detail.providerDirectory.map((row) => ({
                id: row.id,
                provider_name: row.provider_name,
                specialty: row.specialty ?? null,
                specialty_other: row.specialty_other ?? null,
                practice_name: row.practice_name ?? null,
                provider_phone: row.provider_phone ?? null,
                updated_at: row.updated_at
              }))}
              initialRows={detail.providers.map((row) => ({
                id: row.id,
                provider_name: row.provider_name,
                specialty: row.specialty ?? null,
                practice_name: row.practice_name ?? null,
                provider_phone: row.provider_phone ?? null,
                updated_at: row.updated_at
              }))}
            />
          </Card>

          <Card className="table-wrap">
            <SectionHeading title="Active Medications" lastUpdatedAt={medicationsUpdatedAt} lastUpdatedBy={medicationsUpdatedBy} />
            <MhpMedicationsSection
              memberId={member.id}
              routeOptions={MEDICATION_ROUTE_OPTIONS}
              initialRows={detail.medications.map((row) => ({
                id: row.id,
                medication_name: row.medication_name,
                date_started: row.date_started ?? "",
                medication_status: row.medication_status,
                inactivated_at: row.inactivated_at ?? null,
                dose: row.dose ?? null,
                quantity: row.quantity ?? null,
                form: row.form ?? null,
                frequency: row.frequency ?? null,
                route: row.route ?? null,
                route_laterality: row.route_laterality ?? null,
                given_at_center: row.given_at_center ?? true,
                prn: row.prn ?? false,
                prn_instructions: row.prn_instructions ?? null,
                scheduled_times: Array.isArray(row.scheduled_times) ? row.scheduled_times : [],
                comments: row.comments ?? null,
                updated_at: row.updated_at
              }))}
            />
          </Card>

          <Card className="table-wrap">
            <SectionHeading title="Allergies" lastUpdatedAt={allergiesUpdatedAt} lastUpdatedBy={allergiesUpdatedBy} />
            <MhpAllergiesSection
              memberId={member.id}
              initialRows={detail.allergies.map((row) => ({
                id: row.id,
                allergy_group: row.allergy_group,
                allergy_name: row.allergy_name,
                severity: row.severity ?? null,
                comments: row.comments ?? null,
                updated_at: row.updated_at
              }))}
            />
          </Card>
        </div>
      ) : null}

      {tab === "functional" ? (
        <Card>
          <SectionHeading title="Functional (ADLs)" lastUpdatedAt={profile.updated_at} lastUpdatedBy={profileUpdatedBy} />
          <form action={saveMhpFunctionalAction} className="mt-3 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="memberId" value={member.id} />
            <SegmentedChoiceGroup
              label="Ambulation"
              name="ambulation"
              defaultValue={profile.ambulation ?? ""}
              options={MHP_AMBULATION_OPTIONS}
            />
            <SegmentedChoiceGroup
              label="Transferring"
              name="transferring"
              defaultValue={profile.transferring ?? ""}
              options={MHP_TRANSFER_SUPPORT_OPTIONS}
            />
            <SegmentedChoiceGroup
              label="Bathing"
              name="bathing"
              defaultValue={profile.bathing ?? ""}
              options={MHP_TRANSFER_SUPPORT_OPTIONS}
            />
            <SegmentedChoiceGroup
              label="Dressing"
              name="dressing"
              defaultValue={profile.dressing ?? ""}
              options={MHP_DRESSING_OPTIONS}
            />
            <SegmentedChoiceGroup
              label="Eating"
              name="eating"
              defaultValue={profile.eating ?? ""}
              options={MHP_TRANSFER_SUPPORT_OPTIONS}
            />
            <SegmentedChoiceGroup
              label="Bladder Continence"
              name="bladderContinence"
              defaultValue={profile.bladder_continence ?? ""}
              options={MHP_BLADDER_CONTINENCE_OPTIONS}
            />
            <SegmentedChoiceGroup
              label="Bowel Continence"
              name="bowelContinence"
              defaultValue={profile.bowel_continence ?? ""}
              options={MHP_BOWEL_CONTINENCE_OPTIONS}
            />
            <SegmentedChoiceGroup
              label="Toileting"
              name="toileting"
              defaultValue={profile.toileting ?? ""}
              options={MHP_TOILETING_OPTIONS}
            />
            <Field label="Toileting Needs" name="toiletingNeeds" defaultValue={profile.toileting_needs ?? ""} />
            <Area label="Toileting Comments" name="toiletingComments" defaultValue={profile.toileting_comments ?? ""} />
            <SegmentedChoiceGroup
              label="Hearing"
              name="hearing"
              defaultValue={profile.hearing ?? ""}
              options={MHP_HEARING_OPTIONS}
            />
            <SegmentedChoiceGroup
              label="Vision"
              name="vision"
              defaultValue={profile.vision ?? ""}
              options={MHP_VISION_OPTIONS}
            />
            <SegmentedChoiceGroup
              label="Dental"
              name="dental"
              defaultValue={profile.dental ?? ""}
              options={MHP_DENTAL_OPTIONS}
            />
            <SegmentedChoiceGroup
              label="Speech / Verbal Status"
              name="speechVerbalStatus"
              defaultValue={profile.speech_verbal_status ?? ""}
              options={MHP_SPEECH_STATUS_OPTIONS}
            />
            <Area label="Speech Comments" name="speechComments" defaultValue={profile.speech_comments ?? ""} />
            <Area label="Personal Appearance / Hygiene / Grooming" name="hygieneGrooming" defaultValue={profile.personal_appearance_hygiene_grooming ?? ""} />
            <SegmentedChoiceGroup
              label="May Self-Medicate"
              name="maySelfMedicate"
              defaultValue={profile.may_self_medicate == null ? "" : profile.may_self_medicate ? "true" : "false"}
              options={MHP_SELF_MEDICATE_OPTIONS}
            />
            <Field label="Medication Manager" name="medicationManagerName" defaultValue={profile.medication_manager_name ?? ""} />
            <div className="md:col-span-2"><button type="submit" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">Save Functional</button></div>
          </form>
        </Card>
      ) : null}

      {tab === "cognitive-behavioral" ? (
        <Card>
          <SectionHeading title="Cognitive / Behavioral" lastUpdatedAt={profile.updated_at} lastUpdatedBy={profileUpdatedBy} />
          <form action={saveMhpCognitiveBehaviorAction} className="mt-3 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="memberId" value={member.id} />
            <SegmentedChoiceGroup
              label="Orientation: DOB"
              name="orientationDob"
              defaultValue={orientationDefaultValue(profile.orientation_dob)}
              options={[
                { label: "Yes", value: "Yes" },
                { label: "No", value: "No" }
              ]}
            />
            <SegmentedChoiceGroup
              label="Orientation: Town/City"
              name="orientationCity"
              defaultValue={orientationDefaultValue(profile.orientation_city)}
              options={[
                { label: "Yes", value: "Yes" },
                { label: "No", value: "No" }
              ]}
            />
            <SegmentedChoiceGroup
              label="Orientation: Current Year"
              name="orientationCurrentYear"
              defaultValue={orientationDefaultValue(profile.orientation_current_year)}
              options={[
                { label: "Yes", value: "Yes" },
                { label: "No", value: "No" }
              ]}
            />
            <SegmentedChoiceGroup
              label="Orientation: Former Occupation"
              name="orientationFormerOccupation"
              defaultValue={orientationDefaultValue(profile.orientation_former_occupation)}
              options={[
                { label: "Yes", value: "Yes" },
                { label: "No", value: "No" }
              ]}
            />
            <Field label="Memory Impairment" name="memoryImpairment" defaultValue={profile.memory_impairment ?? ""} />
            <Field label="Memory Severity" name="memorySeverity" defaultValue={profile.memory_severity ?? ""} />
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Wandering</span>{boolSelect("wandering", profile.wandering)}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Combative/Disruptive</span>{boolSelect("combativeDisruptive", profile.combative_disruptive)}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Sleep Issues</span>{boolSelect("sleepIssues", profile.sleep_issues)}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Self-harm / Unsafe</span>{boolSelect("selfHarmUnsafe", profile.self_harm_unsafe)}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Impaired Judgement</span>{boolSelect("impairedJudgement", profile.impaired_judgement)}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Delirium</span>{boolSelect("delirium", profile.delirium)}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Disorientation</span>{boolSelect("disorientation", profile.disorientation)}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Agitation/Resistive</span>{boolSelect("agitationResistive", profile.agitation_resistive)}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Screaming/Loud Noises</span>{boolSelect("screamingLoudNoises", profile.screaming_loud_noises)}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Exhibitionism/Disrobing</span>{boolSelect("exhibitionismDisrobing", profile.exhibitionism_disrobing)}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Exit Seeking</span>{boolSelect("exitSeeking", profile.exit_seeking)}</label>
            <Area label="Comments" name="cognitiveBehaviorComments" defaultValue={profile.cognitive_behavior_comments ?? ""} />
            <div className="md:col-span-2"><button type="submit" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">Save Cognitive / Behavioral</button></div>
          </form>
        </Card>
      ) : null}

      {tab === "equipment" ? (
        <Card className="table-wrap">
          <SectionHeading title="Equipment" lastUpdatedAt={equipmentUpdatedAt ?? profile.updated_at} lastUpdatedBy={equipmentUpdatedBy ?? profileUpdatedBy} />
          <MhpEquipmentSection
            memberId={member.id}
            statusOptions={EQUIPMENT_STATUS_OPTIONS}
            initialRows={detail.equipment.map((row) => ({
              id: row.id,
              equipment_type: row.equipment_type,
              status: row.status ?? null,
              comments: row.comments ?? null,
              updated_at: row.updated_at
            }))}
          />
        </Card>
      ) : null}

      {tab === "legal" ? (
        <Card>
          <SectionHeading title="Legal" lastUpdatedAt={profile.updated_at} lastUpdatedBy={profileUpdatedBy} />
          <MhpLegalForm
            memberId={member.id}
            codeStatus={profile.code_status}
            dnr={profile.dnr}
            dni={profile.dni}
            polst={profile.polst_molst_colst}
            hospice={profile.hospice}
            advancedDirectivesObtained={profile.advanced_directives_obtained}
            powerOfAttorney={profile.power_of_attorney}
            hospitalPreferenceDirectory={detail.hospitalPreferenceDirectory.map((row) => ({
              id: row.id,
              hospital_name: row.hospital_name,
              updated_at: row.updated_at
            }))}
            hospitalPreference={profile.hospital_preference}
            legalComments={profile.legal_comments}
          />
        </Card>
      ) : null}

      {tab === "notes" ? (
        <Card className="table-wrap">
          <SectionHeading title="Notes" lastUpdatedAt={notesUpdatedAt ?? profile.updated_at} lastUpdatedBy={notesUpdatedBy ?? profileUpdatedBy} />
          <MhpNotesSection
            memberId={member.id}
            noteTypeOptions={NOTE_TYPE_OPTIONS}
              initialRows={detail.notes.map((row) => ({
                id: row.id,
                note_type: row.note_type,
                note_text: row.note_text,
                created_by_name: row.created_by_name ?? null,
                created_at: row.created_at,
                updated_at: row.updated_at
              }))}
            />
        </Card>
      ) : null}

    </div>
  );
}
