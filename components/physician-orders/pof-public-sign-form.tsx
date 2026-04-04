"use client";

import { useEffect, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";

import { submitPublicPofSignatureAction } from "@/app/sign/pof/[token]/actions";

type PublicSignFormProps = {
  token: string;
  providerNameDefault: string;
};

type SubmittedPofOutcome = {
  postSignStatus: "synced" | "queued";
  readinessStage: "committed" | "ready" | "follow_up_required" | "queued_degraded";
  readinessLabel: string;
  retry: {
    queueId: string | null;
    attemptCount: number;
    nextRetryAt: string | null;
    lastError: string | null;
  };
  actionNeeded: boolean;
  actionNeededMessage: string | null;
};

export function PofPublicSignForm({ token, providerNameDefault }: PublicSignFormProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [providerTypedName, setProviderTypedName] = useState(providerNameDefault);
  const [attested, setAttested] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [submittedOutcome, setSubmittedOutcome] = useState<SubmittedPofOutcome | null>(null);
  const [isPending, startTransition] = useTransition();

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

  function getCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const point = getCanvasPoint(event);
    if (!canvas || !context || !point) return;
    drawingRef.current = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext("2d");
    const point = getCanvasPoint(event);
    if (!context || !point) return;
    context.lineTo(point.x, point.y);
    context.stroke();
    setHasSignature(true);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawingRef.current = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    setStatus(null);
  }

  function submitSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!providerTypedName.trim()) {
      setStatus("Typed provider name is required.");
      return;
    }
    if (!hasSignature) {
      setStatus("Draw your signature before submitting.");
      return;
    }
    if (!attested) {
      setStatus("You must confirm attestation before signing.");
      return;
    }

    const signatureImageDataUrl = canvas.toDataURL("image/png");
    setStatus(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("token", token);
      formData.set("providerTypedName", providerTypedName.trim());
      formData.set("signatureImageDataUrl", signatureImageDataUrl);
      formData.set("attested", attested ? "true" : "false");
      const result = await submitPublicPofSignatureAction(formData);
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      setSigned(true);
      setSubmittedOutcome({
        postSignStatus: result.postSignStatus,
        readinessStage: result.readinessStage,
        readinessLabel: result.readinessLabel,
        retry: result.retry,
        actionNeeded: result.actionNeeded,
        actionNeededMessage: result.actionNeededMessage
      });
      setStatus(result.actionNeededMessage ?? "Signature recorded.");
    });
  }

  if (signed) {
    return (
      <div className="space-y-3">
        <p
          className={`rounded-lg p-3 text-sm font-semibold ${
            submittedOutcome?.actionNeeded
              ? "border border-amber-200 bg-amber-50 text-amber-700"
              : "border border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {submittedOutcome ? `Signature Recorded - ${submittedOutcome.readinessLabel}` : "Signature Recorded"}
        </p>
        <p className="text-sm text-muted">
          {submittedOutcome?.actionNeededMessage ??
            "Thank you. The signed form has been received and downstream sync is complete."}
        </p>
        {submittedOutcome ? (
          <p className="text-xs text-muted">
            Downstream status: {submittedOutcome.readinessLabel}
            {submittedOutcome.retry.nextRetryAt
              ? ` | Next retry: ${new Date(submittedOutcome.retry.nextRetryAt).toLocaleString()}`
              : ""}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="text-xs font-semibold text-muted">Provider Typed Name</span>
        <input
          className="mt-1 h-11 w-full rounded-lg border border-border px-3"
          value={providerTypedName}
          onChange={(event) => setProviderTypedName(event.target.value)}
          disabled={isPending}
        />
      </label>

      <div className="rounded-lg border border-border p-3">
        <p className="text-xs font-semibold text-muted">Signature</p>
        <canvas
          ref={canvasRef}
          width={920}
          height={260}
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
        <span>I attest this is my electronic signature and I approve this Physician Order Form.</span>
      </label>

      <div className="flex justify-end">
        <button
          type="button"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
          onClick={submitSignature}
          disabled={isPending}
        >
          {isPending ? "Submitting..." : "Sign and Submit"}
        </button>
      </div>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
