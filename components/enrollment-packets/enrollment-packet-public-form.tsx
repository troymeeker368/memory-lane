"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";

import {
  savePublicEnrollmentPacketProgressAction,
  submitPublicEnrollmentPacketAction
} from "@/app/sign/enrollment-packet/[token]/actions";
import { formatPhoneInput } from "@/lib/phone";
import {
  ENROLLMENT_PACKET_ADL_SUPPORT_OPTIONS,
  ENROLLMENT_PACKET_BEHAVIORAL_OPTIONS,
  ENROLLMENT_PACKET_LEGAL_TEXT,
  ENROLLMENT_PACKET_LIVING_SITUATION_OPTIONS,
  ENROLLMENT_PACKET_RECREATIONAL_INTEREST_OPTIONS,
  ENROLLMENT_PACKET_UPLOAD_FIELDS,
  formatEnrollmentPacketValue,
  validateEnrollmentPacketCompletion
} from "@/lib/services/enrollment-packet-public-schema";
import {
  normalizeEnrollmentPacketIntakePayload,
  type EnrollmentPacketIntakeArrayKey,
  type EnrollmentPacketIntakeFieldKey,
  type EnrollmentPacketIntakePayload,
  type EnrollmentPacketIntakeTextKey
} from "@/lib/services/enrollment-packet-intake-payload";

type PublicEnrollmentPacketFields = {
  requestedDays: string[];
  transportation: string | null;
  communityFee: number;
  dailyRate: number;
  caregiverName: string | null;
  caregiverPhone: string | null;
  caregiverEmail: string | null;
  caregiverAddressLine1: string | null;
  caregiverAddressLine2: string | null;
  caregiverCity: string | null;
  caregiverState: string | null;
  caregiverZip: string | null;
  secondaryContactName: string | null;
  secondaryContactPhone: string | null;
  secondaryContactEmail: string | null;
  secondaryContactRelationship: string | null;
  notes: string | null;
  intakePayload: EnrollmentPacketIntakePayload;
};

type UploadKey = (typeof ENROLLMENT_PACKET_UPLOAD_FIELDS)[number]["key"];
type UploadState = Record<UploadKey, File[]>;

function emptyUploadState(): UploadState {
  return ENROLLMENT_PACKET_UPLOAD_FIELDS.reduce((acc, definition) => {
    acc[definition.key] = [];
    return acc;
  }, {} as UploadState);
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function toInitialPayload(fields: PublicEnrollmentPacketFields): EnrollmentPacketIntakePayload {
  return normalizeEnrollmentPacketIntakePayload({
    ...fields.intakePayload,
    requestedAttendanceDays: fields.requestedDays,
    membershipRequestedWeekdays: fields.requestedDays,
    transportationPreference: fields.transportation,
    transportationQuestionEnabled: fields.transportation ? "Yes" : "No",
    primaryContactName: fields.intakePayload.primaryContactName ?? fields.caregiverName,
    primaryContactPhone: fields.intakePayload.primaryContactPhone ?? fields.caregiverPhone,
    primaryContactEmail: fields.intakePayload.primaryContactEmail ?? fields.caregiverEmail,
    primaryContactAddress: fields.intakePayload.primaryContactAddress ?? fields.caregiverAddressLine1,
    secondaryContactName: fields.intakePayload.secondaryContactName ?? fields.secondaryContactName,
    secondaryContactPhone: fields.intakePayload.secondaryContactPhone ?? fields.secondaryContactPhone,
    secondaryContactEmail: fields.intakePayload.secondaryContactEmail ?? fields.secondaryContactEmail,
    secondaryContactRelationship: fields.intakePayload.secondaryContactRelationship ?? fields.secondaryContactRelationship,
    memberAddressLine1: fields.intakePayload.memberAddressLine1 ?? fields.caregiverAddressLine1,
    memberAddressLine2: fields.intakePayload.memberAddressLine2 ?? fields.caregiverAddressLine2,
    memberCity: fields.intakePayload.memberCity ?? fields.caregiverCity,
    memberState: fields.intakePayload.memberState ?? fields.caregiverState,
    memberZip: fields.intakePayload.memberZip ?? fields.caregiverZip,
    membershipDailyAmount:
      fields.intakePayload.membershipDailyAmount ?? (fields.dailyRate > 0 ? fields.dailyRate.toFixed(2) : null),
    communityFee: fields.intakePayload.communityFee ?? (fields.communityFee > 0 ? fields.communityFee.toFixed(2) : null),
    additionalNotes: fields.intakePayload.additionalNotes ?? fields.notes
  });
}

function applySignatureDefaults(payload: EnrollmentPacketIntakePayload, typedName: string) {
  const signatureDate = todayDateString();
  const normalizedName = typedName.trim();
  if (!normalizedName) return payload;

  const patch: Partial<Record<EnrollmentPacketIntakeFieldKey, string | string[] | null>> = {
    guarantorSignatureName: payload.guarantorSignatureName ?? normalizedName,
    guarantorSignatureDate: payload.guarantorSignatureDate ?? signatureDate,
    privacyAcknowledgmentSignatureName: payload.privacyAcknowledgmentSignatureName ?? normalizedName,
    privacyAcknowledgmentSignatureDate: payload.privacyAcknowledgmentSignatureDate ?? signatureDate,
    rightsAcknowledgmentSignatureName: payload.rightsAcknowledgmentSignatureName ?? normalizedName,
    rightsAcknowledgmentSignatureDate: payload.rightsAcknowledgmentSignatureDate ?? signatureDate,
    ancillaryChargesAcknowledgmentSignatureName:
      payload.ancillaryChargesAcknowledgmentSignatureName ?? normalizedName,
    ancillaryChargesAcknowledgmentSignatureDate:
      payload.ancillaryChargesAcknowledgmentSignatureDate ?? signatureDate,
    photoConsentAcknowledgmentName: payload.photoConsentAcknowledgmentName ?? normalizedName
  };

  return normalizeEnrollmentPacketIntakePayload({ ...payload, ...patch });
}

function textValue(payload: EnrollmentPacketIntakePayload, key: EnrollmentPacketIntakeTextKey) {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function arrayValue(payload: EnrollmentPacketIntakePayload, key: EnrollmentPacketIntakeArrayKey) {
  const value = payload[key];
  return Array.isArray(value) ? value : [];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function EnrollmentPacketPublicForm({
  token,
  fields
}: {
  token: string;
  fields: PublicEnrollmentPacketFields;
}) {
  const [payload, setPayload] = useState<EnrollmentPacketIntakePayload>(() => toInitialPayload(fields));
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [attested, setAttested] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [caregiverTypedName, setCaregiverTypedName] = useState(payload.primaryContactName ?? "");
  const [uploads, setUploads] = useState<UploadState>(() => emptyUploadState());

  const showTransportationQuestion =
    payload.transportationQuestionEnabled?.toLowerCase() === "yes" ||
    payload.transportationQuestionEnabled?.toLowerCase() === "true" ||
    Boolean(fields.transportation);

  const completion = useMemo(
    () =>
      validateEnrollmentPacketCompletion({
        payload,
        showTransportationQuestion
      }),
    [payload, showTransportationQuestion]
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const strokeStartedRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#1f2937";
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
  }, []);

  const setText = (key: EnrollmentPacketIntakeTextKey, value: string) => {
    setPayload((current) => normalizeEnrollmentPacketIntakePayload({ ...current, [key]: value }));
  };

  const setAck = (key: EnrollmentPacketIntakeTextKey, checked: boolean) => {
    setText(key, checked ? "Acknowledged" : "");
  };

  const toggleArray = (key: EnrollmentPacketIntakeArrayKey, option: string, checked: boolean) => {
    setPayload((current) => {
      const selected = new Set(arrayValue(current, key));
      if (checked) selected.add(option);
      else selected.delete(option);
      return normalizeEnrollmentPacketIntakePayload({ ...current, [key]: Array.from(selected) });
    });
  };

  const appendCommonFields = (formData: FormData, sourcePayload: EnrollmentPacketIntakePayload) => {
    formData.set("token", token);
    formData.set("intakePayload", JSON.stringify(sourcePayload));
    formData.set("caregiverName", sourcePayload.primaryContactName ?? "");
    formData.set("caregiverPhone", sourcePayload.primaryContactPhone ?? "");
    formData.set("caregiverEmail", sourcePayload.primaryContactEmail ?? "");
    formData.set("primaryContactAddress", sourcePayload.primaryContactAddress ?? "");
    formData.set("caregiverAddressLine1", sourcePayload.memberAddressLine1 ?? "");
    formData.set("caregiverAddressLine2", sourcePayload.memberAddressLine2 ?? "");
    formData.set("caregiverCity", sourcePayload.memberCity ?? "");
    formData.set("caregiverState", sourcePayload.memberState ?? "");
    formData.set("caregiverZip", sourcePayload.memberZip ?? "");
    formData.set("secondaryContactName", sourcePayload.secondaryContactName ?? "");
    formData.set("secondaryContactPhone", sourcePayload.secondaryContactPhone ?? "");
    formData.set("secondaryContactEmail", sourcePayload.secondaryContactEmail ?? "");
    formData.set("secondaryContactRelationship", sourcePayload.secondaryContactRelationship ?? "");
    formData.set("secondaryContactAddress", sourcePayload.secondaryContactAddress ?? "");
    formData.set("notes", sourcePayload.additionalNotes ?? "");
  };

  const saveProgress = () => {
    setStatus(null);
    startTransition(async () => {
      const formData = new FormData();
      appendCommonFields(formData, payload);
      const result = await savePublicEnrollmentPacketProgressAction(formData);
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      setStatus("Progress saved.");
    });
  };

  const submitPacket = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!completion.isComplete) {
      setStatus(`Complete required fields before signing: ${completion.missingItems.join(", ")}.`);
      return;
    }
    if (!caregiverTypedName.trim()) {
      setStatus("Typed caregiver signature name is required.");
      return;
    }
    if (!hasSignature) {
      setStatus("Please draw your signature before submitting.");
      return;
    }
    if (!attested) {
      setStatus("Please confirm signature attestation before submitting.");
      return;
    }

    const signatureImageDataUrl = canvas.toDataURL("image/png");
    const payloadToSubmit = applySignatureDefaults(payload, caregiverTypedName);
    setStatus(null);

    startTransition(async () => {
      const formData = new FormData();
      appendCommonFields(formData, payloadToSubmit);
      formData.set("caregiverTypedName", caregiverTypedName);
      formData.set("caregiverSignatureImageDataUrl", signatureImageDataUrl);
      formData.set("attested", "true");

      ENROLLMENT_PACKET_UPLOAD_FIELDS.forEach((uploadField) => {
        uploads[uploadField.key].forEach((file) => formData.append(uploadField.key, file));
      });

      const result = await submitPublicEnrollmentPacketAction(formData);
      if (!result.ok) {
        setStatus(result.error);
        return;
      }

      setPayload(payloadToSubmit);
      setIsSubmitted(true);
      setStatus("Enrollment packet submitted successfully.");
    });
  };

  const getCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const point = getCanvasPoint(event);
    if (!canvas || !context || !point) return;
    drawingRef.current = true;
    strokeStartedRef.current = false;
    context.beginPath();
    context.moveTo(point.x, point.y);
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext("2d");
    const point = getCanvasPoint(event);
    if (!context || !point) return;
    context.lineTo(point.x, point.y);
    context.stroke();
    strokeStartedRef.current = true;
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawingRef.current = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (strokeStartedRef.current) setHasSignature(true);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  if (isSubmitted) {
    return (
      <div className="space-y-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
        <h3 className="text-base font-semibold text-emerald-900">Enrollment Packet Submitted</h3>
        <p className="text-sm text-emerald-800">
          Thank you for completing the enrollment packet. Your information was submitted successfully.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-slate-50 p-3 text-sm">
        <p><span className="font-semibold">Requested days:</span> {fields.requestedDays.length > 0 ? fields.requestedDays.join(", ") : "-"}</p>
        <p><span className="font-semibold">Daily rate:</span> ${fields.dailyRate.toFixed(2)}</p>
        <p><span className="font-semibold">Community fee:</span> ${fields.communityFee.toFixed(2)}</p>
      </div>

      <Section title="1. Member Demographics">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">First name</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "memberLegalFirstName")} onChange={(event) => setText("memberLegalFirstName", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Last name</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "memberLegalLastName")} onChange={(event) => setText("memberLegalLastName", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">DOB</span><input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "memberDob")} onChange={(event) => setText("memberDob", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Gender</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "memberGender")} onChange={(event) => setText("memberGender", event.target.value)} disabled={isPending}><option value="">Select</option><option>Male</option><option>Female</option><option>Non-binary</option><option>Prefer not to say</option></select></label>
          <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Address</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "memberAddressLine1")} onChange={(event) => setText("memberAddressLine1", event.target.value)} disabled={isPending} /></label>
        </div>
      </Section>

      <Section title="2. Primary Contact">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Name</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "primaryContactName")} onChange={(event) => setText("primaryContactName", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Relationship</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "primaryContactRelationship")} onChange={(event) => setText("primaryContactRelationship", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Phone</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "primaryContactPhone")} onChange={(event) => setText("primaryContactPhone", formatPhoneInput(event.target.value))} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Email</span><input type="email" className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "primaryContactEmail")} onChange={(event) => setText("primaryContactEmail", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Address</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "primaryContactAddress")} onChange={(event) => setText("primaryContactAddress", event.target.value)} disabled={isPending} /></label>
        </div>
      </Section>

      <Section title="3. Secondary Contact">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Name</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "secondaryContactName")} onChange={(event) => setText("secondaryContactName", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Relationship</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "secondaryContactRelationship")} onChange={(event) => setText("secondaryContactRelationship", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Phone</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "secondaryContactPhone")} onChange={(event) => setText("secondaryContactPhone", formatPhoneInput(event.target.value))} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Email</span><input type="email" className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "secondaryContactEmail")} onChange={(event) => setText("secondaryContactEmail", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Address</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "secondaryContactAddress")} onChange={(event) => setText("secondaryContactAddress", event.target.value)} disabled={isPending} /></label>
        </div>
      </Section>

      <Section title="4. Living Situation">
        <div className="grid gap-2 rounded-lg border border-border bg-slate-50 p-3 sm:grid-cols-2">
          {ENROLLMENT_PACKET_LIVING_SITUATION_OPTIONS.map((option) => (
            <label key={option} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={arrayValue(payload, "livingSituationOptions").includes(option)} onChange={(event) => toggleArray("livingSituationOptions", option, event.target.checked)} disabled={isPending} />
              <span>{option}</span>
            </label>
          ))}
        </div>
        <p className="text-xs font-semibold text-muted">Pets</p>
        <div className="grid gap-2 rounded-lg border border-border bg-slate-50 p-3 sm:grid-cols-3">
          {["Dogs", "Cats", "Other"].map((option) => (
            <label key={option} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={arrayValue(payload, "petTypes").includes(option)} onChange={(event) => toggleArray("petTypes", option, event.target.checked)} disabled={isPending} />
              <span>{option}</span>
            </label>
          ))}
        </div>
        {arrayValue(payload, "petTypes").length > 0 ? <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Pet names</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "petNames")} onChange={(event) => setText("petNames", event.target.value)} disabled={isPending} /></label> : null}
      </Section>

      <Section title="5. Medical Information">
        <div className="grid gap-3 md:grid-cols-2">
          {showTransportationQuestion ? (
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Transportation needed</span>
              <select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "transportationPreference")} onChange={(event) => setText("transportationPreference", event.target.value)} disabled={isPending}>
                <option value="">Select</option>
                <option>Door to Door</option>
                <option>Bus Stop</option>
                <option>No Transportation</option>
              </select>
            </label>
          ) : null}
          <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Referred by</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "referredBy")} onChange={(event) => setText("referredBy", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">VA Benefits</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "veteranStatus")} onChange={(event) => setText("veteranStatus", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
          {textValue(payload, "veteranStatus") === "Yes" ? <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Tricare Number</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "tricareNumber")} onChange={(event) => setText("tricareNumber", event.target.value)} disabled={isPending} /></label> : null}
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Medication Needed During the Day</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "medicationNeededDuringDay")} onChange={(event) => setText("medicationNeededDuringDay", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
          {textValue(payload, "medicationNeededDuringDay") === "Yes" ? <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Medication Names</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "medicationNamesDuringDay")} onChange={(event) => setText("medicationNamesDuringDay", event.target.value)} disabled={isPending} /></label> : null}
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Uses Oxygen Daily</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "oxygenUse")} onChange={(event) => setText("oxygenUse", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
          {textValue(payload, "oxygenUse") === "Yes" ? <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Oxygen Flow Rate</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "oxygenFlowRate")} onChange={(event) => setText("oxygenFlowRate", event.target.value)} disabled={isPending} /></label> : null}
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">History of Falls</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "fallsHistory")} onChange={(event) => setText("fallsHistory", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
          {textValue(payload, "fallsHistory") === "Yes" ? <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Any falls within the last 3 months?</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "fallsWithinLast3Months")} onChange={(event) => setText("fallsWithinLast3Months", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label> : null}
        </div>
      </Section>

      <Section title="6. Functional Status / ADLs">
        <div className="grid gap-3 md:grid-cols-2">
          {(["adlMobilityLevel", "adlToiletingLevel", "adlBathingLevel", "adlDressingLevel", "adlEatingLevel", "adlContinenceLevel"] as EnrollmentPacketIntakeTextKey[]).map((key) => (
            <label key={key} className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">{key}</span>
              <select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, key)} onChange={(event) => setText(key, event.target.value)} disabled={isPending}><option value="">Select</option>{ENROLLMENT_PACKET_ADL_SUPPORT_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select>
            </label>
          ))}
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Does the participant wear dentures?</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "dentures")} onChange={(event) => setText("dentures", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Hearing</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "hearingStatus")} onChange={(event) => setText("hearingStatus", event.target.value)} disabled={isPending}><option value="">Select</option><option>Normal hearing</option><option>Hearing aids</option></select></label>
        </div>
        {textValue(payload, "dentures") === "Yes" ? (
          <div className="grid gap-2 rounded-lg border border-border bg-slate-50 p-3 sm:grid-cols-2">
            {["Upper", "Lower"].map((option) => (
              <label key={option} className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={arrayValue(payload, "dentureTypes").includes(option)} onChange={(event) => toggleArray("dentureTypes", option, event.target.checked)} disabled={isPending} />
                <span>{option}</span>
              </label>
            ))}
          </div>
        ) : null}
      </Section>

      <Section title="7. Behavioral & Cognitive Status">
        <div className="grid gap-2 rounded-lg border border-border bg-slate-50 p-3 sm:grid-cols-2">
          {ENROLLMENT_PACKET_BEHAVIORAL_OPTIONS.map((option) => (
            <label key={option} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={arrayValue(payload, "behavioralObservations").includes(option)} onChange={(event) => toggleArray("behavioralObservations", option, event.target.checked)} disabled={isPending} />
              <span>{option}</span>
            </label>
          ))}
        </div>
        <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Memory stage</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "memoryStage")} onChange={(event) => setText("memoryStage", event.target.value)} disabled={isPending}><option value="">Select</option><option>No Cognitive Impairment</option><option>Mild</option><option>Moderate</option><option>Severe</option></select></label>
      </Section>
      <Section title="8. Recreation Interests">
        <div className="grid gap-2 rounded-lg border border-border bg-slate-50 p-3 sm:grid-cols-2">
          {ENROLLMENT_PACKET_RECREATIONAL_INTEREST_OPTIONS.map((option) => (
            <label key={option} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={arrayValue(payload, "recreationalInterests").includes(option)} onChange={(event) => toggleArray("recreationalInterests", option, event.target.checked)} disabled={isPending} />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="9. Veteran Status">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Is the participant a veteran?</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "veteranStatus")} onChange={(event) => setText("veteranStatus", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
          {textValue(payload, "veteranStatus") === "Yes" ? <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Branch of service</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "branchOfService")} onChange={(event) => setText("branchOfService", event.target.value)} disabled={isPending} /></label> : null}
        </div>
      </Section>

      <Section title="10. PCP & Pharmacy">
        <p className="text-sm text-muted">Please provide both pharmacy name and pharmacy address.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">PCP Name</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "pcpName")} onChange={(event) => setText("pcpName", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">PCP Address</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "pcpAddress")} onChange={(event) => setText("pcpAddress", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">PCP Phone</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "pcpPhone")} onChange={(event) => setText("pcpPhone", formatPhoneInput(event.target.value))} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Pharmacy Name</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "pharmacy")} onChange={(event) => setText("pharmacy", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Pharmacy Address</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "pharmacyAddress")} onChange={(event) => setText("pharmacyAddress", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Pharmacy Phone</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "pharmacyPhone")} onChange={(event) => setText("pharmacyPhone", formatPhoneInput(event.target.value))} disabled={isPending} /></label>
        </div>
      </Section>

      <Section title="11. Payment & Membership Agreement">
        <div className="space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-sm">{ENROLLMENT_PACKET_LEGAL_TEXT.membershipAgreement.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Requested start date (staff set)</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "requestedStartDate")} disabled /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Total initial enrollment amount (staff set)</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "totalInitialEnrollmentAmount")} disabled /></label>
        </div>
      </Section>
      <Section title="12. Exhibit A - Payment Authorization">
        <div className="space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-sm">{ENROLLMENT_PACKET_LEGAL_TEXT.exhibitAPaymentAuthorization.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
        <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Payment method</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "paymentMethodSelection")} onChange={(event) => setText("paymentMethodSelection", event.target.value)} disabled={isPending}><option value="">Select</option><option>ACH</option><option>Credit Card</option></select></label>
        {textValue(payload, "paymentMethodSelection") === "ACH" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Bank name</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "bankName")} onChange={(event) => setText("bankName", event.target.value)} disabled={isPending} /></label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Routing number</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "bankAba")} onChange={(event) => setText("bankAba", event.target.value)} disabled={isPending} /></label>
            <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Account number</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "bankAccountNumber")} onChange={(event) => setText("bankAccountNumber", event.target.value)} disabled={isPending} /></label>
          </div>
        ) : null}
        {textValue(payload, "paymentMethodSelection") === "Credit Card" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Card number</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "cardNumber")} onChange={(event) => setText("cardNumber", event.target.value)} disabled={isPending} /></label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Expiration</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "cardExpiration")} onChange={(event) => setText("cardExpiration", event.target.value)} disabled={isPending} /></label>
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">CVV</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "cardCvv")} onChange={(event) => setText("cardCvv", event.target.value)} disabled={isPending} /></label>
          </div>
        ) : null}
      </Section>

      <Section title="13. Insurance / Legal Uploads">
        <div className="grid gap-3 md:grid-cols-3">
          {ENROLLMENT_PACKET_UPLOAD_FIELDS.map((uploadField) => (
            <label key={uploadField.key} className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">{uploadField.label}</span>
              <input type="file" multiple onChange={(event) => setUploads((current) => ({ ...current, [uploadField.key]: Array.from(event.target.files ?? []) }))} disabled={isPending} />
              <p className="text-xs text-muted">{uploads[uploadField.key].length > 0 ? `${uploads[uploadField.key].length} file(s) selected` : "No files selected"}</p>
            </label>
          ))}
        </div>
      </Section>

      <Section title="14. Privacy Practices Acknowledgement">
        <div className="space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-sm">
          {ENROLLMENT_PACKET_LEGAL_TEXT.privacyPractices.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={textValue(payload, "privacyPracticesAcknowledged") === "Acknowledged"} onChange={(event) => setAck("privacyPracticesAcknowledged", event.target.checked)} disabled={isPending} /><span>I acknowledge the Notice of Privacy Practices.</span></label>
      </Section>

      <Section title="15. Statement of Rights">
        <div className="space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-sm">
          {ENROLLMENT_PACKET_LEGAL_TEXT.statementOfRights.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={textValue(payload, "statementOfRightsAcknowledged") === "Acknowledged"} onChange={(event) => setAck("statementOfRightsAcknowledged", event.target.checked)} disabled={isPending} /><span>I acknowledge the Statement of Rights of Adult Day Care Participants.</span></label>
      </Section>

      <Section title="16. Photo Consent">
        <div className="space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-sm">
          {ENROLLMENT_PACKET_LEGAL_TEXT.photoConsent.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
        <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Photo consent</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "photoConsentChoice")} onChange={(event) => setText("photoConsentChoice", event.target.value)} disabled={isPending}><option value="">Select</option><option>I do permit</option><option>I do not permit</option></select></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={textValue(payload, "photoConsentAcknowledged") === "Acknowledged"} onChange={(event) => setAck("photoConsentAcknowledged", event.target.checked)} disabled={isPending} /><span>I acknowledge the Photo Consent terms.</span></label>
      </Section>

      <Section title="17. Ancillary Charges Notice">
        <div className="space-y-2 rounded-lg border border-border bg-slate-50 p-3 text-sm">
          {ENROLLMENT_PACKET_LEGAL_TEXT.ancillaryCharges.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={textValue(payload, "ancillaryChargesAcknowledged") === "Acknowledged"} onChange={(event) => setAck("ancillaryChargesAcknowledged", event.target.checked)} disabled={isPending} /><span>I acknowledge the Ancillary Charges Notice.</span></label>
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
          </div>
        ) : <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">All required fields are complete. Signature is now available.</p>}
      </Section>

      {completion.isComplete ? (
        <Section title="19. Signature">
          <p className="text-sm text-muted">Sign to complete and submit all packet sections.</p>
          <label className="block space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Typed signature name</span><input className="h-11 w-full rounded-lg border border-border px-3" value={caregiverTypedName} onChange={(event) => setCaregiverTypedName(event.target.value)} disabled={isPending} /></label>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold text-muted">Draw signature</p>
            <canvas ref={canvasRef} width={920} height={220} className="mt-2 w-full rounded-lg border border-border bg-white" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={onPointerUp} />
            <div className="mt-2 flex justify-end"><button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={clearSignature} disabled={isPending}>Clear Signature</button></div>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} className="mt-1" disabled={isPending} /><span>I attest this electronic signature is mine and I approve this enrollment packet.</span></label>
        </Section>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold" onClick={saveProgress} disabled={isPending}>{isPending ? "Saving..." : "Save Progress"}</button>
        {completion.isComplete ? <button type="button" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white" onClick={submitPacket} disabled={isPending}>{isPending ? "Submitting..." : "Sign and Submit Packet"}</button> : null}
      </div>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
