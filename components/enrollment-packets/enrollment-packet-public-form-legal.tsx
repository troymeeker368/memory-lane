"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";

import { buildEnrollmentPacketLegalText } from "@/lib/services/enrollment-packet-legal-text";
import {
  ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS,
  hasEnrollmentPacketAcknowledgment
} from "@/lib/services/enrollment-packet-payment-consent";
import { ENROLLMENT_PACKET_PHOTO_CONSENT_OPTIONS } from "@/lib/services/enrollment-packet-public-options";
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
  setNoticeAcknowledgment: (
    acknowledgementId: (typeof ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS)[number]["id"],
    checked: boolean
  ) => void;
  markTouched: (key: EnrollmentPacketIntakeFieldKey) => void;
  fieldError: (key: EnrollmentPacketIntakeFieldKey, fallbackLabel: string) => string | null;
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
  setNoticeAcknowledgment,
  markTouched,
  fieldError,
  scrollToFirstMissingField,
  canvasRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  clearSignature
}: EnrollmentPacketPublicFormLegalProps) {
  const legalText = buildEnrollmentPacketLegalText({
    caregiverName: payload.membershipGuarantorSignatureName ?? payload.primaryContactName,
    memberName: [payload.memberLegalFirstName, payload.memberLegalLastName].filter(Boolean).join(" ")
  });
  const privacyAcknowledged = hasEnrollmentPacketAcknowledgment(
    payload,
    ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS[0]
  );
  const rightsAcknowledged = hasEnrollmentPacketAcknowledgment(
    payload,
    ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS[1]
  );
  const ancillaryAcknowledged = hasEnrollmentPacketAcknowledgment(
    payload,
    ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS[2]
  );

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
            {legalText.privacyPractices.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
        </details>
        <label className="flex items-start gap-2 text-sm">
          <input
            id="field-privacyAcknowledgmentSignatureName"
            type="checkbox"
            checked={privacyAcknowledged}
            onChange={(event) => setNoticeAcknowledgment("privacy", event.target.checked)}
            disabled={isPending}
          />
          <span>I acknowledge the Notice of Privacy Practices above. <span className="text-red-600">*</span></span>
        </label>
        {fieldError("privacyAcknowledgmentSignatureName", "Privacy practices acknowledgement") ? <p className="text-xs text-red-600">{fieldError("privacyAcknowledgmentSignatureName", "Privacy practices acknowledgement")}</p> : null}
      </Section>

      <Section title="15. Statement of Rights">
        <details
          className="rounded-lg border border-border bg-slate-50 p-3 text-sm"
          open={expandedLegalSections.rights}
          onToggle={(event) => setExpandedLegalSection("rights", (event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-semibold">Expand to read full notice</summary>
          <div className="mt-2 space-y-2">
            {legalText.statementOfRights.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
        </details>
        <label className="flex items-start gap-2 text-sm">
          <input
            id="field-rightsAcknowledgmentSignatureName"
            type="checkbox"
            checked={rightsAcknowledged}
            onChange={(event) => setNoticeAcknowledgment("rights", event.target.checked)}
            disabled={isPending}
          />
          <span>I acknowledge the Statement of Rights above. <span className="text-red-600">*</span></span>
        </label>
        {fieldError("rightsAcknowledgmentSignatureName", "Statement of rights acknowledgement") ? <p className="text-xs text-red-600">{fieldError("rightsAcknowledgmentSignatureName", "Statement of rights acknowledgement")}</p> : null}
      </Section>

      <Section title="16. Photo Consent">
        <details
          className="rounded-lg border border-border bg-slate-50 p-3 text-sm"
          open={expandedLegalSections.photo}
          onToggle={(event) => setExpandedLegalSection("photo", (event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-semibold">Expand to read full notice</summary>
          <div className="mt-2 space-y-2">
            {legalText.photoConsent.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
        </details>
        <fieldset id="field-photoConsentChoice" className="space-y-2">
          <legend className="text-xs font-semibold text-muted">Photo consent <span className="text-red-600">*</span></legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ENROLLMENT_PACKET_PHOTO_CONSENT_OPTIONS.map((option) => (
              <label key={option} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${textValue(payload, "photoConsentChoice") === option ? "border-brand bg-brand/5" : "border-border"}`}>
                <input
                  type="radio"
                  name="photoConsentChoice"
                  value={option}
                  checked={textValue(payload, "photoConsentChoice") === option}
                  onChange={(event) => {
                    setText("photoConsentChoice", event.target.value);
                    markTouched("photoConsentChoice");
                  }}
                  disabled={isPending}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {fieldError("photoConsentChoice", "Photo consent") ? <p className="text-xs text-red-600">{fieldError("photoConsentChoice", "Photo consent")}</p> : null}
      </Section>

      <Section title="17. Ancillary Charges Notice">
        <details
          className="rounded-lg border border-border bg-slate-50 p-3 text-sm"
          open={expandedLegalSections.ancillary}
          onToggle={(event) => setExpandedLegalSection("ancillary", (event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-semibold">Expand to read full notice</summary>
          <div className="mt-2 space-y-2">
            {legalText.ancillaryCharges.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
        </details>
        <label className="flex items-start gap-2 text-sm">
          <input
            id="field-ancillaryChargesAcknowledgmentSignatureName"
            type="checkbox"
            checked={ancillaryAcknowledged}
            onChange={(event) => setNoticeAcknowledgment("ancillary", event.target.checked)}
            disabled={isPending}
          />
          <span>I acknowledge the Ancillary Charges Notice above. <span className="text-red-600">*</span></span>
        </label>
        {fieldError("ancillaryChargesAcknowledgmentSignatureName", "Ancillary charges acknowledgement") ? <p className="text-xs text-red-600">{fieldError("ancillaryChargesAcknowledgmentSignatureName", "Ancillary charges acknowledgement")}</p> : null}
      </Section>

      {!completion.isComplete ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-semibold">Complete these required items before signing:</p>
          <ul className="mt-1 list-disc pl-5">{completion.missingItems.map((item) => <li key={item}>{item}</li>)}</ul>
          <button type="button" className="mt-2 rounded-lg border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-900" onClick={scrollToFirstMissingField}>
            Go to first missing field
          </button>
        </div>
      ) : null}

      {completion.isComplete ? (
        <Section title="18. Signature">
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
