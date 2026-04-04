"use server";

import {
  addMemberFileAction as addMemberFileActionImpl,
  addMemberFileFormAction as addMemberFileFormActionImpl,
  deleteMemberFileAction as deleteMemberFileActionImpl,
  getMemberFileDownloadUrlAction as getMemberFileDownloadUrlActionImpl
} from "./actions-impl";

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
  return addMemberFileActionImpl(raw);
}

export async function addMemberFileFormAction(formData: FormData) {
  return addMemberFileFormActionImpl(formData);
}

export async function deleteMemberFileAction(raw: MemberFileRefInput) {
  return deleteMemberFileActionImpl(raw);
}

export async function getMemberFileDownloadUrlAction(raw: MemberFileRefInput) {
  return getMemberFileDownloadUrlActionImpl(raw);
}
