"use server";

import {
  addMhpAllergyAction as addMhpAllergyActionImpl,
  addMhpAllergyInlineAction as addMhpAllergyInlineActionImpl,
  deleteMhpAllergyInlineAction as deleteMhpAllergyInlineActionImpl,
  updateMhpAllergyAction as updateMhpAllergyActionImpl,
  updateMhpAllergyInlineAction as updateMhpAllergyInlineActionImpl
} from "./actions-impl";

export async function addMhpAllergyAction(formData: FormData) {
  return addMhpAllergyActionImpl(formData);
}

export async function updateMhpAllergyAction(formData: FormData) {
  return updateMhpAllergyActionImpl(formData);
}

export async function addMhpAllergyInlineAction(formData: FormData) {
  return addMhpAllergyInlineActionImpl(formData);
}

export async function deleteMhpAllergyInlineAction(formData: FormData) {
  return deleteMhpAllergyInlineActionImpl(formData);
}

export async function updateMhpAllergyInlineAction(formData: FormData) {
  return updateMhpAllergyInlineActionImpl(formData);
}
