import Link from "next/link";
import { notFound } from "next/navigation";

import { PhysicianOrderPdfActions } from "@/components/physician-orders/pof-pdf-actions";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import {
  getPhysicianOrderById,
  getPhysicianOrdersForMember
} from "@/lib/services/physician-orders";
import { formatDate, formatDateTime, formatOptionalDate } from "@/lib/utils";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function selectedList(values: Array<{ label: string; value: boolean }>) {
  const selected = values.filter((entry) => entry.value).map((entry) => entry.label);
  return selected.length > 0 ? selected.join(", ") : "-";
}

export default async function PhysicianOrderDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ pofId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireRoles(["admin", "nurse"]);
  const canEdit = profile.role === "admin" || profile.role === "nurse";
  const { pofId } = await params;
  const query = await searchParams;
  const source = firstString(query.from);

  const form = getPhysicianOrderById(pofId);
  if (!form) notFound();

  const history = getPhysicianOrdersForMember(form.memberId);
  const backHref =
    source === "mhp"
      ? `/health/member-health-profiles/${form.memberId}`
      : source === "mcc"
        ? `/operations/member-command-center/${form.memberId}`
        : `/health/physician-orders?memberId=${form.memberId}`;

  const care = form.careInformation;
  const flags = form.operationalFlags;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <BackArrowButton fallbackHref={backHref} forceFallback ariaLabel="Back to physician orders" />
          <CardTitle>Physician Order Form</CardTitle>
        </div>
        <p className="mt-1 text-sm text-muted">
          Member: <span className="font-semibold">{form.memberNameSnapshot}</span> | DOB: {formatOptionalDate(form.memberDobSnapshot)}
        </p>
        <div className="mt-2 grid gap-2 text-xs text-muted sm:grid-cols-2 lg:grid-cols-4">
          <p>Status: <span className="font-semibold text-primary-text">{form.status}</span></p>
          <p>Provider Signature Status: <span className="font-semibold text-primary-text">{form.providerSignatureStatus}</span></p>
          <p>Completed: <span className="font-semibold text-primary-text">{form.completedDate ? formatDate(form.completedDate) : "-"}</span></p>
          <p>Signed: <span className="font-semibold text-primary-text">{form.signedDate ? formatDate(form.signedDate) : "-"}</span></p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {canEdit ? (
            <Link href={`/health/physician-orders/new?pofId=${form.id}`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
              Edit / Update Form
            </Link>
          ) : null}
          <Link href={`/health/physician-orders/${form.id}/print`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
            Print-Friendly View
          </Link>
          {canEdit ? (
            <Link href={`/health/physician-orders/new?memberId=${form.memberId}`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
              New Order for Member
            </Link>
          ) : null}
        </div>
        <div className="mt-3">
          <PhysicianOrderPdfActions pofId={form.id} />
        </div>
      </Card>

      <Card>
        <CardTitle>Identification / Medical Orders</CardTitle>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
          <p><span className="font-semibold">Sex:</span> {form.sex ?? "-"}</p>
          <p><span className="font-semibold">Level of Care:</span> {form.levelOfCare ?? "-"}</p>
          <p><span className="font-semibold">DNR Selected:</span> {yesNo(form.dnrSelected)}</p>
        </div>

        <div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
          <p><span className="font-semibold">BP:</span> {form.vitalsBloodPressure ?? "-"}</p>
          <p><span className="font-semibold">Pulse:</span> {form.vitalsPulse ?? "-"}</p>
          <p><span className="font-semibold">O2 %:</span> {form.vitalsOxygenSaturation ?? "-"}</p>
          <p><span className="font-semibold">Respiration:</span> {form.vitalsRespiration ?? "-"}</p>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-sm font-semibold">Diagnoses</p>
            {form.diagnoses.length === 0 ? (
              <p className="text-sm text-muted">No diagnoses entered.</p>
            ) : (
              <ol className="list-decimal pl-5 text-sm">
                {form.diagnoses.map((diagnosis, idx) => (
                  <li key={`${diagnosis}-${idx}`}>{diagnosis}</li>
                ))}
              </ol>
            )}
          </div>
          <div>
            <p className="text-sm font-semibold">Allergies</p>
            {form.allergies.length === 0 ? (
              <p className="text-sm text-muted">No allergies entered.</p>
            ) : (
              <ul className="list-disc pl-5 text-sm">
                {form.allergies.map((allergy, idx) => (
                  <li key={`${allergy}-${idx}`}>{allergy}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-3 table-wrap">
          <p className="mb-2 text-sm font-semibold">Medications</p>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Dose</th>
                <th>Route</th>
                <th>Frequency</th>
              </tr>
            </thead>
            <tbody>
              {form.medications.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-sm text-muted">
                    No medications entered.
                  </td>
                </tr>
              ) : (
                form.medications.map((medication) => (
                  <tr key={medication.id}>
                    <td>{medication.name}</td>
                    <td>{medication.dose ?? "-"}</td>
                    <td>{medication.route ?? "-"}</td>
                    <td>{medication.frequency ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3">
          <p className="text-sm font-semibold">Standing Orders</p>
          <ul className="list-disc pl-5 text-sm">
            {form.standingOrders.map((order, idx) => (
              <li key={`${order}-${idx}`}>{order}</li>
            ))}
          </ul>
        </div>
      </Card>

      <Card>
        <CardTitle>Member Care Information</CardTitle>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          <p><span className="font-semibold">Disoriented:</span> {selectedList([{ label: "Constantly", value: care.disorientedConstantly }, { label: "Intermittently", value: care.disorientedIntermittently }])}</p>
          <p><span className="font-semibold">Inappropriate Behavior:</span> {selectedList([{ label: "Wanderer", value: care.inappropriateBehaviorWanderer }, { label: "Verbal Aggression", value: care.inappropriateBehaviorVerbalAggression }, { label: "Aggression", value: care.inappropriateBehaviorAggression }])}</p>
          <p><span className="font-semibold">Personal Care Assistance:</span> {selectedList([{ label: "Bathing", value: care.personalCareBathing }, { label: "Feeding", value: care.personalCareFeeding }, { label: "Dressing", value: care.personalCareDressing }, { label: "Medication", value: care.personalCareMedication }, { label: "Toileting", value: care.personalCareToileting }])}</p>
          <p><span className="font-semibold">Ambulatory Status:</span> {care.ambulatoryStatus ?? "-"}</p>
          <p><span className="font-semibold">Mobility:</span> {selectedList([{ label: "Independent", value: care.mobilityIndependent }, { label: "Walker", value: care.mobilityWalker }, { label: "Wheelchair", value: care.mobilityWheelchair }, { label: "Scooter", value: care.mobilityScooter }, { label: "Other", value: care.mobilityOther }])}{care.mobilityOtherText ? ` (${care.mobilityOtherText})` : ""}</p>
          <p><span className="font-semibold">Functional Limitations:</span> {selectedList([{ label: "Sight", value: care.functionalLimitationSight }, { label: "Hearing", value: care.functionalLimitationHearing }, { label: "Speech", value: care.functionalLimitationSpeech }])}</p>
          <p><span className="font-semibold">Activities / Social:</span> {selectedList([{ label: "Passive", value: care.activitiesPassive }, { label: "Active", value: care.activitiesActive }, { label: "Group Participation", value: care.activitiesGroupParticipation }, { label: "Prefers Alone Time", value: care.activitiesPrefersAlone }])}</p>
          <p><span className="font-semibold">Neurological:</span> {care.neurologicalConvulsionsSeizures ? "Convulsions / Seizures" : "-"}</p>
          <p><span className="font-semibold">Stimulation:</span> {selectedList([{ label: "Afraid of loud noises", value: care.stimulationAfraidLoudNoises }, { label: "Easily overwhelmed", value: care.stimulationEasilyOverwhelmed }, { label: "Adapts easily", value: care.stimulationAdaptsEasily }])}</p>
          <p><span className="font-semibold">Medication Administration:</span> {selectedList([{ label: "Self administration", value: care.medAdministrationSelf }, { label: "Nurse administration", value: care.medAdministrationNurse }])}</p>
          <p><span className="font-semibold">Bladder:</span> {selectedList([{ label: "Continent", value: care.bladderContinent }, { label: "Incontinent", value: care.bladderIncontinent }])}</p>
          <p><span className="font-semibold">Bowel:</span> {selectedList([{ label: "Continent", value: care.bowelContinent }, { label: "Incontinent", value: care.bowelIncontinent }])}</p>
          <p><span className="font-semibold">Skin:</span> {care.skinNormal ? "Normal" : "Other"}{care.skinOther ? ` (${care.skinOther})` : ""}</p>
          <p><span className="font-semibold">Breathing:</span> {selectedList([{ label: "Room Air", value: care.breathingRoomAir }, { label: "Oxygen tank", value: care.breathingOxygenTank }])}{care.breathingOxygenLiters ? ` (${care.breathingOxygenLiters}L)` : ""}</p>
          <p className="md:col-span-2"><span className="font-semibold">Nutrition / Diet:</span> {care.nutritionDiets.length > 0 ? care.nutritionDiets.join(", ") : "-"}{care.nutritionDietOther ? ` | Other: ${care.nutritionDietOther}` : ""}</p>
          <p className="md:col-span-2"><span className="font-semibold">Additional Information to Help Spark Joy:</span> {care.joySparksNotes ?? "-"}</p>
        </div>
      </Card>

      <Card>
        <CardTitle>Operational Flags & Signature Tracking</CardTitle>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <p><span className="font-semibold">Operational Flags:</span> {selectedList([{ label: "Nut allergy", value: flags.nutAllergy }, { label: "Shellfish allergy", value: flags.shellfishAllergy }, { label: "Fish allergy", value: flags.fishAllergy }, { label: "Diabetic / Restricted Sweets", value: flags.diabeticRestrictedSweets }, { label: "Oxygen requirement", value: flags.oxygenRequirement }, { label: "DNR", value: flags.dnr }, { label: "No photos", value: flags.noPhotos }, { label: "Bathroom assistance", value: flags.bathroomAssistance }])}</p>
          <p><span className="font-semibold">Provider Name:</span> {form.providerName ?? "-"}</p>
          <p><span className="font-semibold">Provider Signature:</span> {form.providerSignature ?? "-"}</p>
          <p><span className="font-semibold">Provider Signature Date:</span> {form.providerSignatureDate ? formatDate(form.providerSignatureDate) : "-"}</p>
          <p><span className="font-semibold">Created By:</span> {form.createdByName}</p>
          <p><span className="font-semibold">Created At:</span> {formatDateTime(form.createdAt)}</p>
          <p><span className="font-semibold">Completed By:</span> {form.completedByName ?? "-"}</p>
          <p><span className="font-semibold">Completed Date:</span> {form.completedDate ? formatDate(form.completedDate) : "-"}</p>
          <p><span className="font-semibold">Signed By:</span> {form.signedBy ?? "-"}</p>
          <p><span className="font-semibold">Signed Date:</span> {form.signedDate ? formatDate(form.signedDate) : "-"}</p>
          <p><span className="font-semibold">Last Updated By:</span> {form.updatedByName ?? "-"}</p>
          <p><span className="font-semibold">Last Updated At:</span> {formatDateTime(form.updatedAt)}</p>
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Member POF History</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Status</th>
              <th>Provider</th>
              <th>Completed</th>
              <th>Signed</th>
              <th>Updated</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => (
              <tr key={row.id}>
                <td>{row.status}</td>
                <td>{row.providerName ?? "-"}</td>
                <td>{row.completedDate ? formatDate(row.completedDate) : "-"}</td>
                <td>{row.signedDate ? formatDate(row.signedDate) : "-"}</td>
                <td>{formatDateTime(row.updatedAt)}</td>
                <td>
                  <Link href={`/health/physician-orders/${row.id}`} className="font-semibold text-brand">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
