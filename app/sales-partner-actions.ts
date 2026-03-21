"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth";
import { LEAD_ACTIVITY_TYPES, LEAD_FOLLOW_UP_TYPES } from "@/lib/canonical";
import {
  createCommunityPartnerSupabase,
  createPartnerActivitySupabase,
  createReferralSourceSupabase
} from "@/lib/services/sales-crm-supabase";

import { optionalString, requireSalesRoles } from "@/app/sales-action-helpers";

const partnerActivitySchema = z.object({
  partnerId: z.string().min(1),
  referralSourceId: z.string().min(1),
  leadId: optionalString,
  activityAt: optionalString,
  activityType: z.enum(LEAD_ACTIVITY_TYPES),
  notes: optionalString,
  nextFollowUpDate: optionalString,
  nextFollowUpType: z.enum(LEAD_FOLLOW_UP_TYPES).optional().or(z.literal(""))
});

export async function createPartnerActivityAction(raw: z.infer<typeof partnerActivitySchema>) {
  await requireSalesRoles();
  const payload = partnerActivitySchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid partner activity." };
  }

  const profile = await getCurrentProfile();
  let created;
  try {
    created = await createPartnerActivitySupabase({
      partnerId: payload.data.partnerId,
      referralSourceId: payload.data.referralSourceId,
      activityAt: payload.data.activityAt || null,
      activityType: payload.data.activityType,
      notes: payload.data.notes || null,
      nextFollowUpDate: payload.data.nextFollowUpDate || null,
      nextFollowUpType: payload.data.nextFollowUpType || null,
      completedByName: profile.full_name
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create partner activity." };
  }

  revalidatePath("/sales/community-partners");
  revalidatePath("/sales/new-entries/log-partner-activities");
  revalidatePath("/sales/activities");
  revalidatePath(`/sales/community-partners/organizations/${created.partner.id}`);
  revalidatePath(`/sales/community-partners/referral-sources/${created.referralSource.id}`);
  return { ok: true };
}

const communityPartnerSchema = z.object({
  organizationName: z.string().min(1),
  referralSourceCategory: z.string().min(1),
  location: optionalString,
  primaryPhone: optionalString,
  secondaryPhone: optionalString,
  primaryEmail: optionalString,
  contactName: optionalString,
  notes: optionalString,
  active: z.boolean().default(true)
});

export async function createCommunityPartnerAction(raw: z.infer<typeof communityPartnerSchema>) {
  await requireSalesRoles();
  const payload = communityPartnerSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid community partner entry." };
  }

  let created;
  try {
    created = await createCommunityPartnerSupabase({
      organizationName: payload.data.organizationName,
      referralSourceCategory: payload.data.referralSourceCategory,
      location: payload.data.location || null,
      primaryPhone: payload.data.primaryPhone || null,
      secondaryPhone: payload.data.secondaryPhone || null,
      primaryEmail: payload.data.primaryEmail || null,
      notes: payload.data.notes || null,
      active: payload.data.active
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create community partner." };
  }

  revalidatePath("/sales/community-partners/organizations");
  revalidatePath("/sales/new-entries/new-community-partner");
  return {
    ok: true,
    id: created.id,
    partner: created.partner
  };
}

const referralSourceSchema = z.object({
  partnerId: z.string().min(1),
  contactName: z.string().min(1),
  jobTitle: optionalString,
  primaryPhone: optionalString,
  secondaryPhone: optionalString,
  primaryEmail: optionalString,
  preferredContactMethod: optionalString,
  notes: optionalString,
  active: z.boolean().default(true)
});

export async function createReferralSourceAction(raw: z.infer<typeof referralSourceSchema>) {
  await requireSalesRoles();
  const payload = referralSourceSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid referral source entry." };
  }

  let created;
  try {
    created = await createReferralSourceSupabase({
      partnerId: payload.data.partnerId,
      contactName: payload.data.contactName,
      jobTitle: payload.data.jobTitle || null,
      primaryPhone: payload.data.primaryPhone || null,
      secondaryPhone: payload.data.secondaryPhone || null,
      primaryEmail: payload.data.primaryEmail || null,
      preferredContactMethod: payload.data.preferredContactMethod || null,
      notes: payload.data.notes || null,
      active: payload.data.active
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create referral source." };
  }

  revalidatePath("/sales/community-partners/referral-sources");
  revalidatePath("/sales/new-entries/new-referral-source");
  return {
    ok: true,
    id: created.id,
    source: created.source
  };
}
