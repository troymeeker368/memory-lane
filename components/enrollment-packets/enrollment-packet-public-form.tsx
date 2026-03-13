"use client";

import { useEffect, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";

import {
  savePublicEnrollmentPacketProgressAction,
  submitPublicEnrollmentPacketAction
} from "@/app/sign/enrollment-packet/[token]/actions";

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
};

type FormState = {
  caregiverName: string;
  caregiverPhone: string;
  caregiverEmail: string;
  caregiverAddressLine1: string;
  caregiverAddressLine2: string;
  caregiverCity: string;
  caregiverState: string;
  caregiverZip: string;
  secondaryContactName: string;
  secondaryContactPhone: string;
  secondaryContactEmail: string;
  secondaryContactRelationship: string;
  notes: string;
  caregiverTypedName: string;
};

function toInitialState(fields: PublicEnrollmentPacketFields): FormState {
  return {
    caregiverName: fields.caregiverName ?? "",
    caregiverPhone: fields.caregiverPhone ?? "",
    caregiverEmail: fields.caregiverEmail ?? "",
    caregiverAddressLine1: fields.caregiverAddressLine1 ?? "",
    caregiverAddressLine2: fields.caregiverAddressLine2 ?? "",
    caregiverCity: fields.caregiverCity ?? "",
    caregiverState: fields.caregiverState ?? "",
    caregiverZip: fields.caregiverZip ?? "",
    secondaryContactName: fields.secondaryContactName ?? "",
    secondaryContactPhone: fields.secondaryContactPhone ?? "",
    secondaryContactEmail: fields.secondaryContactEmail ?? "",
    secondaryContactRelationship: fields.secondaryContactRelationship ?? "",
    notes: fields.notes ?? "",
    caregiverTypedName: fields.caregiverName ?? ""
  };
}

export function EnrollmentPacketPublicForm({
  token,
  fields
}: {
  token: string;
  fields: PublicEnrollmentPacketFields;
}) {
  const [form, setForm] = useState<FormState>(() => toInitialState(fields));
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSaved, setIsSaved] = useState(false);
  const [attested, setAttested] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [insuranceUploads, setInsuranceUploads] = useState<File[]>([]);
  const [poaUploads, setPoaUploads] = useState<File[]>([]);
  const [supportingUploads, setSupportingUploads] = useState<File[]>([]);

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

  const appendCommonFields = (formData: FormData) => {
    formData.set("token", token);
    formData.set("caregiverName", form.caregiverName);
    formData.set("caregiverPhone", form.caregiverPhone);
    formData.set("caregiverEmail", form.caregiverEmail);
    formData.set("caregiverAddressLine1", form.caregiverAddressLine1);
    formData.set("caregiverAddressLine2", form.caregiverAddressLine2);
    formData.set("caregiverCity", form.caregiverCity);
    formData.set("caregiverState", form.caregiverState);
    formData.set("caregiverZip", form.caregiverZip);
    formData.set("secondaryContactName", form.secondaryContactName);
    formData.set("secondaryContactPhone", form.secondaryContactPhone);
    formData.set("secondaryContactEmail", form.secondaryContactEmail);
    formData.set("secondaryContactRelationship", form.secondaryContactRelationship);
    formData.set("notes", form.notes);
  };

  const saveProgress = () => {
    setStatus(null);
    startTransition(async () => {
      const formData = new FormData();
      appendCommonFields(formData);
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
    if (!form.caregiverTypedName.trim()) {
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
    setStatus(null);
    startTransition(async () => {
      const formData = new FormData();
      appendCommonFields(formData);
      formData.set("caregiverTypedName", form.caregiverTypedName);
      formData.set("caregiverSignatureImageDataUrl", signatureImageDataUrl);
      formData.set("attested", attested ? "true" : "false");
      insuranceUploads.forEach((file) => formData.append("insuranceUploads", file));
      poaUploads.forEach((file) => formData.append("poaUploads", file));
      supportingUploads.forEach((file) => formData.append("supportingUploads", file));
      const result = await submitPublicEnrollmentPacketAction(formData);
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      setIsSaved(true);
      setStatus("Enrollment packet submitted successfully.");
    });
  };

  if (isSaved) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
        Enrollment packet submitted successfully. You may close this page.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-slate-50 p-3 text-sm">
        <p><span className="font-semibold">Requested Days:</span> {fields.requestedDays.length > 0 ? fields.requestedDays.join(", ") : "-"}</p>
        <p><span className="font-semibold">Transportation:</span> {fields.transportation ?? "-"}</p>
        <p><span className="font-semibold">Community Fee:</span> ${fields.communityFee.toFixed(2)}</p>
        <p><span className="font-semibold">Daily Rate:</span> ${fields.dailyRate.toFixed(2)}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Caregiver Name</span>
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.caregiverName}
            onChange={(event) => setForm((current) => ({ ...current, caregiverName: event.target.value }))}
            disabled={isPending}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Caregiver Phone</span>
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.caregiverPhone}
            onChange={(event) => setForm((current) => ({ ...current, caregiverPhone: event.target.value }))}
            disabled={isPending}
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs font-semibold text-muted">Caregiver Email</span>
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.caregiverEmail}
            onChange={(event) => setForm((current) => ({ ...current, caregiverEmail: event.target.value }))}
            disabled={isPending}
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs font-semibold text-muted">Address Line 1</span>
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.caregiverAddressLine1}
            onChange={(event) => setForm((current) => ({ ...current, caregiverAddressLine1: event.target.value }))}
            disabled={isPending}
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs font-semibold text-muted">Address Line 2</span>
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.caregiverAddressLine2}
            onChange={(event) => setForm((current) => ({ ...current, caregiverAddressLine2: event.target.value }))}
            disabled={isPending}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">City</span>
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.caregiverCity}
            onChange={(event) => setForm((current) => ({ ...current, caregiverCity: event.target.value }))}
            disabled={isPending}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">State</span>
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.caregiverState}
            onChange={(event) => setForm((current) => ({ ...current, caregiverState: event.target.value }))}
            disabled={isPending}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">ZIP</span>
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.caregiverZip}
            onChange={(event) => setForm((current) => ({ ...current, caregiverZip: event.target.value }))}
            disabled={isPending}
          />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Secondary Contact Name</span>
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.secondaryContactName}
            onChange={(event) => setForm((current) => ({ ...current, secondaryContactName: event.target.value }))}
            disabled={isPending}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Relationship</span>
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.secondaryContactRelationship}
            onChange={(event) => setForm((current) => ({ ...current, secondaryContactRelationship: event.target.value }))}
            disabled={isPending}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Secondary Contact Phone</span>
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.secondaryContactPhone}
            onChange={(event) => setForm((current) => ({ ...current, secondaryContactPhone: event.target.value }))}
            disabled={isPending}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Secondary Contact Email</span>
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.secondaryContactEmail}
            onChange={(event) => setForm((current) => ({ ...current, secondaryContactEmail: event.target.value }))}
            disabled={isPending}
          />
        </label>
      </div>

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Notes</span>
        <textarea
          className="min-h-[90px] w-full rounded-lg border border-border px-3 py-2"
          value={form.notes}
          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          disabled={isPending}
        />
      </label>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Insurance Uploads</span>
          <input
            type="file"
            multiple
            onChange={(event) => setInsuranceUploads(Array.from(event.target.files ?? []))}
            disabled={isPending}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">POA Uploads</span>
          <input
            type="file"
            multiple
            onChange={(event) => setPoaUploads(Array.from(event.target.files ?? []))}
            disabled={isPending}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Other Supporting Uploads</span>
          <input
            type="file"
            multiple
            onChange={(event) => setSupportingUploads(Array.from(event.target.files ?? []))}
            disabled={isPending}
          />
        </label>
      </div>

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Typed Signature Name</span>
        <input
          className="h-11 w-full rounded-lg border border-border px-3"
          value={form.caregiverTypedName}
          onChange={(event) => setForm((current) => ({ ...current, caregiverTypedName: event.target.value }))}
          disabled={isPending}
        />
      </label>

      <div className="rounded-lg border border-border p-3">
        <p className="text-xs font-semibold text-muted">Caregiver Signature</p>
        <canvas
          ref={canvasRef}
          width={920}
          height={240}
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

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={attested}
          onChange={(event) => setAttested(event.target.checked)}
          className="mt-1"
          disabled={isPending}
        />
        <span>I attest this is my electronic signature and I approve this enrollment packet.</span>
      </label>

      <div className="flex flex-wrap justify-end gap-2">
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

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

