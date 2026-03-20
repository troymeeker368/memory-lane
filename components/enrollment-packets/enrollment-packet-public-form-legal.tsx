"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";

import { ENROLLMENT_PACKET_LEGAL_TEXT } from "@/lib/services/enrollment-packet-legal-text";
import { formatEnrollmentPacketValue } from "@/lib/services/enrollment-packet-public-validation";
import type {
  EnrollmentPacketIntakeFieldKey,
  EnrollmentPacketIntakePayload,
  EnrollmentPacketIntakeTextKey
} from "@/lib/services/enrollment-packet-intake-payload";

import type { EnrollmentPacketCompletionState } from "@/components/enrollment-packets/enrollment-packet-public-form-types";

function textValue(payload: EnrollmentPacketIntakePayload, key: EnrollmentPacketIntakeTextKey) {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

type EnrollmentPacketPublicFormLegalProps = {
  payload: EnrollmentPacketIntakePayload;
  completion: EnrollmentPacketCompletionState;
  isPending: boolean;
  caregiverTypedName: string;
  setCaregiverTypedName: (value: string) => void;
  submitAttempted: boolean;
  hasSignature: boolean;
  attested: boolean;
  setAttested: (checked: boolean) => void;
  expandedLegalSections: Record<"privacy" | "rights" | "photo" | "ancillary", boolean>;
  setExpandedLegalSection: (section: "privacy" | "rights" | "photo" | "ancillary", open: boolean) => void;
  setText: (key: EnrollmentPacketIntakeTextKey, value: string) => void;
  setAck: (key: EnrollmentPacketIntakeTextKey, checked: boolean) => void;
  markTouched: (key: EnrollmentPacketIntakeFieldKey) => void;
  fieldError: (key: EnrollmentPacketIntakeFieldKey, fallbackLabel: string) => string | null;
  controlClassName: (key: EnrollmentPacketIntakeFieldKey, fallbackLabel: string) => string;
  scrollToFirstMissingField: () => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onPointerDown: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  clearSignature: () => void;
};

export function EnrollmentPacketPublicFormLegal({
  payload,
  completion,
  isPending,
  caregiverTypedName,
  setCaregiverTypedName,
  submitAttempted,
  hasSignature,
  attested,
  setAttested,
  expandedLegalSections,
  setExpandedLegalSection,
  setText,
  setAck,
  markTouched,
  fieldError,
  controlClassName,
  scrollToFirstMissingField,
  canvasRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  clearSignature
}: EnrollmentPacketPublicFormLegalProps) {
  return (
    <>
      <Section title="14. Privacy Practices Acknowledgement">
        <details
          className="rounded-lg border border-border bg-slate-50 p-3 text-sm"
          open={expandedLegalSections.privacy}
          onToggle={(event) => setExpandedLegalSection("privacy", (event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-semibold">Expand to read full notice</summary>
          <div className="mt-2 space-y-2">
            {ENROLLMENT_PACKET_LEGAL_TEXT.privacyPractices.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
        </details>
        <label className="flex items-start gap-2 text-sm">
          <input id="field-privacyPracticesAcknowledged" type="checkbox" checked={textValue(payload, "privacyPracticesAcknowledged") === "Acknowledged"} onChange={(event) => { setAck("privacyPracticesAcknowledged", event.target.checked); markTouched("privacyPracticesAcknowledged"); }} disabled={isPending} />
          <span>I acknowledge that I have read and received the Privacy Practices notice. <span className="text-red-600">*</span></span>
        </label>
        {fieldError("privacyPracticesAcknowledged", "Privacy Practices acknowledgement") ? <p className="text-xs text-red-600">{fieldError("privacyPracticesAcknowledged", "Privacy Practices acknowledgement")}</p> : null}
      </Section>

      <Section title="15. Statement of Rights">
        <details
          className="rounded-lg border border-border bg-slate-50 p-3 text-sm"
          open={expandedLegalSections.rights}
          onToggle={(event) => setExpandedLegalSection("rights", (event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-semibold">Expand to read full notice</summary>
          <div className="mt-2 space-y-2">
            {ENROLLMENT_PACKET_LEGAL_TEXT.statementOfRights.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
        </details>
        <label className="flex items-start gap-2 text-sm">
          <input id="field-statementOfRightsAcknowledged" type="checkbox" checked={textValue(payload, "statementOfRightsAcknowledged") === "Acknowledged"} onChange={(event) => { setAck("statementOfRightsAcknowledged", event.target.checked); markTouched("statementOfRightsAcknowledged"); }} disabled={isPending} />
          <span>I acknowledge that I have read and received the Statement of Rights notice. <span className="text-red-600">*</span></span>
        </label>
        {fieldError("statementOfRightsAcknowledged", "Statement of Rights acknowledgement") ? <p className="text-xs text-red-600">{fieldError("statementOfRightsAcknowledged", "Statement of Rights acknowledgement")}</p> : null}
      </Section>

      <Section title="16. Photo Consent">
        <details
          className="rounded-lg border border-border bg-slate-50 p-3 text-sm"
          open={expandedLegalSections.photo}
          onToggle={(event) => setExpandedLegalSection("photo", (event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-semibold">Expand to read full notice</summary>
          <div className="mt-2 space-y-2">
            {ENROLLMENT_PACKET_LEGAL_TEXT.photoConsent.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
        </details>
        <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Photo consent <span className="text-red-600">*</span></span><select id="field-photoConsentChoice" className={controlClassName("photoConsentChoice", "Photo consent")} value={textValue(payload, "photoConsentChoice")} onChange={(event) => setText("photoConsentChoice", event.target.value)} onBlur={() => markTouched("photoConsentChoice")} disabled={isPending}><option value="">Select</option><option>I do permit</option><option>I do not permit</option></select>{fieldError("photoConsentChoice", "Photo consent") ? <p className="text-xs text-red-600">{fieldError("photoConsentChoice", "Photo consent")}</p> : null}</label>
        <label className="flex items-start gap-2 text-sm"><input id="field-photoConsentAcknowledged" type="checkbox" checked={textValue(payload, "photoConsentAcknowledged") === "Acknowledged"} onChange={(event) => { setAck("photoConsentAcknowledged", event.target.checked); markTouched("photoConsentAcknowledged"); }} disabled={isPending} /><span>I acknowledge that I have read and received the Photo Consent notice. <span className="text-red-600">*</span></span></label>
        {fieldError("photoConsentAcknowledged", "Photo consent acknowledgement") ? <p className="text-xs text-red-600">{fieldError("photoConsentAcknowledged", "Photo consent acknowledgement")}</p> : null}
      </Section>

      <Section title="17. Ancillary Charges Notice">
        <details
          className="rounded-lg border border-border bg-slate-50 p-3 text-sm"
          open={expandedLegalSections.ancillary}
          onToggle={(event) => setExpandedLegalSection("ancillary", (event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-semibold">Expand to read full notice</summary>
          <div className="mt-2 space-y-2">
            {ENROLLMENT_PACKET_LEGAL_TEXT.ancillaryCharges.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
        </details>
        <label className="flex items-start gap-2 text-sm"><input id="field-ancillaryChargesAcknowledged" type="checkbox" checked={textValue(payload, "ancillaryChargesAcknowledged") === "Acknowledged"} onChange={(event) => { setAck("ancillaryChargesAcknowledged", event.target.checked); markTouched("ancillaryChargesAcknowledged"); }} disabled={isPending} /><span>I acknowledge that I have read and received the Ancillary Charges notice. <span className="text-red-600">*</span></span></label>
        {fieldError("ancillaryChargesAcknowledged", "Ancillary Charges acknowledgement") ? <p className="text-xs text-red-600">{fieldError("ancillaryChargesAcknowledged", "Ancillary Charges acknowledgement")}</p> : null}
      </Section>

      <Section title="18. Final Review">
        <div className="space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-sm">
          <p><span className="font-semibold">Member:</span> {formatEnrollmentPacketValue(`${payload.memberLegalFirstName ?? ""} ${payload.memberLegalLastName ?? ""}`)}</p>
          <p><span className="font-semibold">Primary contact:</span> {formatEnrollmentPacketValue(payload.primaryContactName)}</p>
          <p><span className="font-semibold">Photo consent:</span> {formatEnrollmentPacketValue(payload.photoConsentChoice)}</p>
        </div>
        {!completion.isComplete ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-semibold">Complete these items before signature:</p>
            <ul className="mt-1 list-disc pl-5">{completion.missingItems.map((item) => <li key={item}>{item}</li>)}</ul>
            <button type="button" className="mt-2 rounded-lg border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-900" onClick={scrollToFirstMissingField}>
              Go to first missing field
            </button>
          </div>
        ) : <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">All required fields are complete. Signature is now available.</p>}
      </Section>

      {completion.isComplete ? (
        <Section title="19. Signature">
          <p className="text-sm text-muted">Sign to complete and submit all packet sections.</p>
          <label className="block space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Typed signature name <span className="text-red-600">*</span></span><input id="field-guarantorSignatureName" className={`h-11 w-full rounded-lg border px-3 ${submitAttempted && !caregiverTypedName.trim() ? "border-red-500 bg-red-50" : "border-border"}`} value={caregiverTypedName} onChange={(event) => setCaregiverTypedName(event.target.value)} disabled={isPending} />{submitAttempted && !caregiverTypedName.trim() ? <p className="text-xs text-red-600">Typed signature name is required.</p> : null}</label>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold text-muted">Draw signature</p>
            <canvas ref={canvasRef} width={920} height={220} className="mt-2 w-full rounded-lg border border-border bg-white" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={onPointerUp} />
            <div className="mt-2 flex justify-end"><button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={clearSignature} disabled={isPending}>Clear Signature</button></div>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} className="mt-1" disabled={isPending} /><span>I attest this electronic signature is mine and I approve this enrollment packet.</span></label>
          {submitAttempted && !hasSignature ? <p className="text-xs text-red-600">Draw signature before submitting.</p> : null}
        </Section>
      ) : null}
    </>
  );
}
