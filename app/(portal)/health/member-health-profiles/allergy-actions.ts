"use server";

export async function addMhpAllergyAction(formData: FormData) {
  const { addMhpAllergyAction } = await import("./actions-impl");
  return addMhpAllergyAction(formData);
}

export async function updateMhpAllergyAction(formData: FormData) {
  const { updateMhpAllergyAction } = await import("./actions-impl");
  return updateMhpAllergyAction(formData);
}

export async function addMhpAllergyInlineAction(formData: FormData) {
  const { addMhpAllergyInlineAction } = await import("./actions-impl");
  return addMhpAllergyInlineAction(formData);
}

export async function deleteMhpAllergyInlineAction(formData: FormData) {
  const { deleteMhpAllergyInlineAction } = await import("./actions-impl");
  return deleteMhpAllergyInlineAction(formData);
}

export async function updateMhpAllergyInlineAction(formData: FormData) {
  const { updateMhpAllergyInlineAction } = await import("./actions-impl");
  return updateMhpAllergyInlineAction(formData);
}
