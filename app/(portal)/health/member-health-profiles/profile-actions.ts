"use server";

export async function saveMhpOverviewAction(formData: FormData) {
  const { saveMhpOverviewAction } = await import("./actions-impl");
  return saveMhpOverviewAction(formData);
}

export async function updateMhpPhotoAction(formData: FormData) {
  const { updateMhpPhotoAction } = await import("./actions-impl");
  return updateMhpPhotoAction(formData);
}

export async function saveMhpMedicalAction(formData: FormData) {
  const { saveMhpMedicalAction } = await import("./actions-impl");
  return saveMhpMedicalAction(formData);
}

export async function saveMhpFunctionalAction(formData: FormData) {
  const { saveMhpFunctionalAction } = await import("./actions-impl");
  return saveMhpFunctionalAction(formData);
}

export async function saveMhpCognitiveBehaviorAction(formData: FormData) {
  const { saveMhpCognitiveBehaviorAction } = await import("./actions-impl");
  return saveMhpCognitiveBehaviorAction(formData);
}

export async function saveMhpLegalAction(formData: FormData) {
  const { saveMhpLegalAction } = await import("./actions-impl");
  return saveMhpLegalAction(formData);
}

export async function updateMhpTrackInlineAction(formData: FormData) {
  const { updateMhpTrackInlineAction } = await import("./actions-impl");
  return updateMhpTrackInlineAction(formData);
}
