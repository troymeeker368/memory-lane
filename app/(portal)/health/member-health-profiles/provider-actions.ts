"use server";

import {
  addMhpProviderAction as addMhpProviderActionImpl,
  addMhpProviderInlineAction as addMhpProviderInlineActionImpl,
  deleteMhpProviderAction as deleteMhpProviderActionImpl,
  deleteMhpProviderInlineAction as deleteMhpProviderInlineActionImpl,
  updateMhpProviderAction as updateMhpProviderActionImpl,
  updateMhpProviderInlineAction as updateMhpProviderInlineActionImpl
} from "./actions-impl";

export async function addMhpProviderAction(formData: FormData) {
  return addMhpProviderActionImpl(formData);
}

export async function updateMhpProviderAction(formData: FormData) {
  return updateMhpProviderActionImpl(formData);
}

export async function deleteMhpProviderAction(formData: FormData) {
  return deleteMhpProviderActionImpl(formData);
}

export async function addMhpProviderInlineAction(formData: FormData) {
  return addMhpProviderInlineActionImpl(formData);
}

export async function deleteMhpProviderInlineAction(formData: FormData) {
  return deleteMhpProviderInlineActionImpl(formData);
}

export async function updateMhpProviderInlineAction(formData: FormData) {
  return updateMhpProviderInlineActionImpl(formData);
}
