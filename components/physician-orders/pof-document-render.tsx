import type { PhysicianOrderForm } from "@/lib/services/physician-orders-supabase";
import { buildPofDocumentSections } from "@/lib/services/pof-document-content";
import { Card } from "@/components/ui/card";
import { DocumentBrandHeader } from "@/components/documents/document-brand-header";

const EXCLUDED_SECTION_TITLES = new Set(["Diagnoses", "Allergies", "Medications", "Standing Orders"]);

export function PofDocumentRender({
  form,
  title = "Physician Order Form",
  metaLines = []
}: {
  form: PhysicianOrderForm;
  title?: string;
  metaLines?: string[];
}) {
  const sections = buildPofDocumentSections(form).filter((section) => !EXCLUDED_SECTION_TITLES.has(section.title));

  return (
    <Card>
      <DocumentBrandHeader title={title} metaLines={metaLines} />
      <div className="mt-4 space-y-4">
        <section className="rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">Identification / Medical Orders</h3>
          <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
            <p><span className="font-semibold">Member:</span> {form.memberNameSnapshot || "-"}</p>
            <p><span className="font-semibold">DOB:</span> {form.memberDobSnapshot || "-"}</p>
            <p><span className="font-semibold">Sex:</span> {form.sex || "-"}</p>
            <p><span className="font-semibold">Level of Care:</span> {form.levelOfCare || "-"}</p>
            <p><span className="font-semibold">DNR Selected:</span> {form.dnrSelected ? "Yes" : "No"}</p>
            <p><span className="font-semibold">Status:</span> {form.status || "-"}</p>
            <p><span className="font-semibold">Provider Signature Status:</span> {form.providerSignatureStatus || "-"}</p>
            <p><span className="font-semibold">Sent Date:</span> {form.completedDate || "-"}</p>
            <p><span className="font-semibold">Next Renewal Due:</span> {form.nextRenewalDueDate || "-"}</p>
            <p><span className="font-semibold">BP:</span> {form.vitalsBloodPressure || "-"}</p>
            <p><span className="font-semibold">Pulse:</span> {form.vitalsPulse || "-"}</p>
            <p><span className="font-semibold">O2 %:</span> {form.vitalsOxygenSaturation || "-"}</p>
            <p><span className="font-semibold">Respiration:</span> {form.vitalsRespiration || "-"}</p>
          </div>
        </section>

        <section className="rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">Diagnoses</h3>
          <div className="mt-2 table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Diagnosis</th>
                </tr>
              </thead>
              <tbody>
                {form.diagnosisRows.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="text-sm text-muted">No diagnoses entered.</td>
                  </tr>
                ) : (
                  form.diagnosisRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.diagnosisType}</td>
                      <td>{row.diagnosisName}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">Allergies</h3>
          <div className="mt-2 table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Allergy</th>
                  <th>Severity</th>
                  <th>Comments</th>
                </tr>
              </thead>
              <tbody>
                {form.allergyRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-sm text-muted">No allergies entered.</td>
                  </tr>
                ) : (
                  form.allergyRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.allergyGroup}</td>
                      <td>{row.allergyName}</td>
                      <td>{row.severity || "-"}</td>
                      <td>{row.comments || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">Medications</h3>
          <div className="mt-2 table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Dose</th>
                  <th>Qty</th>
                  <th>Form</th>
                  <th>Route</th>
                  <th>Frequency</th>
                  <th>Given at Center</th>
                  <th>Comments</th>
                </tr>
              </thead>
              <tbody>
                {form.medications.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-sm text-muted">No medications entered.</td>
                  </tr>
                ) : (
                  form.medications.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.dose || "-"}</td>
                      <td>{row.quantity || "-"}</td>
                      <td>{row.form || "-"}</td>
                      <td>{row.routeLaterality ? `${row.route || "-"} (${row.routeLaterality})` : row.route || "-"}</td>
                      <td>{row.frequency || "-"}</td>
                      <td>{row.givenAtCenter ? row.givenAtCenterTime24h || "Yes" : "-"}</td>
                      <td>{row.comments || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">Standing Orders</h3>
          {form.standingOrders.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No standing orders selected.</p>
          ) : (
            <ul className="mt-2 list-disc pl-5 text-sm">
              {form.standingOrders.map((order, index) => (
                <li key={`${order}-${index}`}>{order}</li>
              ))}
            </ul>
          )}
        </section>

        {sections.map((section) => (
          <section key={section.title} className="rounded-lg border border-border p-3">
            <h3 className="text-sm font-semibold">{section.title}</h3>
            <dl className="mt-2 grid gap-x-3 gap-y-2 md:grid-cols-[240px_1fr]">
              {section.rows.map((row) => (
                <div key={`${section.title}-${row.label}`} className="contents">
                  <dt className="text-xs font-semibold text-muted">{row.label}</dt>
                  <dd className="whitespace-pre-wrap break-words text-sm">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Card>
  );
}
