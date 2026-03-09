import Link from "next/link";
import { notFound } from "next/navigation";

import { FaceSheetActions } from "@/components/face-sheet/face-sheet-actions";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { requireRoles } from "@/lib/auth";
import { getMemberFaceSheet } from "@/lib/services/member-face-sheet";
import { formatDate, formatDateTime, formatOptionalDate } from "@/lib/utils";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function displayList(values: string[]) {
  if (values.length === 0) return "-";
  return values.join(", ");
}

export default async function MemberFaceSheetPage({
  params,
  searchParams
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoles(["admin", "manager", "nurse"]);
  const { memberId } = await params;
  const query = await searchParams;
  const source = firstString(query.from);
  const backHref =
    source === "mhp"
      ? `/health/member-health-profiles/${memberId}`
      : source === "mcc"
        ? `/operations/member-command-center/${memberId}`
        : `/members/${memberId}`;

  const faceSheet = getMemberFaceSheet(memberId);
  if (!faceSheet) notFound();

  return (
    <div className="face-sheet-page space-y-4">
      <div className="print-hide flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BackArrowButton fallbackHref={backHref} ariaLabel="Back to member record" />
          <Link href={backHref} className="text-sm font-semibold text-brand">
            Back to Member Record
          </Link>
        </div>
        <FaceSheetActions memberId={memberId} />
      </div>

      <header className="face-sheet-header border-b border-black/30 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xl font-bold uppercase tracking-wide">Member Face Sheet</p>
            <p className="text-sm">Town Square Fort Mill</p>
          </div>
          <div className="text-right text-xs">
            <p>Generated: {formatDateTime(faceSheet.generatedAt)} (ET)</p>
            <p>Member ID: {faceSheet.member.id}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[110px_1fr]">
          {faceSheet.member.photoUrl ? (
            <img src={faceSheet.member.photoUrl} alt={`${faceSheet.member.name} photo`} className="h-28 w-28 rounded border border-black/30 object-cover" />
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded border border-black/30 text-2xl font-semibold">
              {faceSheet.member.name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0] ?? "")
                .join("")
                .toUpperCase()}
            </div>
          )}
          <div className="grid gap-1 text-sm sm:grid-cols-2">
            <p><span className="font-semibold">Member:</span> {faceSheet.member.name}</p>
            <p><span className="font-semibold">DOB:</span> {formatOptionalDate(faceSheet.member.dob)}</p>
            <p><span className="font-semibold">Age:</span> {faceSheet.member.age ?? "-"}</p>
            <p><span className="font-semibold">Gender:</span> {faceSheet.member.gender ?? "-"}</p>
          </div>
        </div>
      </header>

      <section className="face-sheet-section">
        <h2 className="face-sheet-heading">Code Status</h2>
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          <p><span className="font-semibold">Code Status:</span> {faceSheet.legal.codeStatus}</p>
          <p><span className="font-semibold">DNR:</span> {faceSheet.legal.dnr}</p>
          <p><span className="font-semibold">DNI:</span> {faceSheet.legal.dni}</p>
        </div>
      </section>

      <section className="face-sheet-section">
        <h2 className="face-sheet-heading">Demographics</h2>
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          <p><span className="font-semibold">Address:</span> {faceSheet.demographics.address ?? "-"}</p>
          <p><span className="font-semibold">Primary Language:</span> {faceSheet.demographics.primaryLanguage ?? "-"}</p>
          <p><span className="font-semibold">Marital Status:</span> {faceSheet.demographics.maritalStatus ?? "-"}</p>
          <p><span className="font-semibold">Veteran:</span> {faceSheet.demographics.veteran}</p>
          <p><span className="font-semibold">Veteran Branch:</span> {faceSheet.demographics.veteranBranch ?? "-"}</p>
        </div>
      </section>

      <section className="face-sheet-section">
        <h2 className="face-sheet-heading">Emergency / Primary Contacts</h2>
        {faceSheet.contacts.length === 0 ? (
          <p className="text-sm">No contact records on file.</p>
        ) : (
          <table className="face-sheet-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Name</th>
                <th>Relationship</th>
                <th>Phone</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {faceSheet.contacts.map((contact) => (
                <tr key={`${contact.category}-${contact.name}`}>
                  <td>{contact.category}</td>
                  <td>{contact.name}</td>
                  <td>{contact.relationship ?? "-"}</td>
                  <td>{contact.phone ?? "-"}</td>
                  <td>{contact.email ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="face-sheet-section">
        <h2 className="face-sheet-heading">Legal / Critical Status</h2>
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          <p><span className="font-semibold">POLST/MOLST/COLST:</span> {faceSheet.legal.polst ?? "-"}</p>
          <p><span className="font-semibold">Hospice:</span> {faceSheet.legal.hospice}</p>
          <p><span className="font-semibold">POA:</span> {faceSheet.legal.powerOfAttorney ?? "-"}</p>
          <p className="sm:col-span-2"><span className="font-semibold">Advanced Directives Obtained:</span> {faceSheet.legal.advancedDirectives}</p>
        </div>
      </section>

      <section className="face-sheet-section">
        <h2 className="face-sheet-heading">Medical Summary</h2>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <p className="font-semibold">Primary Diagnoses</p>
            <p>{displayList(faceSheet.medical.primaryDiagnoses)}</p>
          </div>
          <div>
            <p className="font-semibold">Secondary Diagnoses</p>
            <p>{displayList(faceSheet.medical.secondaryDiagnoses)}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="font-semibold">Current Medications</p>
            {faceSheet.medical.medications.length === 0 ? (
              <p>-</p>
            ) : (
              <table className="face-sheet-table mt-1">
                <thead>
                  <tr>
                    <th>Medication</th>
                    <th>Dose</th>
                    <th>Route</th>
                    <th>Frequency</th>
                  </tr>
                </thead>
                <tbody>
                  {faceSheet.medical.medications.map((medication) => (
                    <tr key={medication.id}>
                      <td>{medication.medication_name}</td>
                      <td>{medication.dose ?? "-"}</td>
                      <td>{medication.route ?? "-"}</td>
                      <td>{medication.frequency ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <p className="font-semibold">Diet / Restrictions</p>
            <p>{faceSheet.medical.dietType ?? "-"}</p>
            <p>{faceSheet.medical.dietRestrictions ?? "-"}</p>
          </div>
          <div>
            <p className="font-semibold">Swallowing Difficulty</p>
            <p>{faceSheet.medical.swallowingDifficulty ?? "-"}</p>
            <p><span className="font-semibold">Oxygen Required:</span> {faceSheet.medical.oxygenRequired}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="font-semibold">Allergies</p>
            {faceSheet.medical.allergyGroups.food.length === 0 &&
            faceSheet.medical.allergyGroups.medication.length === 0 &&
            faceSheet.medical.allergyGroups.environmental.length === 0 ? (
              <p>-</p>
            ) : (
              <table className="face-sheet-table mt-1">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Allergy</th>
                    <th>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {faceSheet.medical.allergyGroups.food.map((allergy) => (
                    <tr key={`food-${allergy.name}`}>
                      <td>Food</td>
                      <td>{allergy.name}</td>
                      <td>{allergy.severity ?? "-"}</td>
                    </tr>
                  ))}
                  {faceSheet.medical.allergyGroups.medication.map((allergy) => (
                    <tr key={`medication-${allergy.name}`}>
                      <td>Medication</td>
                      <td>{allergy.name}</td>
                      <td>{allergy.severity ?? "-"}</td>
                    </tr>
                  ))}
                  {faceSheet.medical.allergyGroups.environmental.map((allergy) => (
                    <tr key={`environmental-${allergy.name}`}>
                      <td>Environmental</td>
                      <td>{allergy.name}</td>
                      <td>{allergy.severity ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {faceSheet.medical.noKnownAllergies ? <p>No Known Allergies (NKA)</p> : null}
          </div>
        </div>
      </section>

      <section className="face-sheet-section">
        <h2 className="face-sheet-heading">Functional / Safety Summary</h2>
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          <p><span className="font-semibold">Ambulation:</span> {faceSheet.functionalSafety.ambulation ?? "-"}</p>
          <p><span className="font-semibold">Transfer Assistance:</span> {faceSheet.functionalSafety.transferring ?? "-"}</p>
          <p><span className="font-semibold">Toileting Needs:</span> {faceSheet.functionalSafety.toiletingNeeds ?? "-"}</p>
          <p><span className="font-semibold">Bathroom Assistance:</span> {faceSheet.functionalSafety.bathroomAssistance ?? "-"}</p>
          <p><span className="font-semibold">Hearing:</span> {faceSheet.functionalSafety.hearing ?? "-"}</p>
          <p><span className="font-semibold">Vision:</span> {faceSheet.functionalSafety.vision ?? "-"}</p>
          <p><span className="font-semibold">Speech:</span> {faceSheet.functionalSafety.speech ?? "-"}</p>
          <p><span className="font-semibold">Memory Impairment:</span> {faceSheet.functionalSafety.memoryImpairment ?? "-"}</p>
          <p className="sm:col-span-2"><span className="font-semibold">Behavior Concerns:</span> {displayList(faceSheet.functionalSafety.behaviorConcerns)}</p>
        </div>
      </section>

      <section className="face-sheet-section">
        <h2 className="face-sheet-heading">Providers</h2>
        {faceSheet.providers.length === 0 ? (
          <p className="text-sm">No provider records on file.</p>
        ) : (
          <table className="face-sheet-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Specialty</th>
                <th>Practice</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {faceSheet.providers.map((provider) => (
                <tr key={provider.id}>
                  <td>{provider.name}</td>
                  <td>{provider.specialty ?? "-"}</td>
                  <td>{provider.practice ?? "-"}</td>
                  <td>{provider.phone ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="face-sheet-section">
        <h2 className="face-sheet-heading">Diet / Allergy Flags</h2>
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          <p><span className="font-semibold">Diet Type:</span> {faceSheet.dietAllergyFlags.dietType ?? "-"}</p>
          <p><span className="font-semibold">Texture:</span> {faceSheet.dietAllergyFlags.texture ?? "-"}</p>
          <p className="sm:col-span-2"><span className="font-semibold">Restrictions:</span> {faceSheet.dietAllergyFlags.restrictions ?? "-"}</p>
          <p className="sm:col-span-2"><span className="font-semibold">Food Allergies:</span> {displayList(faceSheet.dietAllergyFlags.foodAllergies)}</p>
          <p className="sm:col-span-2"><span className="font-semibold">Medication Allergies:</span> {displayList(faceSheet.dietAllergyFlags.medicationAllergies)}</p>
          <p className="sm:col-span-2"><span className="font-semibold">Environmental Allergies:</span> {displayList(faceSheet.dietAllergyFlags.environmentalAllergies)}</p>
        </div>
      </section>

      <footer className="face-sheet-footer border-t border-black/30 pt-2 text-xs">
        <p>
          Face Sheet generated on {formatDateTime(faceSheet.generatedAt)} ET for {faceSheet.member.name} ({formatDate(faceSheet.generatedAt)}).
        </p>
      </footer>
    </div>
  );
}
