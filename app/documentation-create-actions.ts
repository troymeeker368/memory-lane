"use server";

import type {
  createAncillaryChargeAction as createAncillaryChargeActionImpl,
  createBloodSugarLogAction as createBloodSugarLogActionImpl,
  createDailyActivityAction as createDailyActivityActionImpl,
  createPhotoUploadAction as createPhotoUploadActionImpl,
  createShowerLogAction as createShowerLogActionImpl,
  createToiletLogAction as createToiletLogActionImpl,
  createTransportationLogAction as createTransportationLogActionImpl
} from "@/app/documentation-actions-impl";

export async function createAncillaryChargeAction(raw: Parameters<typeof createAncillaryChargeActionImpl>[0]) {
  const { createAncillaryChargeAction } = await import("@/app/documentation-actions-impl");
  return createAncillaryChargeAction(raw);
}

export async function createDailyActivityAction(raw: Parameters<typeof createDailyActivityActionImpl>[0]) {
  const { createDailyActivityAction } = await import("@/app/documentation-actions-impl");
  return createDailyActivityAction(raw);
}

export async function createToiletLogAction(raw: Parameters<typeof createToiletLogActionImpl>[0]) {
  const { createToiletLogAction } = await import("@/app/documentation-actions-impl");
  return createToiletLogAction(raw);
}

export async function createShowerLogAction(raw: Parameters<typeof createShowerLogActionImpl>[0]) {
  const { createShowerLogAction } = await import("@/app/documentation-actions-impl");
  return createShowerLogAction(raw);
}

export async function createTransportationLogAction(raw: Parameters<typeof createTransportationLogActionImpl>[0]) {
  const { createTransportationLogAction } = await import("@/app/documentation-actions-impl");
  return createTransportationLogAction(raw);
}

export async function createPhotoUploadAction(raw: Parameters<typeof createPhotoUploadActionImpl>[0]) {
  const { createPhotoUploadAction } = await import("@/app/documentation-actions-impl");
  return createPhotoUploadAction(raw);
}

export async function createBloodSugarLogAction(raw: Parameters<typeof createBloodSugarLogActionImpl>[0]) {
  const { createBloodSugarLogAction } = await import("@/app/documentation-actions-impl");
  return createBloodSugarLogAction(raw);
}
