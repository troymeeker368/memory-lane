import "server-only";

import { getMemberLockerConflict } from "@/lib/services/members-read";
import { saveMemberCommandCenterBundle } from "@/lib/services/member-command-center";
import { ensureMemberCommandCenterProfileSupabase } from "@/lib/services/member-command-center-write";
import { asUploadedImageDataUrl } from "@/lib/utils/uploaded-image-data-url";
import { toEasternISO } from "@/lib/timezone";

import {
  asNullableBoolSelect,
  asNullableString,
  asString,
  normalizeLockerInput,
  requireCommandCenterEditor,
  revalidateCommandCenter,
  toServiceActor
} from "./shared";

export async function saveMemberCommandCenterSummaryAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const lockerNumber = normalizeLockerInput(asString(formData, "lockerNumber"));
  const { member, conflict } = await getMemberLockerConflict({ memberId, lockerNumber });
  if (!member) return { ok: false, error: "Member not found." };
  if (lockerNumber && conflict) {
    return { ok: false, error: `Locker ${lockerNumber} is already assigned to ${conflict.displayName}.` };
  }

  const now = toEasternISO();
  const profile = await ensureMemberCommandCenterProfileSupabase(memberId);
  const defaultLocation = profile.location ?? "Fort Mill";
  await saveMemberCommandCenterBundle({
    memberId,
    mccPatch: {
      original_referral_source: asNullableString(formData, "originalReferralSource"),
      photo_consent: asNullableBoolSelect(formData, "photoConsent"),
      location: defaultLocation
    },
    memberPatch: {
      locker_number: lockerNumber
    },
    actor: toServiceActor(actor),
    now
  });

  revalidateCommandCenter(memberId);
  return { ok: true };
}

export async function updateMemberCommandCenterPhotoAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const now = toEasternISO();
  const profile = await ensureMemberCommandCenterProfileSupabase(memberId);
  const profileImageUrl = await asUploadedImageDataUrl(formData, "photoFile", profile.profile_image_url ?? null);
  await saveMemberCommandCenterBundle({
    memberId,
    mccPatch: {
      profile_image_url: profileImageUrl
    },
    actor: toServiceActor(actor),
    now
  });

  revalidateCommandCenter(memberId);
  return { ok: true, profileImageUrl };
}
