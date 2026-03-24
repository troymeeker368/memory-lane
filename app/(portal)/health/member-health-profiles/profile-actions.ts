"use server";

import {
  saveMhpCognitiveBehaviorAction as saveMhpCognitiveBehaviorActionImpl,
  saveMhpFunctionalAction as saveMhpFunctionalActionImpl,
  saveMhpLegalAction as saveMhpLegalActionImpl,
  saveMhpMedicalAction as saveMhpMedicalActionImpl,
  saveMhpOverviewAction as saveMhpOverviewActionImpl,
  updateMhpPhotoAction as updateMhpPhotoActionImpl,
  updateMhpTrackInlineAction as updateMhpTrackInlineActionImpl
} from "./actions-impl";

export async function saveMhpOverviewAction(formData: FormData) {
  return saveMhpOverviewActionImpl(formData);
}

export async function updateMhpPhotoAction(formData: FormData) {
  return updateMhpPhotoActionImpl(formData);
}

export async function saveMhpMedicalAction(formData: FormData) {
  return saveMhpMedicalActionImpl(formData);
}

export async function saveMhpFunctionalAction(formData: FormData) {
  return saveMhpFunctionalActionImpl(formData);
}

export async function saveMhpCognitiveBehaviorAction(formData: FormData) {
  return saveMhpCognitiveBehaviorActionImpl(formData);
}

export async function saveMhpLegalAction(formData: FormData) {
  return saveMhpLegalActionImpl(formData);
}

export async function updateMhpTrackInlineAction(formData: FormData) {
  return updateMhpTrackInlineActionImpl(formData);
}
