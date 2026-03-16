"use server";

export async function addMemberCommandCenterAllergyInlineAction(formData: FormData) {
  const { addMemberCommandCenterAllergyInlineAction } = await import("./actions-impl");
  return addMemberCommandCenterAllergyInlineAction(formData);
}

export async function updateMemberCommandCenterAllergyInlineAction(formData: FormData) {
  const { updateMemberCommandCenterAllergyInlineAction } = await import("./actions-impl");
  return updateMemberCommandCenterAllergyInlineAction(formData);
}

export async function deleteMemberCommandCenterAllergyInlineAction(formData: FormData) {
  const { deleteMemberCommandCenterAllergyInlineAction } = await import("./actions-impl");
  return deleteMemberCommandCenterAllergyInlineAction(formData);
}
