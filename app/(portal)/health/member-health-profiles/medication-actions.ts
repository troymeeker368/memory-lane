"use server";

export async function addMhpMedicationAction(formData: FormData) {
  const { addMhpMedicationAction } = await import("./actions-impl");
  return addMhpMedicationAction(formData);
}

export async function updateMhpMedicationAction(formData: FormData) {
  const { updateMhpMedicationAction } = await import("./actions-impl");
  return updateMhpMedicationAction(formData);
}

export async function addMhpMedicationInlineAction(formData: FormData) {
  const { addMhpMedicationInlineAction } = await import("./actions-impl");
  return addMhpMedicationInlineAction(formData);
}

export async function updateMhpMedicationInlineAction(formData: FormData) {
  const { updateMhpMedicationInlineAction } = await import("./actions-impl");
  return updateMhpMedicationInlineAction(formData);
}

export async function deleteMhpMedicationInlineAction(formData: FormData) {
  const { deleteMhpMedicationInlineAction } = await import("./actions-impl");
  return deleteMhpMedicationInlineAction(formData);
}

export async function inactivateMhpMedicationInlineAction(formData: FormData) {
  const { inactivateMhpMedicationInlineAction } = await import("./actions-impl");
  return inactivateMhpMedicationInlineAction(formData);
}

export async function reactivateMhpMedicationInlineAction(formData: FormData) {
  const { reactivateMhpMedicationInlineAction } = await import("./actions-impl");
  return reactivateMhpMedicationInlineAction(formData);
}
