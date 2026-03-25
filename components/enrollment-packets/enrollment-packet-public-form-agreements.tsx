"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";

import { buildEnrollmentPacketLegalText } from "@/lib/services/enrollment-packet-legal-text";
import { ENROLLMENT_PACKET_UPLOAD_FIELDS } from "@/lib/services/enrollment-packet-public-uploads";
import { formatEnrollmentPacketValue } from "@/lib/services/enrollment-packet-public-validation";
import type {
  EnrollmentPacketIntakeFieldKey,
  EnrollmentPacketIntakePayload,
  EnrollmentPacketIntakeTextKey
} from "@/lib/services/enrollment-packet-intake-payload";

import type { UploadState } from "@/components/enrollment-packets/enrollment-packet-public-form-types";

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

type EnrollmentPacketPublicFormAgreementsProps = {
  payload: EnrollmentPacketIntakePayload;
  isPending: boolean;
  uploads: UploadState;
  setUploads: Dispatch<SetStateAction<UploadState>>;
  markTouched: (key: EnrollmentPacketIntakeFieldKey) => void;
  fieldError: (key: EnrollmentPacketIntakeFieldKey, fallbackLabel: string) => string | null;
  controlClassName: (key: EnrollmentPacketIntakeFieldKey, fallbackLabel: string) => string;
  setText: (key: EnrollmentPacketIntakeTextKey, value: string) => void;
};

export function EnrollmentPacketPublicFormAgreements({
  payload,
  isPending,
  uploads,
  setUploads,
  markTouched,
  fieldError,
  controlClassName,
  setText
}: EnrollmentPacketPublicFormAgreementsProps) {
  const legalText = buildEnrollmentPacketLegalText({
    caregiverName: payload.membershipGuarantorSignatureName ?? payload.primaryContactName
  });

  return (
    <>
      <Section title="11. Payment & Membership Agreement">
        <div className="space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-sm">{legalText.membershipAgreement.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
        <p className="text-sm">
          <span className="font-semibold">Member:</span> {formatEnrollmentPacketValue(`${payload.memberLegalFirstName ?? ""} ${payload.memberLegalLastName ?? ""}`)}{" "}
          <span className="font-semibold">Responsible Party:</span> {formatEnrollmentPacketValue(payload.membershipGuarantorSignatureName)}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Requested start date (staff set)</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "requestedStartDate")} disabled /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Total initial enrollment amount (staff set)</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "totalInitialEnrollmentAmount")} disabled /></label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Responsible Party / Guarantor Name <span className="text-red-600">*</span></span><input id="field-membershipGuarantorSignatureName" className={controlClassName("membershipGuarantorSignatureName", "Responsible party / guarantor name")} value={textValue(payload, "membershipGuarantorSignatureName")} onChange={(event) => setText("membershipGuarantorSignatureName", event.target.value)} onBlur={() => markTouched("membershipGuarantorSignatureName")} disabled={isPending} />{fieldError("membershipGuarantorSignatureName", "Responsible party / guarantor name") ? <p className="text-xs text-red-600">{fieldError("membershipGuarantorSignatureName", "Responsible party / guarantor name")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Responsible Party / Guarantor Signature Date <span className="text-red-600">*</span></span><input id="field-membershipGuarantorSignatureDate" type="date" className={controlClassName("membershipGuarantorSignatureDate", "Responsible party / guarantor signature date")} value={textValue(payload, "membershipGuarantorSignatureDate")} onChange={(event) => setText("membershipGuarantorSignatureDate", event.target.value)} onBlur={() => markTouched("membershipGuarantorSignatureDate")} disabled={isPending} />{fieldError("membershipGuarantorSignatureDate", "Responsible party / guarantor signature date") ? <p className="text-xs text-red-600">{fieldError("membershipGuarantorSignatureDate", "Responsible party / guarantor signature date")}</p> : null}</label>
        </div>
      </Section>

      <Section title="12. Exhibit A - Payment Authorization">
        <div className="space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-sm">{legalText.exhibitAPaymentAuthorization.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
        <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Payment method <span className="text-red-600">*</span></span><select id="field-paymentMethodSelection" className={controlClassName("paymentMethodSelection", "Payment method")} value={textValue(payload, "paymentMethodSelection")} onChange={(event) => setText("paymentMethodSelection", event.target.value)} onBlur={() => markTouched("paymentMethodSelection")} disabled={isPending}><option value="">Select</option><option>ACH</option><option>Credit Card</option></select>{fieldError("paymentMethodSelection", "Payment method") ? <p className="text-xs text-red-600">{fieldError("paymentMethodSelection", "Payment method")}</p> : null}</label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Bank name <span className="text-red-600">*</span></span><input id="field-bankName" className={controlClassName("bankName", "Bank name")} value={textValue(payload, "bankName")} onChange={(event) => setText("bankName", event.target.value)} onBlur={() => markTouched("bankName")} disabled={isPending} />{fieldError("bankName", "Bank name") ? <p className="text-xs text-red-600">{fieldError("bankName", "Bank name")}</p> : null}</label>
        </div>
        {textValue(payload, "paymentMethodSelection") === "ACH" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Routing number</span><input id="field-bankAba" className={controlClassName("bankAba", "Routing number")} value={textValue(payload, "bankAba")} onChange={(event) => setText("bankAba", event.target.value)} onBlur={() => markTouched("bankAba")} disabled={isPending} />{fieldError("bankAba", "Routing number") ? <p className="text-xs text-red-600">{fieldError("bankAba", "Routing number")}</p> : null}</label>
            <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Account number</span><input id="field-bankAccountNumber" className={controlClassName("bankAccountNumber", "Account number")} value={textValue(payload, "bankAccountNumber")} onChange={(event) => setText("bankAccountNumber", event.target.value)} onBlur={() => markTouched("bankAccountNumber")} disabled={isPending} />{fieldError("bankAccountNumber", "Account number") ? <p className="text-xs text-red-600">{fieldError("bankAccountNumber", "Account number")}</p> : null}</label>
          </div>
        ) : null}
        {textValue(payload, "paymentMethodSelection") === "Credit Card" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Card number</span><input id="field-cardNumber" className={controlClassName("cardNumber", "Card number")} value={textValue(payload, "cardNumber")} onChange={(event) => setText("cardNumber", event.target.value)} onBlur={() => markTouched("cardNumber")} disabled={isPending} />{fieldError("cardNumber", "Card number") ? <p className="text-xs text-red-600">{fieldError("cardNumber", "Card number")}</p> : null}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Expiration</span><input id="field-cardExpiration" className={controlClassName("cardExpiration", "Card expiration")} value={textValue(payload, "cardExpiration")} onChange={(event) => setText("cardExpiration", event.target.value)} onBlur={() => markTouched("cardExpiration")} disabled={isPending} />{fieldError("cardExpiration", "Card expiration") ? <p className="text-xs text-red-600">{fieldError("cardExpiration", "Card expiration")}</p> : null}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">CVV</span><input id="field-cardCvv" className={controlClassName("cardCvv", "Card CVV")} value={textValue(payload, "cardCvv")} onChange={(event) => setText("cardCvv", event.target.value)} onBlur={() => markTouched("cardCvv")} disabled={isPending} />{fieldError("cardCvv", "Card CVV") ? <p className="text-xs text-red-600">{fieldError("cardCvv", "Card CVV")}</p> : null}</label>
            <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Use Primary Contact Address as Billing Address</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "cardUsePrimaryContactAddress")} onChange={(event) => setText("cardUsePrimaryContactAddress", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
            <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Billing Street Address</span><input id="field-cardBillingAddressLine1" className={controlClassName("cardBillingAddressLine1", "Card billing street address")} value={textValue(payload, "cardBillingAddressLine1")} onChange={(event) => setText("cardBillingAddressLine1", event.target.value)} onBlur={() => markTouched("cardBillingAddressLine1")} disabled={isPending || textValue(payload, "cardUsePrimaryContactAddress") === "Yes"} />{fieldError("cardBillingAddressLine1", "Card billing street address") ? <p className="text-xs text-red-600">{fieldError("cardBillingAddressLine1", "Card billing street address")}</p> : null}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Billing City / Town</span><input id="field-cardBillingCity" className={controlClassName("cardBillingCity", "Card billing city/town")} value={textValue(payload, "cardBillingCity")} onChange={(event) => setText("cardBillingCity", event.target.value)} onBlur={() => markTouched("cardBillingCity")} disabled={isPending || textValue(payload, "cardUsePrimaryContactAddress") === "Yes"} />{fieldError("cardBillingCity", "Card billing city/town") ? <p className="text-xs text-red-600">{fieldError("cardBillingCity", "Card billing city/town")}</p> : null}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Billing State</span><input id="field-cardBillingState" className={controlClassName("cardBillingState", "Card billing state")} value={textValue(payload, "cardBillingState")} onChange={(event) => setText("cardBillingState", event.target.value)} onBlur={() => markTouched("cardBillingState")} disabled={isPending || textValue(payload, "cardUsePrimaryContactAddress") === "Yes"} />{fieldError("cardBillingState", "Card billing state") ? <p className="text-xs text-red-600">{fieldError("cardBillingState", "Card billing state")}</p> : null}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Billing ZIP Code</span><input id="field-cardBillingZip" className={controlClassName("cardBillingZip", "Card billing ZIP code")} value={textValue(payload, "cardBillingZip")} onChange={(event) => setText("cardBillingZip", event.target.value)} onBlur={() => markTouched("cardBillingZip")} disabled={isPending || textValue(payload, "cardUsePrimaryContactAddress") === "Yes"} />{fieldError("cardBillingZip", "Card billing ZIP code") ? <p className="text-xs text-red-600">{fieldError("cardBillingZip", "Card billing ZIP code")}</p> : null}</label>
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Exhibit A Responsible Party / Guarantor Name <span className="text-red-600">*</span></span><input id="field-exhibitAGuarantorSignatureName" className={controlClassName("exhibitAGuarantorSignatureName", "Exhibit A responsible party / guarantor name")} value={textValue(payload, "exhibitAGuarantorSignatureName")} onChange={(event) => setText("exhibitAGuarantorSignatureName", event.target.value)} onBlur={() => markTouched("exhibitAGuarantorSignatureName")} disabled={isPending} />{fieldError("exhibitAGuarantorSignatureName", "Exhibit A responsible party / guarantor name") ? <p className="text-xs text-red-600">{fieldError("exhibitAGuarantorSignatureName", "Exhibit A responsible party / guarantor name")}</p> : null}</label>
        </div>
      </Section>

      <Section title="13. Insurance / Legal Uploads">
        <div className="grid gap-3 md:grid-cols-2">
          {ENROLLMENT_PACKET_UPLOAD_FIELDS.map((uploadField) => (
            <label key={uploadField.key} className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">{uploadField.label}</span>
              <input type="file" multiple onChange={(event) => setUploads((current) => ({ ...current, [uploadField.key]: Array.from(event.target.files ?? []) }))} disabled={isPending} />
              <p className="text-xs text-muted">{uploads[uploadField.key].length > 0 ? `${uploads[uploadField.key].length} file(s) selected` : "No files selected"}</p>
            </label>
          ))}
        </div>
      </Section>
    </>
  );
}
