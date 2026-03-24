"use server";

import {
  addMhpMedicationAction as addMhpMedicationActionImpl,
  addMhpMedicationInlineAction as addMhpMedicationInlineActionImpl,
  deleteMhpMedicationInlineAction as deleteMhpMedicationInlineActionImpl,
  inactivateMhpMedicationInlineAction as inactivateMhpMedicationInlineActionImpl,
  reactivateMhpMedicationInlineAction as reactivateMhpMedicationInlineActionImpl,
  updateMhpMedicationAction as updateMhpMedicationActionImpl,
  updateMhpMedicationInlineAction as updateMhpMedicationInlineActionImpl
} from "./actions-impl";

export async function addMhpMedicationAction(formData: FormData) {
  return addMhpMedicationActionImpl(formData);
}

export async function updateMhpMedicationAction(formData: FormData) {
  return updateMhpMedicationActionImpl(formData);
}

export async function addMhpMedicationInlineAction(formData: FormData) {
  return addMhpMedicationInlineActionImpl(formData);
}

export async function updateMhpMedicationInlineAction(formData: FormData) {
  return updateMhpMedicationInlineActionImpl(formData);
}

export async function deleteMhpMedicationInlineAction(formData: FormData) {
  return deleteMhpMedicationInlineActionImpl(formData);
}

export async function inactivateMhpMedicationInlineAction(formData: FormData) {
  return inactivateMhpMedicationInlineActionImpl(formData);
}

export async function reactivateMhpMedicationInlineAction(formData: FormData) {
  return reactivateMhpMedicationInlineActionImpl(formData);
}
