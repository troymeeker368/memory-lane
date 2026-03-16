"use server";

export async function addMhpEquipmentAction(formData: FormData) {
  const { addMhpEquipmentAction } = await import("./actions-impl");
  return addMhpEquipmentAction(formData);
}

export async function updateMhpEquipmentAction(formData: FormData) {
  const { updateMhpEquipmentAction } = await import("./actions-impl");
  return updateMhpEquipmentAction(formData);
}

export async function addMhpEquipmentInlineAction(formData: FormData) {
  const { addMhpEquipmentInlineAction } = await import("./actions-impl");
  return addMhpEquipmentInlineAction(formData);
}

export async function updateMhpEquipmentInlineAction(formData: FormData) {
  const { updateMhpEquipmentInlineAction } = await import("./actions-impl");
  return updateMhpEquipmentInlineAction(formData);
}

export async function deleteMhpEquipmentInlineAction(formData: FormData) {
  const { deleteMhpEquipmentInlineAction } = await import("./actions-impl");
  return deleteMhpEquipmentInlineAction(formData);
}
