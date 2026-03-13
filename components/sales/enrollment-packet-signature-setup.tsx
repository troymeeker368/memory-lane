"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveEnrollmentPacketSenderSignatureProfileAction } from "@/app/sales-actions";
import { EsignaturePad } from "@/components/signature/esignature-pad";
import { Button } from "@/components/ui/button";

export function EnrollmentPacketSignatureSetup({
  initialSignatureName,
  initialSignatureImageDataUrl
}: {
  initialSignatureName: string;
  initialSignatureImageDataUrl: string | null;
}) {
  const [signatureName, setSignatureName] = useState(initialSignatureName);
  const [signatureImageDataUrl, setSignatureImageDataUrl] = useState<string | null>(initialSignatureImageDataUrl);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const onSave = () => {
    if (!signatureName.trim()) {
      setStatus("Signature name is required.");
      return;
    }
    if (!signatureImageDataUrl) {
      setStatus("Please draw and capture your signature.");
      return;
    }
    setStatus(null);
    startTransition(async () => {
      const result = await saveEnrollmentPacketSenderSignatureProfileAction({
        signatureName: signatureName.trim(),
        signatureImageDataUrl
      });
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      setStatus("Enrollment packet signature saved.");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Signature Name</span>
        <input
          className="h-11 w-full rounded-lg border border-border px-3"
          value={signatureName}
          onChange={(event) => setSignatureName(event.target.value)}
          disabled={isPending}
        />
      </label>
      <EsignaturePad
        disabled={isPending}
        onSignatureChange={(dataUrl) => {
          setSignatureImageDataUrl(dataUrl);
          if (dataUrl) setStatus(null);
        }}
      />
      <div className="flex justify-end">
        <Button type="button" onClick={onSave} disabled={isPending}>
          {isPending ? "Saving..." : "Save Signature Setup"}
        </Button>
      </div>
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

