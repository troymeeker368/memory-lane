import "server-only";

import {
  MEMBER_CONTACT_CATEGORY_OPTIONS
} from "@/lib/canonical";
import { deleteMemberCommandCenterContact, saveMemberCommandCenterContact } from "@/lib/services/member-command-center";
import { toEasternISO } from "@/lib/timezone";

import { normalizePhone, requireCommandCenterEditor, revalidateCommandCenter, toServiceActor } from "./shared";

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

export async function upsertMemberContactAction(raw: UpsertMemberContactInput) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = raw.memberId?.trim();
    const contactName = raw.contactName?.trim();
    const category = raw.category?.trim();

    if (!memberId || !contactName || !category) {
      return { error: "Member, contact name, and category are required." };
    }

    const normalizedCategory = MEMBER_CONTACT_CATEGORY_OPTIONS.includes(category as (typeof MEMBER_CONTACT_CATEGORY_OPTIONS)[number])
      ? category
      : "Other";
    const categoryOther = raw.categoryOther?.trim() || null;
    if (normalizedCategory === "Other" && !categoryOther) {
      return { error: "Custom category is required when category is Other." };
    }

    const now = toEasternISO();
    const saved = await saveMemberCommandCenterContact({
      id: raw.id?.trim() || undefined,
      memberId,
      contactName,
      relationshipToMember: raw.relationshipToMember?.trim() || null,
      category: normalizedCategory,
      categoryOther: normalizedCategory === "Other" ? categoryOther : null,
      email: raw.email?.trim() || null,
      cellularNumber: normalizePhone(raw.cellularNumber),
      workNumber: normalizePhone(raw.workNumber),
      homeNumber: normalizePhone(raw.homeNumber),
      streetAddress: raw.streetAddress?.trim() || null,
      city: raw.city?.trim() || null,
      state: raw.state?.trim() || null,
      zip: raw.zip?.trim() || null,
      isPayor: raw.isPayor === true,
      actor: toServiceActor(actor),
      now
    });
    if (raw.id?.trim() && !saved) return { error: "Contact not found." };

    revalidateCommandCenter(memberId);
    return { ok: true, row: saved };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save contact." };
  }
}

export async function deleteMemberContactAction(raw: { id: string; memberId: string }) {
  try {
    await requireCommandCenterEditor();
    const id = raw.id?.trim();
    const memberId = raw.memberId?.trim();
    if (!id || !memberId) return { error: "Invalid contact delete request." };

    await deleteMemberCommandCenterContact({ id });

    revalidateCommandCenter(memberId);
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to delete contact." };
  }
}
