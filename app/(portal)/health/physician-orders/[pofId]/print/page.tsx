import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";

import { PhysicianOrderPdfActions } from "@/components/physician-orders/pof-pdf-actions";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { requireRoles } from "@/lib/auth";
import { POF_CENTER_ADDRESS, POF_CENTER_LOGO_PUBLIC_PATH, POF_CENTER_PHONE } from "@/lib/services/physician-order-config";
import { getPhysicianOrderById } from "@/lib/services/physician-orders";
import { toEasternISO } from "@/lib/timezone";
import { formatDate, formatDateTime, formatOptionalDate } from "@/lib/utils";

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function selectedList(values: Array<{ label: string; value: boolean }>) {
  const selected = values.filter((entry) => entry.value).map((entry) => entry.label);
  return selected.length > 0 ? selected.join(", ") : "-";
}

export default async function PhysicianOrderPrintPage({
  params
}: {
  params: Promise<{ pofId: string }>;
}) {
  await requireRoles(["admin", "nurse"]);
  const { pofId } = await params;
  const form = getPhysicianOrderById(pofId);
  if (!form) notFound();

  const care = form.careInformation;
  const flags = form.operationalFlags;
  const generatedAt = toEasternISO();

  return (
    <div className="space-y-4">
      <div className="print-hide flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BackArrowButton fallbackHref={`/health/physician-orders/${form.id}`} forceFallback ariaLabel="Back to physician order detail" />
          <Link href={`/health/physician-orders/${form.id}`} className="text-sm font-semibold text-brand">
            Back to Physician Order
          </Link>
        </div>
        <PhysicianOrderPdfActions pofId={form.id} />
      </div>

      <div className="rounded-lg border border-border bg-white p-4">
        <header className="border-b border-black/20 pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Image src={POF_CENTER_LOGO_PUBLIC_PATH} alt="Town Square logo" width={120} height={38} priority />
              <div>
                <p className="text-sm font-semibold">Town Square Fort Mill</p>
                <p className="text-xs">{POF_CENTER_ADDRESS}</p>
                <p className="text-xs">{POF_CENTER_PHONE}</p>
              </div>
            </div>
            <div>
              <p className="text-xl font-bold uppercase tracking-wide">Physician Order & Physical Exam Form</p>
            </div>
            <div className="text-right text-xs">
              <p>Generated: {formatDateTime(generatedAt)} (ET)</p>
            </div>
          </div>
        </header>

        <section className="mt-3">
          <h2 className="text-sm font-bold uppercase tracking-wide">Page 1 - Identification / Medical Orders</h2>
          <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <p><span className="font-semibold">Member:</span> {form.memberNameSnapshot}</p>
            <p><span className="font-semibold">DOB:</span> {formatOptionalDate(form.memberDobSnapshot)}</p>
            <p><span className="font-semibold">Sex:</span> {form.sex ?? "-"}</p>
            <p><span className="font-semibold">Level of Care:</span> {form.levelOfCare ?? "-"}</p>
            <p><span className="font-semibold">DNR Selected:</span> {yesNo(form.dnrSelected)}</p>
            <p><span className="font-semibold">Status:</span> {form.status}</p>
            <p><span className="font-semibold">Provider Signature Status:</span> {form.providerSignatureStatus}</p>
            <p><span className="font-semibold">Completed:</span> {form.completedDate ? formatDate(form.completedDate) : "-"}</p>
          </div>

          <div className="mt-2 grid gap-1 text-sm sm:grid-cols-4">
            <p><span className="font-semibold">BP:</span> {form.vitalsBloodPressure ?? "-"}</p>
            <p><span className="font-semibold">Pulse:</span> {form.vitalsPulse ?? "-"}</p>
          <p><span className="font-semibold">O2 %:</span> {form.vitalsOxygenSaturation ?? "-"}</p>
            <p><span className="font-semibold">Respiration:</span> {form.vitalsRespiration ?? "-"}</p>
          </div>

          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="font-semibold">Diagnoses</p>
              <table className="mt-1">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Diagnosis</th>
                    <th>Code</th>
                  </tr>
                </thead>
                <tbody>
                  {form.diagnosisRows.length === 0 ? (
                    <tr><td colSpan={3}>-</td></tr>
                  ) : (
                    form.diagnosisRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.diagnosisType}</td>
                        <td>{row.diagnosisName}</td>
                        <td>{row.diagnosisCode ?? "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div>
              <p className="font-semibold">Allergies</p>
              <table className="mt-1">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Allergy</th>
                    <th>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {form.allergyRows.length === 0 ? (
                    <tr><td colSpan={3}>-</td></tr>
                  ) : (
                    form.allergyRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.allergyGroup}</td>
                        <td>{row.allergyName}</td>
                        <td>{row.severity ?? "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="table-wrap mt-3">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Dose</th>
                  <th>Qty</th>
                  <th>Form</th>
                  <th>Route</th>
                  <th>Frequency</th>
                </tr>
              </thead>
              <tbody>
                {form.medications.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No medications entered.</td>
                  </tr>
                ) : (
                  form.medications.map((medication) => (
                    <tr key={medication.id}>
                      <td>{medication.name}</td>
                      <td>{medication.dose ?? "-"}</td>
                      <td>{medication.quantity ?? "-"}</td>
                      <td>{medication.form ?? "-"}</td>
                      <td>{medication.routeLaterality ? `${medication.route ?? "-"} (${medication.routeLaterality})` : medication.route ?? "-"}</td>
                      <td>{medication.frequency ?? "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-sm">
            <p className="font-semibold">Standing Orders (as needed medications at center)</p>
            {form.standingOrders.length === 0 ? (
              <p className="text-muted">No standing orders selected.</p>
            ) : (
              <ul className="list-disc pl-5">
                {form.standingOrders.map((order, idx) => (
                  <li key={`${order}-${idx}`}>{order}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="mt-4 border-t border-black/20 pt-3">
          <h2 className="text-sm font-bold uppercase tracking-wide">Page 2 - Member Care Information</h2>
          <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            <p><span className="font-semibold">Disoriented:</span> {selectedList([{ label: "Constantly", value: care.disorientedConstantly }, { label: "Intermittently", value: care.disorientedIntermittently }])}</p>
            <p><span className="font-semibold">Inappropriate Behavior:</span> {selectedList([{ label: "Wanderer", value: care.inappropriateBehaviorWanderer }, { label: "Verbal Aggression", value: care.inappropriateBehaviorVerbalAggression }, { label: "Aggression", value: care.inappropriateBehaviorAggression }])}</p>
            <p><span className="font-semibold">Personal Care Assistance:</span> {selectedList([{ label: "Bathing", value: care.personalCareBathing }, { label: "Feeding", value: care.personalCareFeeding }, { label: "Dressing", value: care.personalCareDressing }, { label: "Medication", value: care.personalCareMedication }, { label: "Toileting", value: care.personalCareToileting }])}</p>
            <p><span className="font-semibold">Ambulatory Status:</span> {care.ambulatoryStatus ?? "-"}</p>
            <p><span className="font-semibold">Mobility:</span> {selectedList([{ label: "Independent", value: care.mobilityIndependent }, { label: "Walker", value: care.mobilityWalker }, { label: "Wheelchair", value: care.mobilityWheelchair }, { label: "Scooter", value: care.mobilityScooter }, { label: "Other", value: care.mobilityOther }])}{care.mobilityOtherText ? ` (${care.mobilityOtherText})` : ""}</p>
            <p><span className="font-semibold">Functional Limitations:</span> {selectedList([{ label: "Sight", value: care.functionalLimitationSight }, { label: "Hearing", value: care.functionalLimitationHearing }, { label: "Speech", value: care.functionalLimitationSpeech }])}</p>
            <p><span className="font-semibold">Activities / Social:</span> {selectedList([{ label: "Passive", value: care.activitiesPassive }, { label: "Active", value: care.activitiesActive }, { label: "Group Participation", value: care.activitiesGroupParticipation }, { label: "Prefers alone time", value: care.activitiesPrefersAlone }])}</p>
            <p><span className="font-semibold">Neurological:</span> {care.neurologicalConvulsionsSeizures ? "Convulsions / seizures" : "-"}</p>
            <p><span className="font-semibold">Stimulation:</span> {selectedList([{ label: "Afraid of loud noises", value: care.stimulationAfraidLoudNoises }, { label: "Easily overwhelmed", value: care.stimulationEasilyOverwhelmed }, { label: "Adapts easily", value: care.stimulationAdaptsEasily }])}</p>
            <p><span className="font-semibold">Medication Administration:</span> {selectedList([{ label: "Self administration", value: care.medAdministrationSelf }, { label: "Nurse administration", value: care.medAdministrationNurse }])}</p>
            <p><span className="font-semibold">Bladder:</span> {selectedList([{ label: "Continent", value: care.bladderContinent }, { label: "Incontinent", value: care.bladderIncontinent }])}</p>
            <p><span className="font-semibold">Bowel:</span> {selectedList([{ label: "Continent", value: care.bowelContinent }, { label: "Incontinent", value: care.bowelIncontinent }])}</p>
            <p><span className="font-semibold">Skin:</span> {care.skinNormal ? "Normal" : "Other"}{care.skinOther ? ` (${care.skinOther})` : ""}</p>
            <p><span className="font-semibold">Breathing:</span> {selectedList([{ label: "Room Air", value: care.breathingRoomAir }, { label: "Oxygen tank", value: care.breathingOxygenTank }])}{care.breathingOxygenLiters ? ` (${care.breathingOxygenLiters}L)` : ""}</p>
            <p className="sm:col-span-2"><span className="font-semibold">Nutrition / Diet:</span> {care.nutritionDiets.length > 0 ? care.nutritionDiets.join(", ") : "-"}{care.nutritionDietOther ? ` | Other: ${care.nutritionDietOther}` : ""}</p>
            <p className="sm:col-span-2"><span className="font-semibold">Additional information to help spark joy:</span> {care.joySparksNotes ?? "-"}</p>
          </div>
        </section>

        <section className="mt-4 border-t border-black/20 pt-3">
          <h2 className="text-sm font-bold uppercase tracking-wide">Page 3 - Signature / Audit</h2>
          <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            <p><span className="font-semibold">Operational Flags:</span> {selectedList([{ label: "Nut allergy", value: flags.nutAllergy }, { label: "Shellfish allergy", value: flags.shellfishAllergy }, { label: "Fish allergy", value: flags.fishAllergy }, { label: "Diabetic / Restricted Sweets", value: flags.diabeticRestrictedSweets }, { label: "Oxygen requirement", value: flags.oxygenRequirement }, { label: "DNR", value: flags.dnr }, { label: "No photos", value: flags.noPhotos }, { label: "Bathroom assistance", value: flags.bathroomAssistance }])}</p>
            <p><span className="font-semibold">Provider Name:</span> {form.providerName ?? "-"}</p>
            <p><span className="font-semibold">Provider Signature:</span> {form.providerSignature ?? "-"}</p>
            <p><span className="font-semibold">Provider Signature Date:</span> {form.providerSignatureDate ? formatDate(form.providerSignatureDate) : "-"}</p>
            <p><span className="font-semibold">Created By:</span> {form.createdByName}</p>
            <p><span className="font-semibold">Created Date:</span> {formatDateTime(form.createdAt)}</p>
            <p><span className="font-semibold">Completed By:</span> {form.completedByName ?? "-"}</p>
            <p><span className="font-semibold">Completed Date:</span> {form.completedDate ? formatDate(form.completedDate) : "-"}</p>
            <p><span className="font-semibold">Signed By:</span> {form.signedBy ?? "-"}</p>
            <p><span className="font-semibold">Signed Date:</span> {form.signedDate ? formatDate(form.signedDate) : "-"}</p>
            <p><span className="font-semibold">Last Updated By:</span> {form.updatedByName ?? "-"}</p>
            <p><span className="font-semibold">Last Updated At:</span> {formatDateTime(form.updatedAt)}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
