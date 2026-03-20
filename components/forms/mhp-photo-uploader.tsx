"use client";

import { useRef, useState } from "react";

import { updateMhpPhotoAction } from "@/app/(portal)/health/member-health-profiles/profile-actions";

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

export function MhpPhotoUploader({
  memberId,
  returnTab,
  profileImageUrl,
  displayName
}: {
  memberId: string;
  returnTab: string;
  profileImageUrl: string | null;
  displayName: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const initials = getInitials(displayName);

  return (
    <form ref={formRef} action={updateMhpPhotoAction} className="flex flex-col items-center gap-2">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="returnTab" value={returnTab} />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        title="Click photo to upload"
      >
        {profileImageUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={profileImageUrl}
              alt={`${displayName} profile`}
              className="h-28 w-28 rounded-full border border-border object-cover"
            />
          </>
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
          if (file.size > MAX_MEMBER_PHOTO_BYTES) {
            setUploadError("Photo is too large. Max allowed is 5MB.");
            event.currentTarget.value = "";
            return;
          }
          setUploadError(null);
          formRef.current?.requestSubmit();
        }}
      />
      {uploadError ? <p className="text-xs text-red-700">{uploadError}</p> : null}
    </form>
  );
}
