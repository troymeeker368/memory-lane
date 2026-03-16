"use server";

type AddMemberFileInput = {
  memberId: string;
  fileName: string;
  fileType?: string;
  fileDataUrl?: string;
  category: string;
  categoryOther?: string;
  documentSource?: string;
  uploadToken?: string;
};

type MemberFileRefInput = {
  id: string;
  memberId: string;
};

export async function addMemberFileAction(raw: AddMemberFileInput) {
  const { addMemberFileAction } = await import("./actions-impl");
  return addMemberFileAction(raw);
}

export async function deleteMemberFileAction(raw: MemberFileRefInput) {
  const { deleteMemberFileAction } = await import("./actions-impl");
  return deleteMemberFileAction(raw);
}

export async function getMemberFileDownloadUrlAction(raw: MemberFileRefInput) {
  const { getMemberFileDownloadUrlAction } = await import("./actions-impl");
  return getMemberFileDownloadUrlAction(raw);
}
