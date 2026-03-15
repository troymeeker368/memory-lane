import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import { createClient } from "@/lib/supabase/server";

type CreateAncillaryChargeInput = {
  memberId: string;
  categoryId: string;
  serviceDate: string;
  latePickupTime?: string | null;
  notes?: string | null;
  sourceEntity?: string | null;
  sourceEntityId?: string | null;
  actorUserId: string;
};

type UpdateToiletLogWithAncillarySyncInput = {
  toiletLogId: string;
  notes?: string | null;
  useType: string;
  briefs: boolean;
  memberSupplied?: boolean;
  actorUserId: string;
};

function isPostgresColumnMissingError(error: unknown, columnName: string) {
  const candidate = error as { code?: string; message?: string } | null;
  return (
    candidate?.code === "42703" &&
    typeof candidate.message === "string" &&
    candidate.message.toLowerCase().includes(columnName.toLowerCase())
  );
}

function schemaDependencyError(details: string) {
  return new Error(`Missing Supabase schema dependency: ${details}`);
}

function isLatePickupCategory(categoryName?: string | null) {
  const normalized = (categoryName ?? "").toLowerCase();
  return normalized.includes("late pick-up") || normalized.includes("late pickup");
}

export async function createAncillaryChargeSupabase(input: CreateAncillaryChargeInput) {
  const canonicalMember = await resolveCanonicalMemberRef(
    {
      sourceType: "member",
      memberId: input.memberId,
      selectedId: input.memberId
    },
    {
      actionLabel: "createAncillaryChargeSupabase"
    }
  );
  if (!canonicalMember.memberId) {
    throw new Error("createAncillaryChargeSupabase expected member.id but canonical member resolution returned empty memberId.");
  }

  const supabase = await createClient();
  const { data: category, error: categoryError } = await supabase
    .from("ancillary_charge_categories")
    .select("id, name, price_cents")
    .eq("id", input.categoryId)
    .maybeSingle();
  if (categoryError) throw new Error(categoryError.message);
  if (!category) throw new Error("Ancillary charge category not found.");

  const requiresLatePickupTime = isLatePickupCategory(category.name);
  if (requiresLatePickupTime && !input.latePickupTime?.trim()) {
    throw new Error("Late pick-up time is required for late pick-up charges.");
  }

  const sourceEntity = input.sourceEntity?.trim() || null;
  const sourceEntityId = input.sourceEntityId?.trim() || null;
  const duplicateBaseQuery = supabase
    .from("ancillary_charge_logs")
    .select("id")
    .eq("member_id", canonicalMember.memberId)
    .eq("category_id", input.categoryId)
    .eq("service_date", input.serviceDate);
  const duplicateQuery =
    sourceEntity || sourceEntityId
      ? duplicateBaseQuery.eq("source_entity", sourceEntity).eq("source_entity_id", sourceEntityId)
      : duplicateBaseQuery.is("source_entity", null).is("source_entity_id", null);
  const { data: duplicate, error: duplicateError } = await duplicateQuery.limit(1).maybeSingle();
  if (duplicateError) {
    if (
      isPostgresColumnMissingError(duplicateError, "source_entity") ||
      isPostgresColumnMissingError(duplicateError, "source_entity_id")
    ) {
      throw schemaDependencyError(
        "public.ancillary_charge_logs requires source_entity text and source_entity_id text for de-duplication and workflow linkage."
      );
    }
    throw new Error(duplicateError.message);
  }
  if (duplicate) {
    throw new Error("Duplicate ancillary charge detected for this member/date/category/source.");
  }

  const quantity = 1;
  const unitRate = Number((Number(category.price_cents ?? 0) / 100).toFixed(2));
  const amount = Number((unitRate * quantity).toFixed(2));
  const { data, error } = await supabase
    .from("ancillary_charge_logs")
    .insert({
      member_id: canonicalMember.memberId,
      category_id: input.categoryId,
      service_date: input.serviceDate,
      late_pickup_time: requiresLatePickupTime ? input.latePickupTime?.trim() || null : null,
      staff_user_id: input.actorUserId,
      notes: input.notes ?? null,
      source_entity: sourceEntity,
      source_entity_id: sourceEntityId,
      quantity,
      unit_rate: unitRate,
      amount,
      billing_status: "Unbilled"
    })
    .select("id")
    .single();

  if (error) {
    if (
      isPostgresColumnMissingError(error, "source_entity") ||
      isPostgresColumnMissingError(error, "source_entity_id")
    ) {
      throw schemaDependencyError(
        "public.ancillary_charge_logs requires source_entity text and source_entity_id text for workflow linkage."
      );
    }
    throw new Error(error.message);
  }

  return {
    ancillaryChargeId: String(data.id)
  };
}

export async function updateAncillaryCategoryPriceSupabase(input: {
  categoryId: string;
  priceCents: number;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ancillary_charge_categories")
    .update({ price_cents: input.priceCents })
    .eq("id", input.categoryId)
    .select("id, name")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Ancillary charge category not found.");
  }

  return {
    id: String(data.id),
    name: String(data.name ?? "")
  };
}

export async function updateToiletLogWithAncillarySync(input: UpdateToiletLogWithAncillarySyncInput) {
  const supabase = await createClient();
  const { data: existingRow, error: existingError } = await supabase
    .from("toilet_logs")
    .select("id, member_id, event_at, member_supplied")
    .eq("id", input.toiletLogId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existingRow) throw new Error("Record not found.");

  const memberSupplied = input.memberSupplied ?? Boolean(existingRow.member_supplied);
  const { error: updateError } = await supabase
    .from("toilet_logs")
    .update({
      notes: input.notes ?? null,
      use_type: input.useType,
      briefs: input.briefs,
      member_supplied: memberSupplied
    })
    .eq("id", input.toiletLogId);
  if (updateError) throw new Error(updateError.message);

  const shouldHaveBriefsCharge = input.briefs && !memberSupplied;
  let warning: string | null = null;
  if (shouldHaveBriefsCharge) {
    const { data: briefsCategory, error: briefsCategoryError } = await supabase
      .from("ancillary_charge_categories")
      .select("id")
      .ilike("name", "briefs")
      .maybeSingle();
    if (briefsCategoryError) {
      warning = `Toilet log updated, but briefs ancillary category lookup failed (${briefsCategoryError.message}).`;
    }

    if (briefsCategory && !warning) {
      const { data: existingCharge, error: chargeLookupError } = await supabase
        .from("ancillary_charge_logs")
        .select("id")
        .eq("source_entity", "toiletLogs")
        .eq("source_entity_id", input.toiletLogId)
        .eq("category_id", briefsCategory.id)
        .maybeSingle();
      if (chargeLookupError) {
        if (
          isPostgresColumnMissingError(chargeLookupError, "source_entity") ||
          isPostgresColumnMissingError(chargeLookupError, "source_entity_id")
        ) {
          warning =
            "Toilet log updated, but linked ancillary sync requires public.ancillary_charge_logs columns source_entity text and source_entity_id text.";
        } else {
          warning = `Toilet log updated, but linked ancillary lookup failed (${chargeLookupError.message}).`;
        }
      }

      if (!existingCharge && !warning) {
        try {
          await createAncillaryChargeSupabase({
            memberId: String(existingRow.member_id),
            categoryId: String(briefsCategory.id),
            serviceDate: String(existingRow.event_at).slice(0, 10),
            latePickupTime: "",
            notes: "Auto-generated from Toilet Log edit (briefs changed and not member supplied)",
            sourceEntity: "toiletLogs",
            sourceEntityId: input.toiletLogId,
            actorUserId: input.actorUserId
          });
        } catch (error) {
          warning = `Toilet log updated, but linked ancillary charge could not be created (${error instanceof Error ? error.message : "Unknown error"}).`;
        }
      }
    }
  } else {
    const { data: linkedCharges, error: linkedError } = await supabase
      .from("ancillary_charge_logs")
      .select("id")
      .eq("source_entity", "toiletLogs")
      .eq("source_entity_id", input.toiletLogId);
    if (linkedError) {
      if (
        isPostgresColumnMissingError(linkedError, "source_entity") ||
        isPostgresColumnMissingError(linkedError, "source_entity_id")
      ) {
        warning =
          "Toilet log updated, but linked ancillary sync requires public.ancillary_charge_logs columns source_entity text and source_entity_id text.";
      } else {
        warning = `Toilet log updated, but linked ancillary lookup failed (${linkedError.message}).`;
      }
    }
    const chargeIds = !warning ? (linkedCharges ?? []).map((row) => row.id) : [];
    if (chargeIds.length > 0) {
      const { error: deleteChargeError } = await supabase.from("ancillary_charge_logs").delete().in("id", chargeIds);
      if (deleteChargeError) {
        warning = `Toilet log updated, but linked ancillary removal failed (${deleteChargeError.message}).`;
      }
    }
  }

  return {
    memberSupplied,
    warning
  };
}
