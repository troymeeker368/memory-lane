import { addMockRecord, getMockDb } from "@/lib/mock-repo";
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
  category: MemberFileCategory;
  categoryOther?: string | null;
  dataUrl: string;
  uploadedBy: {
    id: string;
    name: string;
  };
  generatedAtIso?: string;
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

export function saveGeneratedMemberPdfToFiles(input: SaveGeneratedMemberPdfInput) {
  const now = input.generatedAtIso ?? toEasternISO();
  const db = getMockDb();
  const defaultName = basePdfFileName(input.documentLabel, input.memberName, now);
  const hasConflict = db.memberFiles.some(
    (row) =>
      row.member_id === input.memberId &&
      row.file_name.trim().toLowerCase() === defaultName.trim().toLowerCase()
  );
  const fileName = hasConflict ? withDuplicateSuffix(defaultName, now) : defaultName;

  const created = addMockRecord("memberFiles", {
    member_id: input.memberId,
    file_name: fileName,
    file_type: "application/pdf",
    file_data_url: input.dataUrl,
    category: input.category,
    category_other: input.category === "Other" ? input.categoryOther ?? null : null,
    document_source: input.documentSource,
    uploaded_by_user_id: input.uploadedBy.id,
    uploaded_by_name: input.uploadedBy.name,
    uploaded_at: now,
    updated_at: now
  });

  return {
    created,
    fileName,
    generatedAtIso: now
  };
}
