"use server";

import {
  addMemberCommandCenterAllergyInlineAction as addMemberCommandCenterAllergyInlineActionImpl,
  deleteMemberCommandCenterAllergyInlineAction as deleteMemberCommandCenterAllergyInlineActionImpl,
  updateMemberCommandCenterAllergyInlineAction as updateMemberCommandCenterAllergyInlineActionImpl
} from "./actions-impl";

export async function addMemberCommandCenterAllergyInlineAction(formData: FormData) {
  return addMemberCommandCenterAllergyInlineActionImpl(formData);
}

export async function updateMemberCommandCenterAllergyInlineAction(formData: FormData) {
  return updateMemberCommandCenterAllergyInlineActionImpl(formData);
}

export async function deleteMemberCommandCenterAllergyInlineAction(formData: FormData) {
  return deleteMemberCommandCenterAllergyInlineActionImpl(formData);
}
