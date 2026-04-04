import { Buffer } from "node:buffer";

import "server-only";

import { createPhotoUploadAction } from "@/app/documentation-create-core";

export {
  createAncillaryChargeAction,
  createBloodSugarLogAction,
  createDailyActivityAction,
  createPhotoUploadAction,
  createShowerLogAction,
  createToiletLogAction,
  createTransportationLogAction
} from "@/app/documentation-create-core";

const MAX_PHOTO_UPLOAD_BYTES = 5 * 1024 * 1024;

async function toPhotoDataUrl(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`"${file.name}" must be an image file.`);
  }
  if (file.size > MAX_PHOTO_UPLOAD_BYTES) {
    throw new Error(`"${file.name}" is too large. Max allowed per photo is 5MB.`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${bytes.toString("base64")}`;
}

export async function createPhotoUploadsFormAction(formData: FormData) {
  const files = formData.getAll("photoFiles").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) {
    return { error: "Select at least one photo to upload." };
  }

  let savedCount = 0;
  const failures: string[] = [];

  for (const file of files) {
    try {
      const photoDataUrl = await toPhotoDataUrl(file);
      const result = await createPhotoUploadAction({
        fileName: file.name,
        fileType: file.type,
        fileDataUrl: photoDataUrl
      });
      if ("error" in result) {
        failures.push(`${file.name}: ${result.error}`);
        continue;
      }
      savedCount += 1;
    } catch (error) {
      failures.push(`${file.name}: ${error instanceof Error ? error.message : "Unable to process file."}`);
    }
  }

  if (savedCount === 0) {
    return { error: failures[0] ?? "No photos were saved." };
  }

  return {
    ok: true,
    savedCount,
    failedCount: failures.length,
    failures,
    message:
      failures.length === 0
        ? `Saved ${savedCount} photo upload${savedCount === 1 ? "" : "s"}.`
        : `Saved ${savedCount} photo upload${savedCount === 1 ? "" : "s"}. ${failures.length} file(s) still need attention.`
  };
}

export async function createPhotoUploadFormAction(formData: FormData) {
  const file = formData.get("photoFile");
  if (!(file instanceof File) || file.size <= 0) {
    return { error: "Photo upload requires an image file." };
  }
  if (!file.type.startsWith("image/")) {
    return { error: "Only image uploads are supported." };
  }
  if (file.size > MAX_PHOTO_UPLOAD_BYTES) {
    return { error: "Photo is too large. Max allowed per photo is 5MB." };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileDataUrl = `data:${file.type || "image/*"};base64,${bytes.toString("base64")}`;

  return createPhotoUploadAction({
    fileName: file.name,
    fileType: file.type || "image/*",
    fileDataUrl,
    notes: typeof formData.get("notes") === "string" ? String(formData.get("notes")) : undefined
  });
}
