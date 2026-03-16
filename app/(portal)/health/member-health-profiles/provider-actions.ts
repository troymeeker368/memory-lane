"use server";

export async function addMhpProviderAction(formData: FormData) {
  const { addMhpProviderAction } = await import("./actions-impl");
  return addMhpProviderAction(formData);
}

export async function updateMhpProviderAction(formData: FormData) {
  const { updateMhpProviderAction } = await import("./actions-impl");
  return updateMhpProviderAction(formData);
}

export async function deleteMhpProviderAction(formData: FormData) {
  const { deleteMhpProviderAction } = await import("./actions-impl");
  return deleteMhpProviderAction(formData);
}

export async function addMhpProviderInlineAction(formData: FormData) {
  const { addMhpProviderInlineAction } = await import("./actions-impl");
  return addMhpProviderInlineAction(formData);
}

export async function deleteMhpProviderInlineAction(formData: FormData) {
  const { deleteMhpProviderInlineAction } = await import("./actions-impl");
  return deleteMhpProviderInlineAction(formData);
}

export async function updateMhpProviderInlineAction(formData: FormData) {
  const { updateMhpProviderInlineAction } = await import("./actions-impl");
  return updateMhpProviderInlineAction(formData);
}
