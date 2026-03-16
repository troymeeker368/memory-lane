"use server";

export async function saveMemberCommandCenterSummaryAction(formData: FormData) {
  const { saveMemberCommandCenterSummaryAction } = await import("./actions-impl");
  return saveMemberCommandCenterSummaryAction(formData);
}

export async function updateMemberCommandCenterPhotoAction(formData: FormData) {
  const { updateMemberCommandCenterPhotoAction } = await import("./actions-impl");
  return updateMemberCommandCenterPhotoAction(formData);
}

export async function saveMemberCommandCenterAttendanceAction(formData: FormData) {
  const { saveMemberCommandCenterAttendanceAction } = await import("./actions-impl");
  return saveMemberCommandCenterAttendanceAction(formData);
}

export async function saveMemberCommandCenterTransportationAction(formData: FormData) {
  const { saveMemberCommandCenterTransportationAction } = await import("./actions-impl");
  return saveMemberCommandCenterTransportationAction(formData);
}

export async function saveMemberCommandCenterDemographicsAction(formData: FormData) {
  const { saveMemberCommandCenterDemographicsAction } = await import("./actions-impl");
  return saveMemberCommandCenterDemographicsAction(formData);
}

export async function saveMemberCommandCenterLegalAction(formData: FormData) {
  const { saveMemberCommandCenterLegalAction } = await import("./actions-impl");
  return saveMemberCommandCenterLegalAction(formData);
}

export async function saveMemberCommandCenterDietAction(formData: FormData) {
  const { saveMemberCommandCenterDietAction } = await import("./actions-impl");
  return saveMemberCommandCenterDietAction(formData);
}
