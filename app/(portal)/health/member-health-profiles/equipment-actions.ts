"use server";

import {
  addMhpEquipmentAction as addMhpEquipmentActionImpl,
  addMhpEquipmentInlineAction as addMhpEquipmentInlineActionImpl,
  deleteMhpEquipmentInlineAction as deleteMhpEquipmentInlineActionImpl,
  updateMhpEquipmentAction as updateMhpEquipmentActionImpl,
  updateMhpEquipmentInlineAction as updateMhpEquipmentInlineActionImpl
} from "./actions-impl";

export async function addMhpEquipmentAction(formData: FormData) {
  return addMhpEquipmentActionImpl(formData);
}

export async function updateMhpEquipmentAction(formData: FormData) {
  return updateMhpEquipmentActionImpl(formData);
}

export async function addMhpEquipmentInlineAction(formData: FormData) {
  return addMhpEquipmentInlineActionImpl(formData);
}

export async function updateMhpEquipmentInlineAction(formData: FormData) {
  return updateMhpEquipmentInlineActionImpl(formData);
}

export async function deleteMhpEquipmentInlineAction(formData: FormData) {
  return deleteMhpEquipmentInlineActionImpl(formData);
}
