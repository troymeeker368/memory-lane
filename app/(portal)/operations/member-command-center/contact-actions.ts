"use server";

type UpsertMemberContactInput = {
  id?: string;
  memberId: string;
  contactName: string;
  relationshipToMember?: string;
  category: string;
  categoryOther?: string;
  email?: string;
  cellularNumber?: string;
  workNumber?: string;
  homeNumber?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
};

type DeleteMemberContactInput = {
  id: string;
  memberId: string;
};

export async function upsertMemberContactAction(raw: UpsertMemberContactInput) {
  const { upsertMemberContactAction } = await import("./actions-impl");
  return upsertMemberContactAction(raw);
}

export async function deleteMemberContactAction(raw: DeleteMemberContactInput) {
  const { deleteMemberContactAction } = await import("./actions-impl");
  return deleteMemberContactAction(raw);
}
