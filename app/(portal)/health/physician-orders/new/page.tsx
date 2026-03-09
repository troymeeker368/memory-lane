import { notFound } from "next/navigation";

import { savePhysicianOrderFormAction } from "@/app/(portal)/health/physician-orders/actions";
import { PofMedicationsEditor } from "@/components/forms/pof-medications-editor";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { getCurrentProfile, requireRoles } from "@/lib/auth";
import { getMockDb } from "@/lib/mock-repo";
import {
  POF_LEVEL_OF_CARE_OPTIONS,
  POF_NUTRITION_OPTIONS,
  buildNewPhysicianOrderDraft,
  getPhysicianOrderById
} from "@/lib/services/physician-orders";
import { formatDateTime, formatOptionalDate } from "@/lib/utils";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function CheckboxField({
  name,
  label,
  defaultChecked
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  );
}

export default async function NewPhysicianOrderPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoles(["admin", "nurse"]);
  const profile = await getCurrentProfile();
  const query = await searchParams;
  const memberId = firstString(query.memberId) ?? "";
  const pofId = firstString(query.pofId) ?? "";

  const db = getMockDb();
  const members = db.members
    .filter((row) => row.status === "active")
    .sort((left, right) => left.display_name.localeCompare(right.display_name, undefined, { sensitivity: "base" }));

  if (!memberId && !pofId) {
    return (
      <div className="space-y-4">
        <Card>
          <div className="flex items-center gap-2">
            <BackArrowButton fallbackHref="/health/physician-orders" forceFallback ariaLabel="Back to physician orders list" />
            <CardTitle>Select Member for New Physician Order</CardTitle>
          </div>
          <form action="/health/physician-orders/new" className="mt-3 flex flex-wrap items-center gap-2">
            <select name="memberId" className="h-10 min-w-[280px] rounded-lg border border-border px-3 text-sm" required>
              <option value="">Select member</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.display_name}
                </option>
              ))}
            </select>
            <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
              Start POF
            </button>
          </form>
        </Card>
      </div>
    );
  }

  const editing = pofId ? getPhysicianOrderById(pofId) : null;
  const draft = editing ?? (memberId ? buildNewPhysicianOrderDraft({ memberId, actor: { id: profile.id, fullName: profile.full_name } }) : null);
  if (!draft) notFound();

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <BackArrowButton fallbackHref="/health/physician-orders" forceFallback ariaLabel="Back to physician orders list" />
          <CardTitle>{editing ? "Review / Update Physician Order" : "New Physician Order"}</CardTitle>
        </div>
        <p className="mt-1 text-sm text-muted">
          Member: <span className="font-semibold">{draft.memberNameSnapshot}</span> | DOB: {formatOptionalDate(draft.memberDobSnapshot)}
        </p>
        {editing ? (
          <p className="mt-1 text-xs text-muted">
            Status: {editing.status} | Created by {editing.createdByName} on {formatDateTime(editing.createdAt)}
          </p>
        ) : null}
      </Card>

      <form action={savePhysicianOrderFormAction} className="space-y-4">
        <input type="hidden" name="memberId" value={draft.memberId} />
        <input type="hidden" name="pofId" value={editing?.id ?? ""} />

        <Card>
          <CardTitle>Identification / Medical Orders</CardTitle>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Sex</span>
              <select name="sex" defaultValue={draft.sex ?? ""} className="h-10 w-full rounded-lg border border-border px-3">
                <option value="">Not set</option>
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Current Level of Care</span>
              <select name="levelOfCare" defaultValue={draft.levelOfCare ?? ""} className="h-10 w-full rounded-lg border border-border px-3">
                <option value="">Select level</option>
                {POF_LEVEL_OF_CARE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="dnrSelected" defaultChecked={draft.dnrSelected} />
              <span>Select if DNR</span>
            </label>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">BP</span>
              <input name="vitalsBloodPressure" defaultValue={draft.vitalsBloodPressure ?? ""} className="h-10 w-full rounded-lg border border-border px-3" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Pulse</span>
              <input name="vitalsPulse" defaultValue={draft.vitalsPulse ?? ""} className="h-10 w-full rounded-lg border border-border px-3" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">O2 %</span>
              <input name="vitalsOxygenSaturation" defaultValue={draft.vitalsOxygenSaturation ?? ""} className="h-10 w-full rounded-lg border border-border px-3" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Respiration</span>
              <input name="vitalsRespiration" defaultValue={draft.vitalsRespiration ?? ""} className="h-10 w-full rounded-lg border border-border px-3" />
            </label>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Diagnoses (one per line)</span>
              <textarea name="diagnosesText" defaultValue={draft.diagnoses.join("\n")} className="min-h-24 w-full rounded-lg border border-border p-3 text-sm" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Allergies (one per line)</span>
              <textarea name="allergiesText" defaultValue={draft.allergies.join("\n")} className="min-h-24 w-full rounded-lg border border-border p-3 text-sm" />
            </label>
          </div>

          <div className="mt-3">
            <p className="text-sm font-semibold">Medications</p>
            <PofMedicationsEditor initialRows={draft.medications} />
          </div>

          <div className="mt-3 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">Standing Orders (Included)</p>
            <ul className="mt-2 list-disc pl-5 text-sm text-muted">
              {draft.standingOrders.map((order) => (
                <li key={order}>{order}</li>
              ))}
            </ul>
          </div>
        </Card>

        <Card>
          <CardTitle>Member Care Information</CardTitle>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-semibold">Disoriented</p>
              <CheckboxField name="disorientedConstantly" label="Constantly" defaultChecked={draft.careInformation.disorientedConstantly} />
              <CheckboxField name="disorientedIntermittently" label="Intermittently" defaultChecked={draft.careInformation.disorientedIntermittently} />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Inappropriate Behavior</p>
              <CheckboxField name="inappropriateBehaviorWanderer" label="Wanderer" defaultChecked={draft.careInformation.inappropriateBehaviorWanderer} />
              <CheckboxField name="inappropriateBehaviorVerbalAggression" label="Verbal Aggression" defaultChecked={draft.careInformation.inappropriateBehaviorVerbalAggression} />
              <CheckboxField name="inappropriateBehaviorAggression" label="Aggression" defaultChecked={draft.careInformation.inappropriateBehaviorAggression} />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Personal Care Assistance</p>
              <CheckboxField name="personalCareBathing" label="Bathing" defaultChecked={draft.careInformation.personalCareBathing} />
              <CheckboxField name="personalCareFeeding" label="Feeding" defaultChecked={draft.careInformation.personalCareFeeding} />
              <CheckboxField name="personalCareDressing" label="Dressing" defaultChecked={draft.careInformation.personalCareDressing} />
              <CheckboxField name="personalCareMedication" label="Medication" defaultChecked={draft.careInformation.personalCareMedication} />
              <CheckboxField name="personalCareToileting" label="Toileting" defaultChecked={draft.careInformation.personalCareToileting} />
            </div>
            <div className="space-y-2">
              <label className="space-y-1 text-sm">
                <span className="text-xs font-semibold text-muted">Ambulatory Status</span>
                <select name="ambulatoryStatus" defaultValue={draft.careInformation.ambulatoryStatus ?? ""} className="h-10 w-full rounded-lg border border-border px-3">
                  <option value="">Not set</option>
                  <option value="Full">Full</option>
                  <option value="Semi">Semi</option>
                  <option value="Non">Non</option>
                </select>
              </label>
              <p className="text-sm font-semibold">Mobility</p>
              <CheckboxField name="mobilityIndependent" label="Independent" defaultChecked={draft.careInformation.mobilityIndependent} />
              <CheckboxField name="mobilityWalker" label="Walker" defaultChecked={draft.careInformation.mobilityWalker} />
              <CheckboxField name="mobilityWheelchair" label="Wheelchair" defaultChecked={draft.careInformation.mobilityWheelchair} />
              <CheckboxField name="mobilityScooter" label="Scooter" defaultChecked={draft.careInformation.mobilityScooter} />
              <CheckboxField name="mobilityOther" label="Other" defaultChecked={draft.careInformation.mobilityOther} />
              <input name="mobilityOtherText" defaultValue={draft.careInformation.mobilityOtherText ?? ""} placeholder="Mobility other detail" className="h-10 w-full rounded-lg border border-border px-3 text-sm" />
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-semibold">Functional Limitations</p>
              <CheckboxField name="functionalLimitationSight" label="Sight" defaultChecked={draft.careInformation.functionalLimitationSight} />
              <CheckboxField name="functionalLimitationHearing" label="Hearing" defaultChecked={draft.careInformation.functionalLimitationHearing} />
              <CheckboxField name="functionalLimitationSpeech" label="Speech" defaultChecked={draft.careInformation.functionalLimitationSpeech} />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Activities / Social</p>
              <CheckboxField name="activitiesPassive" label="Passive" defaultChecked={draft.careInformation.activitiesPassive} />
              <CheckboxField name="activitiesActive" label="Active" defaultChecked={draft.careInformation.activitiesActive} />
              <CheckboxField name="activitiesGroupParticipation" label="Group Participation" defaultChecked={draft.careInformation.activitiesGroupParticipation} />
              <CheckboxField name="activitiesPrefersAlone" label="Prefers alone time" defaultChecked={draft.careInformation.activitiesPrefersAlone} />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Stimulation</p>
              <CheckboxField name="stimulationAfraidLoudNoises" label="Afraid of loud noises" defaultChecked={draft.careInformation.stimulationAfraidLoudNoises} />
              <CheckboxField name="stimulationEasilyOverwhelmed" label="Easily overwhelmed" defaultChecked={draft.careInformation.stimulationEasilyOverwhelmed} />
              <CheckboxField name="stimulationAdaptsEasily" label="Adapts easily" defaultChecked={draft.careInformation.stimulationAdaptsEasily} />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Medication Administration</p>
              <CheckboxField name="medAdministrationSelf" label="Self administration" defaultChecked={draft.careInformation.medAdministrationSelf} />
              <CheckboxField name="medAdministrationNurse" label="Nurse administration" defaultChecked={draft.careInformation.medAdministrationNurse} />
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <CheckboxField name="bladderContinent" label="Bladder Continent" defaultChecked={draft.careInformation.bladderContinent} />
            <CheckboxField name="bladderIncontinent" label="Bladder Incontinent" defaultChecked={draft.careInformation.bladderIncontinent} />
            <CheckboxField name="bowelContinent" label="Bowel Continent" defaultChecked={draft.careInformation.bowelContinent} />
            <CheckboxField name="bowelIncontinent" label="Bowel Incontinent" defaultChecked={draft.careInformation.bowelIncontinent} />
            <CheckboxField name="skinNormal" label="Skin Normal" defaultChecked={draft.careInformation.skinNormal} />
            <input name="skinOther" defaultValue={draft.careInformation.skinOther ?? ""} placeholder="Skin other" className="h-10 rounded-lg border border-border px-3 text-sm" />
            <CheckboxField name="breathingRoomAir" label="Room Air" defaultChecked={draft.careInformation.breathingRoomAir} />
            <CheckboxField name="breathingOxygenTank" label="Oxygen Tank" defaultChecked={draft.careInformation.breathingOxygenTank} />
            <input name="breathingOxygenLiters" defaultValue={draft.careInformation.breathingOxygenLiters ?? ""} placeholder="Oxygen liters (L)" className="h-10 rounded-lg border border-border px-3 text-sm" />
            <CheckboxField name="neurologicalConvulsionsSeizures" label="Convulsions/Seizures" defaultChecked={draft.careInformation.neurologicalConvulsionsSeizures} />
          </div>

          <div className="mt-4">
            <p className="text-sm font-semibold">Nutrition / Diet</p>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              {POF_NUTRITION_OPTIONS.map((option) => (
                <CheckboxField
                  key={option}
                  name="nutritionDiet"
                  label={option}
                  defaultChecked={draft.careInformation.nutritionDiets.includes(option)}
                />
              ))}
            </div>
            <input name="nutritionDietOther" defaultValue={draft.careInformation.nutritionDietOther ?? ""} placeholder="Nutrition other detail" className="mt-2 h-10 w-full rounded-lg border border-border px-3 text-sm" />
          </div>

          <label className="mt-4 block space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Additional information to help spark joy</span>
            <textarea name="joySparksNotes" defaultValue={draft.careInformation.joySparksNotes ?? ""} className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" />
          </label>
        </Card>

        <Card>
          <CardTitle>Operational Flags & Provider Signoff</CardTitle>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <CheckboxField name="flagNutAllergy" label="Nut allergy" defaultChecked={draft.operationalFlags.nutAllergy} />
            <CheckboxField name="flagShellfishAllergy" label="Shellfish allergy" defaultChecked={draft.operationalFlags.shellfishAllergy} />
            <CheckboxField name="flagFishAllergy" label="Fish allergy" defaultChecked={draft.operationalFlags.fishAllergy} />
            <CheckboxField name="flagDiabeticRestrictedSweets" label="Diabetic / Restricted Sweets" defaultChecked={draft.operationalFlags.diabeticRestrictedSweets} />
            <CheckboxField name="flagOxygenRequirement" label="Oxygen requirement" defaultChecked={draft.operationalFlags.oxygenRequirement} />
            <CheckboxField name="flagDnr" label="DNR" defaultChecked={draft.operationalFlags.dnr} />
            <CheckboxField name="flagNoPhotos" label="No photos" defaultChecked={draft.operationalFlags.noPhotos} />
            <CheckboxField name="flagBathroomAssistance" label="Bathroom assistance" defaultChecked={draft.operationalFlags.bathroomAssistance} />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Provider Name</span>
              <input name="providerName" defaultValue={draft.providerName ?? ""} className="h-10 w-full rounded-lg border border-border px-3" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Provider Signature</span>
              <input name="providerSignature" defaultValue={draft.providerSignature ?? ""} className="h-10 w-full rounded-lg border border-border px-3" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Provider Signature Date</span>
              <input type="date" name="providerSignatureDate" defaultValue={draft.providerSignatureDate ?? ""} className="h-10 w-full rounded-lg border border-border px-3" />
            </label>
          </div>
        </Card>

        <div className="flex flex-wrap gap-2">
          <button type="submit" name="saveIntent" value="draft" className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
            Save Draft
          </button>
          <button type="submit" name="saveIntent" value="completed" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
            Save Completed
          </button>
          <button type="submit" name="saveIntent" value="signed" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
            Save Signed
          </button>
        </div>
      </form>
    </div>
  );
}
