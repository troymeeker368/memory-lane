import { notFound } from "next/navigation";

import {
  saveAndDispatchPofSignatureRequestFromEditorAction,
  savePhysicianOrderFormAction
} from "@/app/(portal)/health/physician-orders/actions";
import { PofAllergiesEditor } from "@/components/forms/pof-allergies-editor";
import { PofDiagnosesEditor } from "@/components/forms/pof-diagnoses-editor";
import { PofMedicationsEditor } from "@/components/forms/pof-medications-editor";
import { SegmentedChoiceGroup } from "@/components/forms/segmented-choice-group";
import { PofEsignWorkflowCard } from "@/components/physician-orders/pof-esign-workflow-card";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { getCurrentProfile, requireRoles } from "@/lib/auth";
import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
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
import { createClient } from "@/lib/supabase/server";
import { getConfiguredClinicalSenderEmail, listPofTimelineForPhysicianOrder } from "@/lib/services/pof-esign";
import { getManagedUserSignoffLabel } from "@/lib/services/user-management";
import {
  POF_LEVEL_OF_CARE_OPTIONS,
  POF_NUTRITION_OPTIONS,
  POF_STANDING_ORDER_OPTIONS,
  buildNewPhysicianOrderDraft,
  getPhysicianOrderById
} from "@/lib/services/physician-orders-supabase";
import { formatDateTime, formatOptionalDate } from "@/lib/utils";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function toDisplayNameFromEmail(email: string | null | undefined) {
  const local = String(email ?? "").trim().split("@")[0] ?? "";
  const withSpaces = local.replace(/[._-]+/g, " ").trim();
  if (!withSpaces) return "";
  return withSpaces
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveNurseDefaultName(fullName: string | null | undefined, email: string | null | undefined) {
  const normalizedFullName = String(fullName ?? "").trim();
  if (normalizedFullName && normalizedFullName.includes(" ")) return normalizedFullName;
  const fromEmail = toDisplayNameFromEmail(email);
  if (fromEmail) return fromEmail;
  return normalizedFullName || "Nurse";
}

function hasYesValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase() === "yes";
}

function CheckboxField({
  name,
  label,
  defaultChecked,
  value
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
  value?: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value={value ?? "true"} defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  );
}

const ADL_TOILETING_NEEDS_OPTIONS = [
  { label: "Needs Assistance", value: "Needs Assistance" },
  { label: "Needs Reminders", value: "Needs Reminders" },
  { label: "Independent", value: "Independent" }
] as const;

export default async function NewPhysicianOrderPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoles(["admin", "nurse"]);
  const profile = await getCurrentProfile();
  const actorDisplayName = await getManagedUserSignoffLabel(profile.id, profile.full_name);
  const query = await searchParams;
  const memberId = firstString(query.memberId) ?? "";
  const pofId = firstString(query.pofId) ?? "";
  const saveError = firstString(query.saveError) ?? "";
  let canonicalMemberId = memberId;
  let identityError: string | null = null;
  if (memberId) {
    try {
      const canonical = await resolveCanonicalMemberRef(
        {
          sourceType: "member",
          memberId,
          selectedId: memberId
        },
        { actionLabel: "NewPhysicianOrderPage" }
      );
      canonicalMemberId = canonical.memberId ?? "";
    } catch (error) {
      canonicalMemberId = "";
      identityError = error instanceof Error ? error.message : "Invalid member identity for new physician order.";
    }
  }
  const effectiveSaveError = identityError ?? saveError;

  const supabase = await createClient();
  const { data: memberRows, error: memberRowsError } = await supabase
    .from("members")
    .select("id, display_name, status")
    .eq("status", "active")
    .order("display_name", { ascending: true });
  if (memberRowsError) throw new Error(`Unable to load active members for physician order creation: ${memberRowsError.message}`);
  const members = memberRows ?? [];

  if (!canonicalMemberId && !pofId) {
    return (
      <div className="space-y-4">
        {effectiveSaveError ? (
          <Card>
            <p className="text-sm font-semibold text-rose-700">Unable to save Physician Order.</p>
            <p className="mt-1 text-sm text-muted">{effectiveSaveError}</p>
          </Card>
        ) : null}
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

  const editing = pofId ? await getPhysicianOrderById(pofId) : null;
  const draft =
    editing ??
    (canonicalMemberId
      ? await buildNewPhysicianOrderDraft({
          memberId: canonicalMemberId,
          actor: { id: profile.id, fullName: actorDisplayName, signoffName: actorDisplayName }
        })
      : null);
  if (!draft) notFound();
  if (editing && (editing.status === "Signed" || editing.status === "Superseded" || editing.status === "Expired")) {
    notFound();
  }
  const latestRequest = editing?.id ? (await listPofTimelineForPhysicianOrder(editing.id)).requests[0] ?? null : null;
  const currentNurseName = resolveNurseDefaultName(profile.full_name, profile.email);
  const defaultFromEmail = profile.email?.trim() || getConfiguredClinicalSenderEmail();
  const shouldDefaultBathroomAssistance = hasYesValue(draft.careInformation.adlProfile.toileting);

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
        {draft.intakeAssessmentId ? (
          <p className="mt-1 text-xs text-muted">
            Prefilled from Intake Assessment: <span className="font-semibold">{draft.intakeAssessmentId}</span>
          </p>
        ) : null}
        {editing ? (
          <p className="mt-1 text-xs text-muted">
            Status: {editing.status} | Created by {editing.createdByName} on {formatDateTime(editing.createdAt)}
          </p>
        ) : null}
      </Card>

      {effectiveSaveError ? (
        <Card>
          <p className="text-sm font-semibold text-rose-700">Unable to save Physician Order.</p>
          <p className="mt-1 text-sm text-muted">{effectiveSaveError}</p>
        </Card>
      ) : null}

      <form action={savePhysicianOrderFormAction} className="space-y-4">
        <input type="hidden" name="memberId" value={draft.memberId} />
        <input type="hidden" name="pofId" value={editing?.id ?? ""} />
        <input type="hidden" name="intakeAssessmentId" value={draft.intakeAssessmentId ?? ""} />

        <Card>
          <CardTitle>Identification / Medical Orders</CardTitle>
          <div className="mt-3 grid gap-3 md:grid-cols-5">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">DOB</span>
              <input
                type="date"
                name="memberDob"
                defaultValue={draft.memberDobSnapshot ?? ""}
                className="h-10 w-full rounded-lg border border-border px-3"
              />
            </label>
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

          <div className="mt-3">
            <p className="text-sm font-semibold">Diagnoses</p>
            <p className="text-xs text-muted">Physician-entered field. Intake does not prefill diagnoses.</p>
            <PofDiagnosesEditor initialRows={draft.diagnosisRows} />
          </div>

          <div className="mt-3">
            <p className="text-sm font-semibold">Allergies</p>
            <PofAllergiesEditor initialRows={draft.allergyRows} />
          </div>

          <div className="mt-3">
            <p className="text-sm font-semibold">Medications</p>
            <PofMedicationsEditor initialRows={draft.medications} />
          </div>

          <div className="mt-3 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">Standing Orders (check to include on generated POF)</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {POF_STANDING_ORDER_OPTIONS.map((order) => (
                <CheckboxField
                  key={order}
                  name="standingOrder"
                  value={order}
                  label={order}
                  defaultChecked={draft.standingOrders.includes(order)}
                />
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>Member Care Information</CardTitle>
          <p className="mt-1 text-sm text-muted">Grouped by behavior, function, clinical support, and nutrition to simplify review.</p>

          <div className="mt-3 space-y-3">
            <details className="rounded-lg border border-border p-3" open>
              <summary className="cursor-pointer text-sm font-semibold">Behavior & Orientation</summary>
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
              </div>
              <input type="hidden" name="orientationDob" defaultValue={draft.careInformation.orientationProfile.orientationDob ?? ""} />
              <input type="hidden" name="orientationCity" defaultValue={draft.careInformation.orientationProfile.orientationCity ?? ""} />
              <input
                type="hidden"
                name="orientationCurrentYear"
                defaultValue={draft.careInformation.orientationProfile.orientationCurrentYear ?? ""}
              />
              <input
                type="hidden"
                name="orientationFormerOccupation"
                defaultValue={draft.careInformation.orientationProfile.orientationFormerOccupation ?? ""}
              />
              <input
                type="hidden"
                name="orientationDisorientation"
                defaultValue={
                  draft.careInformation.orientationProfile.disorientation == null
                    ? ""
                    : draft.careInformation.orientationProfile.disorientation
                      ? "true"
                      : "false"
                }
              />
              <input
                type="hidden"
                name="orientationMemoryImpairment"
                defaultValue={draft.careInformation.orientationProfile.memoryImpairment ?? ""}
              />
              <input
                type="hidden"
                name="orientationMemorySeverity"
                defaultValue={draft.careInformation.orientationProfile.memorySeverity ?? ""}
              />
              <input
                type="hidden"
                name="orientationComments"
                defaultValue={draft.careInformation.orientationProfile.cognitiveBehaviorComments ?? ""}
              />
            </details>

            <details className="rounded-lg border border-border p-3" open>
              <summary className="cursor-pointer text-sm font-semibold">ADLs & Mobility</summary>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
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
                  <div className="space-y-2">
                    <input
                      id="mobility-other-toggle"
                      className="peer h-4 w-4"
                      type="checkbox"
                      name="mobilityOther"
                      value="true"
                      defaultChecked={draft.careInformation.mobilityOther}
                    />
                    <label htmlFor="mobility-other-toggle" className="ml-2 inline-flex items-center gap-2 text-sm">
                      <span>Other</span>
                    </label>
                    <div className="hidden peer-checked:block">
                      <input
                        name="mobilityOtherText"
                        defaultValue={draft.careInformation.mobilityOtherText ?? ""}
                        placeholder="Mobility other detail"
                        className="h-10 w-full rounded-lg border border-border px-3 text-sm"
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Functional Limitations</p>
                  <CheckboxField name="functionalLimitationSight" label="Sight" defaultChecked={draft.careInformation.functionalLimitationSight} />
                  <CheckboxField name="functionalLimitationHearing" label="Hearing" defaultChecked={draft.careInformation.functionalLimitationHearing} />
                  <CheckboxField name="functionalLimitationSpeech" label="Speech" defaultChecked={draft.careInformation.functionalLimitationSpeech} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <p className="text-sm font-semibold">MHP-Aligned ADL Fields (direct sync)</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <SegmentedChoiceGroup
                      label="Ambulation"
                      name="adlAmbulation"
                      defaultValue={draft.careInformation.adlProfile.ambulation ?? ""}
                      options={MHP_AMBULATION_OPTIONS}
                    />
                    <SegmentedChoiceGroup
                      label="Transferring"
                      name="adlTransferring"
                      defaultValue={draft.careInformation.adlProfile.transferring ?? ""}
                      options={MHP_TRANSFER_SUPPORT_OPTIONS}
                    />
                    <SegmentedChoiceGroup
                      label="Bathing"
                      name="adlBathing"
                      defaultValue={draft.careInformation.adlProfile.bathing ?? ""}
                      options={MHP_TRANSFER_SUPPORT_OPTIONS}
                    />
                    <SegmentedChoiceGroup
                      label="Dressing"
                      name="adlDressing"
                      defaultValue={draft.careInformation.adlProfile.dressing ?? ""}
                      options={MHP_DRESSING_OPTIONS}
                    />
                    <SegmentedChoiceGroup
                      label="Eating"
                      name="adlEating"
                      defaultValue={draft.careInformation.adlProfile.eating ?? ""}
                      options={MHP_TRANSFER_SUPPORT_OPTIONS}
                    />
                    <SegmentedChoiceGroup
                      label="Bladder Continence"
                      name="adlBladderContinence"
                      defaultValue={draft.careInformation.adlProfile.bladderContinence ?? ""}
                      options={MHP_BLADDER_CONTINENCE_OPTIONS}
                    />
                    <SegmentedChoiceGroup
                      label="Bowel Continence"
                      name="adlBowelContinence"
                      defaultValue={draft.careInformation.adlProfile.bowelContinence ?? ""}
                      options={MHP_BOWEL_CONTINENCE_OPTIONS}
                    />
                    <SegmentedChoiceGroup
                      label="Toileting Assistance"
                      name="adlToileting"
                      defaultValue={draft.careInformation.adlProfile.toileting ?? ""}
                      options={MHP_TOILETING_OPTIONS}
                    />
                    <SegmentedChoiceGroup
                      label="Hearing"
                      name="adlHearing"
                      defaultValue={draft.careInformation.adlProfile.hearing ?? ""}
                      options={MHP_HEARING_OPTIONS}
                    />
                    <SegmentedChoiceGroup
                      label="Vision"
                      name="adlVision"
                      defaultValue={draft.careInformation.adlProfile.vision ?? ""}
                      options={MHP_VISION_OPTIONS}
                    />
                    <SegmentedChoiceGroup
                      label="Dental"
                      name="adlDental"
                      defaultValue={draft.careInformation.adlProfile.dental ?? ""}
                      options={MHP_DENTAL_OPTIONS}
                    />
                    <SegmentedChoiceGroup
                      label="Speech / Verbal Status"
                      name="adlSpeechVerbalStatus"
                      defaultValue={draft.careInformation.adlProfile.speechVerbalStatus ?? ""}
                      options={MHP_SPEECH_STATUS_OPTIONS}
                    />
                    <SegmentedChoiceGroup
                      label="May Self-Medicate"
                      name="adlMaySelfMedicate"
                      defaultValue={
                        draft.careInformation.adlProfile.maySelfMedicate == null
                          ? ""
                          : draft.careInformation.adlProfile.maySelfMedicate
                            ? "true"
                            : "false"
                      }
                      options={MHP_SELF_MEDICATE_OPTIONS}
                    />
                    <SegmentedChoiceGroup
                      label="Toileting Needs"
                      name="adlToiletingNeeds"
                      defaultValue={draft.careInformation.adlProfile.toiletingNeeds ?? ""}
                      options={ADL_TOILETING_NEEDS_OPTIONS}
                    />
                    <input
                      type="hidden"
                      name="adlMedicationManagerName"
                      defaultValue={draft.careInformation.adlProfile.medicationManagerName ?? ""}
                    />
                  </div>
                  <input type="hidden" name="adlToiletingComments" defaultValue={draft.careInformation.adlProfile.toiletingComments ?? ""} />
                  <input type="hidden" name="adlSpeechComments" defaultValue={draft.careInformation.adlProfile.speechComments ?? ""} />
                  <input type="hidden" name="adlHygieneGrooming" defaultValue={draft.careInformation.adlProfile.hygieneGrooming ?? ""} />
                </div>
              </div>
            </details>

            <details className="rounded-lg border border-border p-3" open>
              <summary className="cursor-pointer text-sm font-semibold">Clinical Support</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <CheckboxField name="breathingRoomAir" label="Room Air" defaultChecked={draft.careInformation.breathingRoomAir} />
                <CheckboxField name="breathingOxygenTank" label="O2 Needs" defaultChecked={draft.careInformation.breathingOxygenTank} />
                <input
                  name="breathingOxygenLiters"
                  defaultValue={draft.careInformation.breathingOxygenLiters ?? ""}
                  placeholder="Oxygen liters (L)"
                  className="h-10 rounded-lg border border-border px-3 text-sm"
                />
              </div>
              <input type="hidden" name="medAdministrationSelf" value={draft.careInformation.medAdministrationSelf ? "true" : "false"} />
              <input type="hidden" name="medAdministrationNurse" value={draft.careInformation.medAdministrationNurse ? "true" : "false"} />
              <input
                type="hidden"
                name="neurologicalConvulsionsSeizures"
                value={draft.careInformation.neurologicalConvulsionsSeizures ? "true" : "false"}
              />
              <input type="hidden" name="bladderContinent" value={draft.careInformation.bladderContinent ? "true" : "false"} />
              <input type="hidden" name="bladderIncontinent" value={draft.careInformation.bladderIncontinent ? "true" : "false"} />
              <input type="hidden" name="bowelContinent" value={draft.careInformation.bowelContinent ? "true" : "false"} />
              <input type="hidden" name="bowelIncontinent" value={draft.careInformation.bowelIncontinent ? "true" : "false"} />
              <input type="hidden" name="skinNormal" value={draft.careInformation.skinNormal ? "true" : "false"} />
              <input type="hidden" name="skinOther" defaultValue={draft.careInformation.skinOther ?? ""} />
            </details>

            <details className="rounded-lg border border-border p-3" open>
              <summary className="cursor-pointer text-sm font-semibold">Nutrition & Joy Sparks</summary>
              <div className="mt-3">
                <p className="text-sm font-semibold">Nutrition / Diet</p>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  {POF_NUTRITION_OPTIONS.map((option) => (
                    <CheckboxField
                      key={option}
                      name="nutritionDiet"
                      value={option}
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
            </details>
          </div>
        </Card>

        <Card>
          <CardTitle>Operational Flags</CardTitle>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <CheckboxField name="flagNutAllergy" label="Nut allergy" defaultChecked={draft.operationalFlags.nutAllergy} />
            <CheckboxField name="flagShellfishAllergy" label="Shellfish allergy" defaultChecked={draft.operationalFlags.shellfishAllergy} />
            <CheckboxField name="flagFishAllergy" label="Fish allergy" defaultChecked={draft.operationalFlags.fishAllergy} />
            <CheckboxField name="flagDiabeticRestrictedSweets" label="Diabetic / Restricted Sweets" defaultChecked={draft.operationalFlags.diabeticRestrictedSweets} />
            <CheckboxField name="flagOxygenRequirement" label="Oxygen requirement" defaultChecked={draft.operationalFlags.oxygenRequirement} />
            <CheckboxField name="flagDnr" label="DNR" defaultChecked={draft.operationalFlags.dnr} />
            <CheckboxField name="flagNoPhotos" label="No photos" defaultChecked={draft.operationalFlags.noPhotos} />
            <CheckboxField
              name="flagBathroomAssistance"
              label="Bathroom assistance"
              defaultChecked={draft.operationalFlags.bathroomAssistance || shouldDefaultBathroomAssistance}
            />
          </div>
        </Card>

        <Card>
          <CardTitle>Provider E-Sign Workflow</CardTitle>
          {!editing ? (
            <p className="mt-1 text-xs text-muted">Save draft first to enable Send POF for Signature.</p>
          ) : null}
          <div className="mt-3">
            <PofEsignWorkflowCard
              memberId={draft.memberId}
              physicianOrderId={editing?.id ?? null}
              latestRequest={latestRequest}
              defaultProviderName={draft.providerName ?? ""}
              defaultProviderEmail={latestRequest?.providerEmail ?? ""}
              defaultNurseName={currentNurseName}
              defaultFromEmail={defaultFromEmail}
              defaultOptionalMessage={latestRequest?.optionalMessage ?? ""}
              signedProviderName={draft.providerName}
              signedAt={latestRequest?.signedAt ?? null}
              saveAndDispatchAction={saveAndDispatchPofSignatureRequestFromEditorAction}
            />
          </div>
        </Card>

        <div className="flex flex-wrap gap-2">
          <button type="submit" name="saveIntent" value="draft" className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
            Save Draft
          </button>
        </div>
      </form>
    </div>
  );
}
