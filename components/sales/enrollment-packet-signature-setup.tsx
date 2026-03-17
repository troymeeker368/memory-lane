"use client";

import { useState } from "react";

import { saveEnrollmentPacketSenderSignatureProfileAction } from "@/app/sales-enrollment-actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { EsignaturePad } from "@/components/signature/esignature-pad";
import { Button } from "@/components/ui/button";
import { MutationNotice } from "@/components/ui/mutation-notice";

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
  const { isSaving, run } = useScopedMutation();

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
    void run(() => saveEnrollmentPacketSenderSignatureProfileAction({
        signatureName: signatureName.trim(),
        signatureImageDataUrl
      }), {
      successMessage: "Enrollment packet signature saved.",
      errorMessage: "Unable to save enrollment packet signature.",
      onSuccess: () => {
        setStatus("Enrollment packet signature saved.");
      },
      onError: (result) => {
        setStatus(`Error: ${result.error}`);
      }
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
          disabled={isSaving}
        />
      </label>
      <EsignaturePad
        disabled={isSaving}
        onSignatureChange={(dataUrl) => {
          setSignatureImageDataUrl(dataUrl);
          if (dataUrl) setStatus(null);
        }}
      />
      <div className="flex justify-end">
        <Button type="button" onClick={onSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Signature Setup"}
        </Button>
      </div>
      <MutationNotice kind={status?.startsWith("Error") ? "error" : "success"} message={status} />
    </div>
  );
}
