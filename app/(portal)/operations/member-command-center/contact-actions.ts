"use server";

import {
  deleteMemberContactAction as deleteMemberContactActionImpl,
  upsertMemberContactAction as upsertMemberContactActionImpl
} from "./actions-impl";

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
  isPayor?: boolean;
};

type DeleteMemberContactInput = {
  id: string;
  memberId: string;
};

export async function upsertMemberContactAction(raw: UpsertMemberContactInput) {
  return upsertMemberContactActionImpl(raw);
}

export async function deleteMemberContactAction(raw: DeleteMemberContactInput) {
  return deleteMemberContactActionImpl(raw);
}
