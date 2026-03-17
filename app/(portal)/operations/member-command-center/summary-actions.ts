"use server";

import {
  saveMemberCommandCenterAttendanceAction as saveMemberCommandCenterAttendanceActionImpl,
  saveMemberCommandCenterDemographicsAction as saveMemberCommandCenterDemographicsActionImpl,
  saveMemberCommandCenterDietAction as saveMemberCommandCenterDietActionImpl,
  saveMemberCommandCenterLegalAction as saveMemberCommandCenterLegalActionImpl,
  saveMemberCommandCenterSummaryAction as saveMemberCommandCenterSummaryActionImpl,
  saveMemberCommandCenterTransportationAction as saveMemberCommandCenterTransportationActionImpl,
  updateMemberCommandCenterPhotoAction as updateMemberCommandCenterPhotoActionImpl
} from "./actions-impl";

export async function saveMemberCommandCenterSummaryAction(formData: FormData) {
  return saveMemberCommandCenterSummaryActionImpl(formData);
}

export async function updateMemberCommandCenterPhotoAction(formData: FormData) {
  return updateMemberCommandCenterPhotoActionImpl(formData);
}

export async function saveMemberCommandCenterAttendanceAction(formData: FormData) {
  return saveMemberCommandCenterAttendanceActionImpl(formData);
}

export async function saveMemberCommandCenterTransportationAction(formData: FormData) {
  return saveMemberCommandCenterTransportationActionImpl(formData);
}

export async function saveMemberCommandCenterDemographicsAction(formData: FormData) {
  return saveMemberCommandCenterDemographicsActionImpl(formData);
}

export async function saveMemberCommandCenterLegalAction(formData: FormData) {
  return saveMemberCommandCenterLegalActionImpl(formData);
}

export async function saveMemberCommandCenterDietAction(formData: FormData) {
  return saveMemberCommandCenterDietActionImpl(formData);
}
