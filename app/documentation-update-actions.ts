"use server";

import type {
  deleteWorkflowRecordAction as deleteWorkflowRecordActionImpl,
  setAncillaryReconciliationAction as setAncillaryReconciliationActionImpl,
  updateAncillaryAction as updateAncillaryActionImpl,
  updateBloodSugarAction as updateBloodSugarActionImpl,
  updateDailyActivityAction as updateDailyActivityActionImpl,
  updateShowerLogAction as updateShowerLogActionImpl,
  updateToiletLogAction as updateToiletLogActionImpl,
  updateTransportationLogAction as updateTransportationLogActionImpl
} from "@/app/documentation-actions-impl";

export async function updateDailyActivityAction(raw: Parameters<typeof updateDailyActivityActionImpl>[0]) {
  const { updateDailyActivityAction } = await import("@/app/documentation-actions-impl");
  return updateDailyActivityAction(raw);
}

export async function updateToiletLogAction(raw: Parameters<typeof updateToiletLogActionImpl>[0]) {
  const { updateToiletLogAction } = await import("@/app/documentation-actions-impl");
  return updateToiletLogAction(raw);
}

export async function updateShowerLogAction(raw: Parameters<typeof updateShowerLogActionImpl>[0]) {
  const { updateShowerLogAction } = await import("@/app/documentation-actions-impl");
  return updateShowerLogAction(raw);
}

export async function updateTransportationLogAction(raw: Parameters<typeof updateTransportationLogActionImpl>[0]) {
  const { updateTransportationLogAction } = await import("@/app/documentation-actions-impl");
  return updateTransportationLogAction(raw);
}

export async function updateBloodSugarAction(raw: Parameters<typeof updateBloodSugarActionImpl>[0]) {
  const { updateBloodSugarAction } = await import("@/app/documentation-actions-impl");
  return updateBloodSugarAction(raw);
}

export async function updateAncillaryAction(raw: Parameters<typeof updateAncillaryActionImpl>[0]) {
  const { updateAncillaryAction } = await import("@/app/documentation-actions-impl");
  return updateAncillaryAction(raw);
}

export async function setAncillaryReconciliationAction(
  raw: Parameters<typeof setAncillaryReconciliationActionImpl>[0]
) {
  const { setAncillaryReconciliationAction } = await import("@/app/documentation-actions-impl");
  return setAncillaryReconciliationAction(raw);
}

export async function deleteWorkflowRecordAction(raw: Parameters<typeof deleteWorkflowRecordActionImpl>[0]) {
  const { deleteWorkflowRecordAction } = await import("@/app/documentation-actions-impl");
  return deleteWorkflowRecordAction(raw);
}
