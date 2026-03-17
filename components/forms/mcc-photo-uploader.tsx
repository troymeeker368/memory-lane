"use client";

import { useEffect, useRef, useState } from "react";

import { updateMemberCommandCenterPhotoAction } from "@/app/(portal)/operations/member-command-center/summary-actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { MutationNotice } from "@/components/ui/mutation-notice";

const MAX_MEMBER_PHOTO_BYTES = 5 * 1024 * 1024;

function getInitials(displayName: string) {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "NA";
  if (parts.length === 1) {
    const token = parts[0].toUpperCase();
    return token.slice(0, 2);
  }

  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export function MccPhotoUploader({
  memberId,
  returnTo,
  profileImageUrl,
  displayName
}: {
  memberId: string;
  returnTo: string;
  profileImageUrl: string | null;
  displayName: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState<string | null>(profileImageUrl);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { isSaving, run } = useScopedMutation();
  const initials = getInitials(displayName);

  useEffect(() => {
    setCurrentPhotoUrl(profileImageUrl);
  }, [profileImageUrl]);

  const handlePhotoUpload = async (formData: FormData) => {
    await run(() => updateMemberCommandCenterPhotoAction(formData), {
      successMessage: "Photo updated.",
      errorMessage: "Unable to upload photo.",
      onSuccess: (result) => {
        const data = ((result.data ?? {}) as unknown) as { profileImageUrl?: string | null };
        setCurrentPhotoUrl(data.profileImageUrl ?? currentPhotoUrl);
        setUploadError(null);
      },
      onError: (result) => {
        setUploadError(result.error);
      }
    });
  };

  return (
    <form
      ref={formRef}
      action={(formData) => {
        void handlePhotoUpload(formData);
      }}
      className="flex flex-col items-center gap-2"
    >
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        title="Click photo to upload"
        disabled={isSaving}
      >
        {currentPhotoUrl ? (
          <img
            src={currentPhotoUrl}
            alt={`${displayName} profile`}
            className="h-28 w-28 rounded-full border border-border object-cover"
          />
        ) : (
          <div className="flex h-28 w-28 items-center justify-center rounded-full border border-border bg-slate-100 text-2xl font-semibold text-primary-text">
            {initials}
          </div>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        name="photoFile"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          if (isSaving) return;
          if (file.size > MAX_MEMBER_PHOTO_BYTES) {
            setUploadError("Photo is too large. Max allowed is 5MB.");
            event.currentTarget.value = "";
            return;
          }
          setUploadError(null);
          formRef.current?.requestSubmit();
        }}
      />
      <MutationNotice kind="error" message={uploadError} />
    </form>
  );
}
