"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { updateMhpTrackInlineAction } from "@/app/(portal)/health/member-health-profiles/profile-actions";

const TRACK_OPTIONS = ["Track 1", "Track 2", "Track 3"] as const;

export function MhpTrackBannerEditor({
  memberId,
  initialTrack,
  sourceText,
  reviewHref
}: {
  memberId: string;
  initialTrack: string | null;
  sourceText: string;
  reviewHref: string;
}) {
  const [track, setTrack] = useState<string>(
    initialTrack && TRACK_OPTIONS.includes(initialTrack as (typeof TRACK_OPTIONS)[number]) ? initialTrack : "Track 1"
  );
  const [savedTrack, setSavedTrack] = useState<string>(
    initialTrack && TRACK_OPTIONS.includes(initialTrack as (typeof TRACK_OPTIONS)[number]) ? initialTrack : "Track 1"
  );
  const [status, setStatus] = useState("");
  const [showReviewPrompt, setShowReviewPrompt] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const trackNumber = track.replace("Track ", "");

  const saveTrack = () => {
    setStatus("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("track", track);

      const result = await updateMhpTrackInlineAction(formData);
      if (!result.ok) {
        setStatus(result.error ?? "Unable to update track.");
        return;
      }

      if (result.changed) {
        setStatus(`Track updated to ${track}. Care plan review recommended.`);
        setShowReviewPrompt(true);
        setSavedTrack(track);
        setIsEditing(false);
      } else {
        setStatus("Track unchanged.");
        setShowReviewPrompt(false);
        setSavedTrack(track);
        setIsEditing(false);
      }
    });
  };

  return (
    <div className="rounded-lg border border-border p-3 text-center" title={sourceText}>
      <p className="text-xs text-muted">Track #</p>
      {!isEditing ? (
        <div className="mt-1 flex justify-center">
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="rounded-lg border border-border px-3 py-2 text-center text-primary-text transition hover:border-brand"
            title="Click to update track"
          >
            <span className="text-lg font-bold">{trackNumber}</span>
          </button>
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <select
            value={track}
            onChange={(event) => setTrack(event.target.value)}
            className="h-9 rounded-lg border border-border px-2 text-sm"
          >
            {TRACK_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="h-9 rounded-lg bg-brand px-3 text-xs font-semibold text-white"
            onClick={saveTrack}
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="h-9 rounded-lg border border-border px-3 text-xs font-semibold text-primary-text"
            onClick={() => {
              setTrack(savedTrack);
              setIsEditing(false);
            }}
            disabled={isPending}
          >
            Cancel
          </button>
        </div>
      )}
      {status ? <p className="mt-1 text-xs text-muted">{status}</p> : null}
      {showReviewPrompt ? (
        <div className="mt-2 rounded border border-border bg-[#f8fbff] p-2 text-xs">
          <p className="text-primary-text">Track changed. Review care plan now.</p>
          <Link href={reviewHref} className="font-semibold text-brand">
            Open Care Plan Review
          </Link>
        </div>
      ) : null}
    </div>
  );
}
