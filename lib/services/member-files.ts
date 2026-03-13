import { randomUUID } from "node:crypto";

import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

type MemberFileCategory =
  | "Health Unit"
  | "Legal"
  | "Admin"
  | "Assessment"
  | "Care Plan"
  | "Orders / POF"
  | "Billing"
  | "Name Badge"
  | "Other";

type SaveGeneratedMemberPdfInput = {
  memberId: string;
  memberName: string;
  documentLabel: string;
  documentSource: string;
  carePlanId?: string | null;
  category: MemberFileCategory;
  categoryOther?: string | null;
  dataUrl: string;
  uploadedBy: {
    id: string;
    name: string;
  };
  generatedAtIso?: string;
  replaceExistingByDocumentSource?: boolean;
};

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*]/g, "").trim();
}

function basePdfFileName(documentLabel: string, memberName: string, whenIso: string) {
  const day = toEasternDate(whenIso);
  return `${safeFileName(documentLabel)} - ${safeFileName(memberName)} - ${day}.pdf`;
}

function withDuplicateSuffix(fileName: string, timestampIso: string) {
  const extension = ".pdf";
  if (!fileName.toLowerCase().endsWith(extension)) return fileName;
  const root = fileName.slice(0, -extension.length);
  const suffix = timestampIso.slice(11, 19).replaceAll(":", "");
  return `${root} - ${suffix}${extension}`;
}

function nextMemberFileId() {
  return `mf_${randomUUID().replace(/-/g, "")}`;
}

export async function saveGeneratedMemberPdfToFiles(input: SaveGeneratedMemberPdfInput) {
  const now = input.generatedAtIso ?? toEasternISO();
  const canonical = await resolveCanonicalMemberRef(
    {
      sourceType: "member",
      memberId: input.memberId,
      selectedId: input.memberId
    },
    {
      actionLabel: "saveGeneratedMemberPdfToFiles"
    }
  );
  if (!canonical.memberId) {
    throw new Error("saveGeneratedMemberPdfToFiles expected member.id but canonical member resolution returned empty memberId.");
  }
  const memberId = canonical.memberId;
  const supabase = await createClient();
  const defaultName = basePdfFileName(input.documentLabel, input.memberName, now);
  const categoryOther = input.category === "Other" ? input.categoryOther ?? null : null;

  if (input.replaceExistingByDocumentSource) {
    const { data: existing, error: existingError } = await supabase
      .from("member_files")
      .select("id")
      .eq("member_id", memberId)
      .eq("document_source", input.documentSource)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from("member_files")
        .update({
          file_name: defaultName,
          file_type: "application/pdf",
          file_data_url: input.dataUrl,
          care_plan_id: input.carePlanId ?? null,
          category: input.category,
          category_other: categoryOther,
          document_source: input.documentSource,
          uploaded_by_user_id: input.uploadedBy.id,
          uploaded_by_name: input.uploadedBy.name,
          uploaded_at: now,
          updated_at: now
        })
        .eq("id", existing.id)
        .select("*")
        .maybeSingle();

      if (updateError) {
        throw new Error(updateError.message);
      }

      if (updated) {
        return {
          created: updated,
          fileName: defaultName,
          generatedAtIso: now
        };
      }
    }
  }

  const { data: duplicateRows, error: duplicateError } = await supabase
    .from("member_files")
    .select("id")
    .eq("member_id", memberId)
    .eq("file_name", defaultName);

  if (duplicateError) {
    throw new Error(duplicateError.message);
  }

  const hasConflict = (duplicateRows ?? []).length > 0;
  const fileName = hasConflict ? withDuplicateSuffix(defaultName, now) : defaultName;

  const { data: created, error: createError } = await supabase
    .from("member_files")
    .insert({
      id: nextMemberFileId(),
      member_id: memberId,
      file_name: fileName,
      file_type: "application/pdf",
      file_data_url: input.dataUrl,
      care_plan_id: input.carePlanId ?? null,
      category: input.category,
      category_other: categoryOther,
      document_source: input.documentSource,
      uploaded_by_user_id: input.uploadedBy.id,
      uploaded_by_name: input.uploadedBy.name,
      uploaded_at: now,
      updated_at: now
    })
    .select("*")
    .single();

  if (createError) {
    throw new Error(createError.message);
  }

  return {
    created,
    fileName,
    generatedAtIso: now
  };
}
