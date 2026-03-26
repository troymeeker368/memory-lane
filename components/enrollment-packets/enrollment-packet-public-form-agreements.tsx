"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";

import { buildEnrollmentPacketLegalText } from "@/lib/services/enrollment-packet-legal-text";
import {
  ENROLLMENT_PACKET_CARD_TYPE_OPTIONS,
  ENROLLMENT_PACKET_PAYMENT_METHOD_OPTIONS,
  hasEnrollmentPacketPaymentAuthorizationAcknowledgment,
  isEnrollmentPacketAchPaymentMethod,
  isEnrollmentPacketCreditCardPaymentMethod
} from "@/lib/services/enrollment-packet-payment-consent";
import { ENROLLMENT_PACKET_UPLOAD_FIELDS } from "@/lib/services/enrollment-packet-public-uploads";
import { formatEnrollmentPacketValue } from "@/lib/services/enrollment-packet-public-validation";
import type {
  EnrollmentPacketIntakeFieldKey,
  EnrollmentPacketIntakePayload,
  EnrollmentPacketIntakeTextKey
} from "@/lib/services/enrollment-packet-intake-payload";

import type { UploadState } from "@/components/enrollment-packets/enrollment-packet-public-form-types";

function formatMembershipAgreementParagraph(line: string) {
  const text = line.trim();
  if (!text) return <p>{"\u00A0"}</p>;

  const isAllCaps =
    text === text.toUpperCase() &&
    /[A-Z]{2,}/.test(text) &&
    !/[a-z]/.test(text) &&
    !/^\d/.test(text);
  const colonIndex = text.indexOf(":");
  const looksLikeTitle = isAllCaps || /^[A-Z][A-Z0-9 ,&/.'’()_-]{2,}:?$/.test(text);

  if (looksLikeTitle) {
    return (
      <p className="font-semibold tracking-wide text-slate-900">
        {text}
      </p>
    );
  }

  if (colonIndex > 0) {
    const label = text.slice(0, colonIndex).trim();
    return (
      <p className="leading-relaxed text-slate-700">
        <span className="font-semibold text-slate-900">{label}:</span>
        {" "}
        {text.slice(colonIndex + 1).trimStart()}
      </p>
    );
  }

  return <p className="leading-relaxed text-slate-700">{text}</p>;
}

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
  setPaymentAuthorizationAcknowledgment: (checked: boolean) => void;
};

export function EnrollmentPacketPublicFormAgreements({
  payload,
  isPending,
  uploads,
  setUploads,
  markTouched,
  fieldError,
  controlClassName,
  setText,
  setPaymentAuthorizationAcknowledgment
}: EnrollmentPacketPublicFormAgreementsProps) {
  const paymentMethodSelection = textValue(payload, "paymentMethodSelection");
  const isAchSelected = isEnrollmentPacketAchPaymentMethod(paymentMethodSelection);
  const isCreditCardSelected = isEnrollmentPacketCreditCardPaymentMethod(paymentMethodSelection);
  const paymentAuthorizationAcknowledged = hasEnrollmentPacketPaymentAuthorizationAcknowledgment(payload);
  const legalText = buildEnrollmentPacketLegalText({
    caregiverName: payload.membershipGuarantorSignatureName ?? payload.primaryContactName,
    memberName: [payload.memberLegalFirstName, payload.memberLegalLastName].filter(Boolean).join(" "),
    membershipSignatureName: payload.membershipGuarantorSignatureName,
    membershipSignatureDate: payload.membershipGuarantorSignatureDate,
    paymentMethodSelection,
    communityFee: payload.communityFee,
    totalInitialEnrollmentAmount: payload.totalInitialEnrollmentAmount,
    photoConsentChoice: payload.photoConsentChoice
  });

  return (
    <>
      <Section title="11. Payment & Membership Agreement">
        <div className="space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-sm">
          {legalText.membershipAgreement.map((paragraph, index) => (
            <div key={`${paragraph}-${index}`}>{formatMembershipAgreementParagraph(paragraph)}</div>
          ))}
        </div>
        {legalText.membershipAgreementExecution.length > 0 ? (
          <div className="space-y-1 rounded-lg border border-border bg-slate-50 p-3 text-sm">
            {legalText.membershipAgreementExecution.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ) : null}
        <p className="text-sm">
          <span className="font-semibold">Member:</span> {formatEnrollmentPacketValue(`${payload.memberLegalFirstName ?? ""} ${payload.memberLegalLastName ?? ""}`)}{" "}
          <span className="font-semibold">Responsible Party:</span> {formatEnrollmentPacketValue(payload.membershipGuarantorSignatureName)}
        </p>
        <div className="grid gap-3 md:grid-cols-1">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Requested start date (staff set)</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "requestedStartDate")} disabled /></label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Responsible Party / Guarantor Signature <span className="text-red-600">*</span></span><input id="field-membershipGuarantorSignatureName" className={controlClassName("membershipGuarantorSignatureName", "Responsible party / guarantor signature")} value={textValue(payload, "membershipGuarantorSignatureName")} onChange={(event) => setText("membershipGuarantorSignatureName", event.target.value)} onBlur={() => markTouched("membershipGuarantorSignatureName")} placeholder="Type full legal name to sign the Membership Agreement" disabled={isPending} />{fieldError("membershipGuarantorSignatureName", "Responsible party / guarantor signature") ? <p className="text-xs text-red-600">{fieldError("membershipGuarantorSignatureName", "Responsible party / guarantor signature")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Membership Agreement Signature Date <span className="text-red-600">*</span></span><input id="field-membershipGuarantorSignatureDate" type="date" className={controlClassName("membershipGuarantorSignatureDate", "Membership Agreement signature date")} value={textValue(payload, "membershipGuarantorSignatureDate")} onChange={(event) => setText("membershipGuarantorSignatureDate", event.target.value)} onBlur={() => markTouched("membershipGuarantorSignatureDate")} disabled={isPending} />{fieldError("membershipGuarantorSignatureDate", "Membership Agreement signature date") ? <p className="text-xs text-red-600">{fieldError("membershipGuarantorSignatureDate", "Membership Agreement signature date")}</p> : null}</label>
        </div>
      </Section>

      <Section title="12. Exhibit A - Payment Authorization">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Daily center fee (staff set)</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "membershipDailyAmount")} disabled /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Community fee (staff set)</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "communityFee")} disabled /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Total initial enrollment amount (staff set)</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "totalInitialEnrollmentAmount")} disabled /></label>
        </div>
        <div className="space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-sm">{legalText.exhibitAPaymentAuthorizationCommon.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
        <fieldset id="field-paymentMethodSelection" className="space-y-2">
          <legend className="text-xs font-semibold text-muted">Payment method <span className="text-red-600">*</span></legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ENROLLMENT_PACKET_PAYMENT_METHOD_OPTIONS.map((option) => (
              <label key={option} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${paymentMethodSelection === option ? "border-brand bg-brand/5" : "border-border"}`}>
                <input
                  type="radio"
                  name="paymentMethodSelection"
                  value={option}
                  checked={paymentMethodSelection === option}
                  onChange={(event) => {
                    setText("paymentMethodSelection", event.target.value);
                    markTouched("paymentMethodSelection");
                  }}
                  disabled={isPending}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {fieldError("paymentMethodSelection", "Payment method") ? <p className="text-xs text-red-600">{fieldError("paymentMethodSelection", "Payment method")}</p> : null}
        {legalText.exhibitAPaymentAuthorizationSelected.length > 0 ? (
          <div className="space-y-3 rounded-lg border border-border bg-slate-50 p-3 text-sm">
            {legalText.exhibitAPaymentAuthorizationSelected.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            <label className="flex items-start gap-2 text-sm">
              <input
                id="field-exhibitAGuarantorSignatureName"
                type="checkbox"
                checked={paymentAuthorizationAcknowledged}
                onChange={(event) => setPaymentAuthorizationAcknowledgment(event.target.checked)}
                disabled={isPending}
              />
              <span>{isAchSelected ? "I acknowledge the ACH authorization terms above." : "I acknowledge the credit card authorization terms above."} <span className="text-red-600">*</span></span>
            </label>
            {isAchSelected && fieldError("exhibitAGuarantorSignatureName", "ACH authorization acknowledgement") ? <p className="text-xs text-red-600">{fieldError("exhibitAGuarantorSignatureName", "ACH authorization acknowledgement")}</p> : null}
            {isCreditCardSelected && fieldError("exhibitAGuarantorSignatureName", "Credit card authorization acknowledgement") ? <p className="text-xs text-red-600">{fieldError("exhibitAGuarantorSignatureName", "Credit card authorization acknowledgement")}</p> : null}
          </div>
        ) : null}
        {isAchSelected ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Bank name <span className="text-red-600">*</span></span><input id="field-bankName" className={controlClassName("bankName", "Bank name")} value={textValue(payload, "bankName")} onChange={(event) => setText("bankName", event.target.value)} onBlur={() => markTouched("bankName")} disabled={isPending} />{fieldError("bankName", "Bank name") ? <p className="text-xs text-red-600">{fieldError("bankName", "Bank name")}</p> : null}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Routing number <span className="text-red-600">*</span></span><input id="field-bankAba" className={controlClassName("bankAba", "Routing number")} value={textValue(payload, "bankAba")} onChange={(event) => setText("bankAba", event.target.value)} onBlur={() => markTouched("bankAba")} disabled={isPending} />{fieldError("bankAba", "Routing number") ? <p className="text-xs text-red-600">{fieldError("bankAba", "Routing number")}</p> : null}</label>
            <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Bank city / state / ZIP <span className="text-red-600">*</span></span><input id="field-bankCityStateZip" className={controlClassName("bankCityStateZip", "Bank city/state/ZIP")} value={textValue(payload, "bankCityStateZip")} onChange={(event) => setText("bankCityStateZip", event.target.value)} onBlur={() => markTouched("bankCityStateZip")} disabled={isPending} />{fieldError("bankCityStateZip", "Bank city/state/ZIP") ? <p className="text-xs text-red-600">{fieldError("bankCityStateZip", "Bank city/state/ZIP")}</p> : null}</label>
            <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Account number <span className="text-red-600">*</span></span><input id="field-bankAccountNumber" className={controlClassName("bankAccountNumber", "Account number")} value={textValue(payload, "bankAccountNumber")} onChange={(event) => setText("bankAccountNumber", event.target.value)} onBlur={() => markTouched("bankAccountNumber")} disabled={isPending} />{fieldError("bankAccountNumber", "Account number") ? <p className="text-xs text-red-600">{fieldError("bankAccountNumber", "Account number")}</p> : null}</label>
          </div>
        ) : null}
        {isCreditCardSelected ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Cardholder name <span className="text-red-600">*</span></span><input id="field-cardholderName" className={controlClassName("cardholderName", "Cardholder name")} value={textValue(payload, "cardholderName")} onChange={(event) => setText("cardholderName", event.target.value)} onBlur={() => markTouched("cardholderName")} disabled={isPending} />{fieldError("cardholderName", "Cardholder name") ? <p className="text-xs text-red-600">{fieldError("cardholderName", "Cardholder name")}</p> : null}</label>
            <fieldset id="field-cardType" className="space-y-2 md:col-span-2">
              <legend className="text-xs font-semibold text-muted">Card type <span className="text-red-600">*</span></legend>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {ENROLLMENT_PACKET_CARD_TYPE_OPTIONS.map((option) => (
                  <label key={option} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${textValue(payload, "cardType") === option ? "border-brand bg-brand/5" : "border-border"}`}>
                    <input type="radio" name="cardType" value={option} checked={textValue(payload, "cardType") === option} onChange={(event) => { setText("cardType", event.target.value); markTouched("cardType"); }} disabled={isPending} />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
              {fieldError("cardType", "Card type") ? <p className="text-xs text-red-600">{fieldError("cardType", "Card type")}</p> : null}
            </fieldset>
            <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Card number <span className="text-red-600">*</span></span><input id="field-cardNumber" className={controlClassName("cardNumber", "Card number")} value={textValue(payload, "cardNumber")} onChange={(event) => setText("cardNumber", event.target.value)} onBlur={() => markTouched("cardNumber")} disabled={isPending} />{fieldError("cardNumber", "Card number") ? <p className="text-xs text-red-600">{fieldError("cardNumber", "Card number")}</p> : null}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Expiration <span className="text-red-600">*</span></span><input id="field-cardExpiration" className={controlClassName("cardExpiration", "Card expiration")} value={textValue(payload, "cardExpiration")} onChange={(event) => setText("cardExpiration", event.target.value)} onBlur={() => markTouched("cardExpiration")} disabled={isPending} />{fieldError("cardExpiration", "Card expiration") ? <p className="text-xs text-red-600">{fieldError("cardExpiration", "Card expiration")}</p> : null}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">CVV <span className="text-red-600">*</span></span><input id="field-cardCvv" className={controlClassName("cardCvv", "Card CVV")} value={textValue(payload, "cardCvv")} onChange={(event) => setText("cardCvv", event.target.value)} onBlur={() => markTouched("cardCvv")} disabled={isPending} />{fieldError("cardCvv", "Card CVV") ? <p className="text-xs text-red-600">{fieldError("cardCvv", "Card CVV")}</p> : null}</label>
            <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Use Primary Contact Address as Billing Address</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "cardUsePrimaryContactAddress")} onChange={(event) => setText("cardUsePrimaryContactAddress", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
            <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Billing Street Address <span className="text-red-600">*</span></span><input id="field-cardBillingAddressLine1" className={controlClassName("cardBillingAddressLine1", "Card billing street address")} value={textValue(payload, "cardBillingAddressLine1")} onChange={(event) => setText("cardBillingAddressLine1", event.target.value)} onBlur={() => markTouched("cardBillingAddressLine1")} disabled={isPending || textValue(payload, "cardUsePrimaryContactAddress") === "Yes"} />{fieldError("cardBillingAddressLine1", "Card billing street address") ? <p className="text-xs text-red-600">{fieldError("cardBillingAddressLine1", "Card billing street address")}</p> : null}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Billing City / Town <span className="text-red-600">*</span></span><input id="field-cardBillingCity" className={controlClassName("cardBillingCity", "Card billing city/town")} value={textValue(payload, "cardBillingCity")} onChange={(event) => setText("cardBillingCity", event.target.value)} onBlur={() => markTouched("cardBillingCity")} disabled={isPending || textValue(payload, "cardUsePrimaryContactAddress") === "Yes"} />{fieldError("cardBillingCity", "Card billing city/town") ? <p className="text-xs text-red-600">{fieldError("cardBillingCity", "Card billing city/town")}</p> : null}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Billing State <span className="text-red-600">*</span></span><input id="field-cardBillingState" className={controlClassName("cardBillingState", "Card billing state")} value={textValue(payload, "cardBillingState")} onChange={(event) => setText("cardBillingState", event.target.value)} onBlur={() => markTouched("cardBillingState")} disabled={isPending || textValue(payload, "cardUsePrimaryContactAddress") === "Yes"} />{fieldError("cardBillingState", "Card billing state") ? <p className="text-xs text-red-600">{fieldError("cardBillingState", "Card billing state")}</p> : null}</label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Billing ZIP Code <span className="text-red-600">*</span></span><input id="field-cardBillingZip" className={controlClassName("cardBillingZip", "Card billing ZIP code")} value={textValue(payload, "cardBillingZip")} onChange={(event) => setText("cardBillingZip", event.target.value)} onBlur={() => markTouched("cardBillingZip")} disabled={isPending || textValue(payload, "cardUsePrimaryContactAddress") === "Yes"} />{fieldError("cardBillingZip", "Card billing ZIP code") ? <p className="text-xs text-red-600">{fieldError("cardBillingZip", "Card billing ZIP code")}</p> : null}</label>
          </div>
        ) : null}
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
