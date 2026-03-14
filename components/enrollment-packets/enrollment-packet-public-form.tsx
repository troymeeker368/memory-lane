"use client";

import { useEffect, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";

import {
  savePublicEnrollmentPacketProgressAction,
  submitPublicEnrollmentPacketAction
} from "@/app/sign/enrollment-packet/[token]/actions";
import {
  ENROLLMENT_PACKET_SECTIONS,
  ENROLLMENT_PACKET_UPLOAD_FIELDS,
  formatEnrollmentPacketValue,
  type EnrollmentPacketFieldDefinition
} from "@/lib/services/enrollment-packet-public-schema";
import {
  normalizeEnrollmentPacketIntakePayload,
  type EnrollmentPacketIntakeArrayKey,
  type EnrollmentPacketIntakeFieldKey,
  type EnrollmentPacketIntakePayload,
  type EnrollmentPacketIntakeTextKey
} from "@/lib/services/enrollment-packet-intake-payload";
import { formatPhoneInput } from "@/lib/phone";

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

const UPLOAD_STEP_ID = "insurance-legal-uploads";
const WEEKDAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function emptyUploadState(): UploadState {
  return ENROLLMENT_PACKET_UPLOAD_FIELDS.reduce((acc, definition) => {
    acc[definition.key] = [];
    return acc;
  }, {} as UploadState);
}

function toInitialPayload(fields: PublicEnrollmentPacketFields): EnrollmentPacketIntakePayload {
  const base = normalizeEnrollmentPacketIntakePayload({
    ...fields.intakePayload,
    requestedAttendanceDays: fields.requestedDays,
    membershipRequestedWeekdays: fields.requestedDays,
    transportationPreference: fields.transportation,
    primaryContactName: fields.caregiverName,
    primaryContactPhone: fields.caregiverPhone,
    primaryContactEmail: fields.caregiverEmail,
    memberAddressLine1: fields.caregiverAddressLine1,
    memberAddressLine2: fields.caregiverAddressLine2,
    memberCity: fields.caregiverCity,
    memberState: fields.caregiverState,
    memberZip: fields.caregiverZip,
    secondaryContactName: fields.secondaryContactName,
    secondaryContactPhone: fields.secondaryContactPhone,
    secondaryContactEmail: fields.secondaryContactEmail,
    secondaryContactRelationship: fields.secondaryContactRelationship,
    additionalNotes: fields.notes,
    membershipNumberOfDays: fields.requestedDays.length > 0 ? String(fields.requestedDays.length) : null,
    membershipDailyAmount: fields.dailyRate > 0 ? fields.dailyRate.toFixed(2) : null,
    communityFee: fields.communityFee > 0 ? fields.communityFee.toFixed(2) : null
  });

  return base;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function applySignatureDefaults(payload: EnrollmentPacketIntakePayload, typedName: string) {
  const signatureDate = todayDateString();
  const normalizedName = typedName.trim();
  if (!normalizedName) return payload;

  const patch: Partial<Record<EnrollmentPacketIntakeFieldKey, string | string[] | null>> = {
    welcomeChecklistAcknowledgedName: payload.welcomeChecklistAcknowledgedName ?? normalizedName,
    welcomeChecklistAcknowledgedDate: payload.welcomeChecklistAcknowledgedDate ?? signatureDate,
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

export function EnrollmentPacketPublicForm({
  token,
  fields
}: {
  token: string;
  fields: PublicEnrollmentPacketFields;
}) {
  const sections = [...ENROLLMENT_PACKET_SECTIONS, {
    id: UPLOAD_STEP_ID,
    title: "Insurance & Legal Uploads",
    description: "Upload cards and legal documents from the packet.",
    sourceDocuments: ["Insurance and POA Upload"] as const,
    fields: []
  }];

  const [payload, setPayload] = useState<EnrollmentPacketIntakePayload>(() => toInitialPayload(fields));
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [attested, setAttested] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [caregiverTypedName, setCaregiverTypedName] = useState(payload.primaryContactName ?? "");
  const [uploads, setUploads] = useState<UploadState>(() => emptyUploadState());

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

  const currentSection = sections[currentSectionIndex];
  const onFirstSection = currentSectionIndex === 0;
  const onLastSection = currentSectionIndex === sections.length - 1;

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
    if (strokeStartedRef.current) {
      setHasSignature(true);
    }
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

  const getTextValue = (key: EnrollmentPacketIntakeTextKey) => {
    const value = payload[key];
    return typeof value === "string" ? value : "";
  };

  const getArrayValue = (key: EnrollmentPacketIntakeArrayKey) => {
    const value = payload[key];
    return Array.isArray(value) ? value : [];
  };

  const setTextValue = (key: EnrollmentPacketIntakeTextKey, value: string) => {
    setPayload((current) => normalizeEnrollmentPacketIntakePayload({ ...current, [key]: value }));
  };

  const toggleArrayValue = (key: EnrollmentPacketIntakeArrayKey, item: string, checked: boolean) => {
    setPayload((current) => {
      const existing = new Set(getArrayValueFromPayload(current, key));
      if (checked) {
        existing.add(item);
      } else {
        existing.delete(item);
      }
      return normalizeEnrollmentPacketIntakePayload({
        ...current,
        [key]: Array.from(existing)
      });
    });
  };

  const appendCommonFields = (formData: FormData, sourcePayload: EnrollmentPacketIntakePayload) => {
    formData.set("token", token);
    formData.set("intakePayload", JSON.stringify(sourcePayload));
    formData.set("caregiverName", sourcePayload.primaryContactName ?? "");
    formData.set("caregiverPhone", sourcePayload.primaryContactPhone ?? "");
    formData.set("caregiverEmail", sourcePayload.primaryContactEmail ?? "");
    formData.set("caregiverAddressLine1", sourcePayload.memberAddressLine1 ?? "");
    formData.set("caregiverAddressLine2", sourcePayload.memberAddressLine2 ?? "");
    formData.set("caregiverCity", sourcePayload.memberCity ?? "");
    formData.set("caregiverState", sourcePayload.memberState ?? "");
    formData.set("caregiverZip", sourcePayload.memberZip ?? "");
    formData.set("secondaryContactName", sourcePayload.secondaryContactName ?? "");
    formData.set("secondaryContactPhone", sourcePayload.secondaryContactPhone ?? "");
    formData.set("secondaryContactEmail", sourcePayload.secondaryContactEmail ?? "");
    formData.set("secondaryContactRelationship", sourcePayload.secondaryContactRelationship ?? "");
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
      formData.set("attested", attested ? "true" : "false");

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

  const renderField = (field: EnrollmentPacketFieldDefinition) => {
    const disabled = isPending || Boolean(field.staffPrepared);
    const wrapperClass = field.columns === 2 ? "space-y-1 text-sm md:col-span-2" : "space-y-1 text-sm";

    if (field.type === "textarea") {
      return (
        <label key={field.key} className={wrapperClass}>
          <span className="text-xs font-semibold text-muted">
            {field.label}
            {field.staffPrepared ? " (Staff prepared)" : ""}
          </span>
          <textarea
            className="min-h-[92px] w-full rounded-lg border border-border px-3 py-2"
            value={getTextValue(field.key as EnrollmentPacketIntakeTextKey)}
            onChange={(event) => setTextValue(field.key as EnrollmentPacketIntakeTextKey, event.target.value)}
            disabled={disabled}
          />
        </label>
      );
    }

    if (field.type === "select") {
      return (
        <label key={field.key} className={wrapperClass}>
          <span className="text-xs font-semibold text-muted">
            {field.label}
            {field.staffPrepared ? " (Staff prepared)" : ""}
          </span>
          <select
            className="h-11 w-full rounded-lg border border-border px-3"
            value={getTextValue(field.key as EnrollmentPacketIntakeTextKey)}
            onChange={(event) => setTextValue(field.key as EnrollmentPacketIntakeTextKey, event.target.value)}
            disabled={disabled}
          >
            <option value="">Select</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (field.type === "radio") {
      const selectedValue = getTextValue(field.key as EnrollmentPacketIntakeTextKey);
      return (
        <fieldset key={field.key} className={wrapperClass}>
          <legend className="text-xs font-semibold text-muted">
            {field.label}
            {field.staffPrepared ? " (Staff prepared)" : ""}
          </legend>
          <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-slate-50 p-3">
            {(field.options ?? []).map((option) => (
              <label key={option} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`radio-${field.key}`}
                  checked={selectedValue === option}
                  onChange={() => setTextValue(field.key as EnrollmentPacketIntakeTextKey, option)}
                  disabled={disabled}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
      );
    }

    if (field.type === "checkbox-group" || field.type === "weekday-group") {
      const options = field.type === "weekday-group" ? WEEKDAY_OPTIONS : field.options ?? [];
      const selected = new Set(getArrayValue(field.key as EnrollmentPacketIntakeArrayKey));
      return (
        <fieldset key={field.key} className={wrapperClass}>
          <legend className="text-xs font-semibold text-muted">
            {field.label}
            {field.staffPrepared ? " (Staff prepared)" : ""}
          </legend>
          <div className="grid gap-2 rounded-lg border border-border bg-slate-50 p-3 sm:grid-cols-2">
            {options.map((option) => (
              <label key={option} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(option)}
                  onChange={(event) =>
                    toggleArrayValue(field.key as EnrollmentPacketIntakeArrayKey, option, event.target.checked)
                  }
                  disabled={disabled}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
      );
    }

    const inputType = field.type === "email" || field.type === "tel" || field.type === "date" || field.type === "number"
      ? field.type
      : "text";

    return (
      <label key={field.key} className={wrapperClass}>
        <span className="text-xs font-semibold text-muted">
          {field.label}
          {field.staffPrepared ? " (Staff prepared)" : ""}
        </span>
        <input
          type={inputType}
          className="h-11 w-full rounded-lg border border-border px-3"
          value={getTextValue(field.key as EnrollmentPacketIntakeTextKey)}
          onChange={(event) =>
            setTextValue(
              field.key as EnrollmentPacketIntakeTextKey,
              inputType === "tel" ? formatPhoneInput(event.target.value) : event.target.value
            )
          }
          disabled={disabled}
        />
      </label>
    );
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
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-slate-50 p-3 text-sm">
        <p>
          <span className="font-semibold">Requested Days:</span>{" "}
          {fields.requestedDays.length > 0 ? fields.requestedDays.join(", ") : "-"}
        </p>
        <p><span className="font-semibold">Transportation:</span> {fields.transportation ?? "-"}</p>
        <p><span className="font-semibold">Community Fee:</span> ${fields.communityFee.toFixed(2)}</p>
        <p><span className="font-semibold">Daily Rate:</span> ${fields.dailyRate.toFixed(2)}</p>
        <p className="mt-1 text-xs text-muted">Town Square staff signature is pre-applied on the agreement.</p>
      </div>

      <div className="rounded-lg border border-border p-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {sections.map((section, index) => (
            <button
              key={section.id}
              type="button"
              className={`whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-semibold ${
                index === currentSectionIndex
                  ? "border-brand bg-brand text-white"
                  : "border-border bg-white text-muted hover:border-brand/50"
              }`}
              onClick={() => setCurrentSectionIndex(index)}
              disabled={isPending}
            >
              {index + 1}. {section.title}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="mb-3">
          <h3 className="text-base font-semibold">{currentSection.title}</h3>
          <p className="text-sm text-muted">{currentSection.description}</p>
          <p className="text-xs text-muted">Source: {currentSection.sourceDocuments.join(", ")}</p>
        </div>

        {currentSection.id === UPLOAD_STEP_ID ? (
          <div className="grid gap-3 md:grid-cols-2">
            {ENROLLMENT_PACKET_UPLOAD_FIELDS.map((uploadField) => (
              <label key={uploadField.key} className="space-y-1 text-sm">
                <span className="text-xs font-semibold text-muted">{uploadField.label}</span>
                <input
                  type="file"
                  multiple
                  onChange={(event) =>
                    setUploads((current) => ({
                      ...current,
                      [uploadField.key]: Array.from(event.target.files ?? [])
                    }))
                  }
                  disabled={isPending}
                />
                <p className="text-xs text-muted">
                  {uploads[uploadField.key].length > 0
                    ? `${uploads[uploadField.key].length} file(s) selected`
                    : "No files selected"}
                </p>
              </label>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">{currentSection.fields.map(renderField)}</div>
        )}
      </div>

      <div className="rounded-lg border border-border p-4">
        <h3 className="text-base font-semibold">Final Signature</h3>
        <p className="text-sm text-muted">Sign to complete and submit all packet sections.</p>

        <label className="mt-3 block space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Typed signature name</span>
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={caregiverTypedName}
            onChange={(event) => setCaregiverTypedName(event.target.value)}
            disabled={isPending}
          />
        </label>

        <div className="mt-3 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold text-muted">Draw signature</p>
          <canvas
            ref={canvasRef}
            width={920}
            height={220}
            className="mt-2 w-full rounded-lg border border-border bg-white"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerUp}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold"
              onClick={clearSignature}
              disabled={isPending}
            >
              Clear Signature
            </button>
          </div>
        </div>

        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={attested}
            onChange={(event) => setAttested(event.target.checked)}
            className="mt-1"
            disabled={isPending}
          />
          <span>I attest this electronic signature is mine and I approve this enrollment packet.</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
            onClick={() => setCurrentSectionIndex((index) => Math.max(0, index - 1))}
            disabled={isPending || onFirstSection}
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
            onClick={() => setCurrentSectionIndex((index) => Math.min(sections.length - 1, index + 1))}
            disabled={isPending || onLastSection}
          >
            Next
          </button>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
            onClick={saveProgress}
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Save Progress"}
          </button>
          <button
            type="button"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
            onClick={submitPacket}
            disabled={isPending}
          >
            {isPending ? "Submitting..." : "Sign and Submit Packet"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-slate-50 p-3 text-sm">
        <p className="font-semibold">Quick Review</p>
        <p><span className="font-semibold">Primary contact:</span> {formatEnrollmentPacketValue(payload.primaryContactName)}</p>
        <p><span className="font-semibold">Member:</span> {formatEnrollmentPacketValue(`${payload.memberLegalFirstName ?? ""} ${payload.memberLegalLastName ?? ""}`)}</p>
        <p><span className="font-semibold">Photo consent:</span> {formatEnrollmentPacketValue(payload.photoConsentChoice)}</p>
      </div>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

function getArrayValueFromPayload(payload: EnrollmentPacketIntakePayload, key: EnrollmentPacketIntakeArrayKey) {
  const value = payload[key];
  return Array.isArray(value) ? value : [];
}
