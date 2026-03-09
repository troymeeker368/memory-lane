"use server";

import { Buffer } from "node:buffer";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { saveGeneratedMemberPdfToFiles } from "@/lib/services/member-files";
import { getMemberFaceSheet } from "@/lib/services/member-face-sheet";
import { toEasternISO } from "@/lib/timezone";

function canGenerate(role: string) {
  return role === "admin" || role === "manager" || role === "nurse";
}

function lineOrDash(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : "-";
}

function listOrDash(values: string[]) {
  return values.length > 0 ? values.join(", ") : "-";
}

async function buildFaceSheetPdf(memberId: string) {
  const faceSheet = getMemberFaceSheet(memberId);
  if (!faceSheet) {
    return { error: "Member face sheet data not found." } as const;
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const brand = rgb(0.106, 0.243, 0.576);

  let y = 760;
  const left = 48;

  const write = (label: string, value: string, options?: { heading?: boolean }) => {
    if (options?.heading) {
      page.drawText(label, { x: left, y, size: 12, font: bold, color: brand });
      y -= 18;
      return;
    }
    page.drawText(`${label}: ${value}`, { x: left, y, size: 10, font: regular, color: rgb(0.1, 0.1, 0.1) });
    y -= 14;
  };

  write("Member Face Sheet", "", { heading: true });
  write("Facility", "Town Square Fort Mill");
  write("Generated", `${faceSheet.generatedAt} ET`);
  y -= 6;

  write("Identification", "", { heading: true });
  write("Member", faceSheet.member.name);
  write("DOB", lineOrDash(faceSheet.member.dob));
  write("Age", faceSheet.member.age == null ? "-" : String(faceSheet.member.age));
  write("Gender", lineOrDash(faceSheet.member.gender));
  write("Code Status", lineOrDash(faceSheet.legal.codeStatus));
  write("DNR", lineOrDash(faceSheet.legal.dnr));
  write("DNI", lineOrDash(faceSheet.legal.dni));
  y -= 6;

  write("Demographics", "", { heading: true });
  write("Address", lineOrDash(faceSheet.demographics.address));
  write("Primary Language", lineOrDash(faceSheet.demographics.primaryLanguage));
  write("Marital Status", lineOrDash(faceSheet.demographics.maritalStatus));
  write("Veteran", lineOrDash(faceSheet.demographics.veteran));
  y -= 6;

  write("Medical Summary", "", { heading: true });
  write("Primary Diagnoses", listOrDash(faceSheet.medical.primaryDiagnoses));
  write("Secondary Diagnoses", listOrDash(faceSheet.medical.secondaryDiagnoses));
  write("Diet", lineOrDash(faceSheet.medical.dietType));
  write("Diet Restrictions", lineOrDash(faceSheet.medical.dietRestrictions));
  write("Swallowing Difficulty", lineOrDash(faceSheet.medical.swallowingDifficulty));
  write("Oxygen Required", lineOrDash(faceSheet.medical.oxygenRequired));
  write(
    "Food Allergies",
    listOrDash(faceSheet.dietAllergyFlags.foodAllergies)
  );
  write(
    "Medication Allergies",
    listOrDash(faceSheet.dietAllergyFlags.medicationAllergies)
  );
  write(
    "Environmental Allergies",
    listOrDash(faceSheet.dietAllergyFlags.environmentalAllergies)
  );
  y -= 6;

  write("Contacts", "", { heading: true });
  const topContacts = faceSheet.contacts.slice(0, 4);
  if (topContacts.length === 0) {
    write("Contact", "-");
  } else {
    topContacts.forEach((contact, index) => {
      write(
        `Contact ${index + 1}`,
        `${lineOrDash(contact.category)} | ${lineOrDash(contact.name)} | ${lineOrDash(contact.phone)}`
      );
    });
  }

  const pdfBytes = await pdf.save();
  return {
    faceSheet,
    dataUrl: `data:application/pdf;base64,${Buffer.from(pdfBytes).toString("base64")}`
  } as const;
}

export async function generateMemberFaceSheetPdfAction(input: { memberId: string }) {
  const profile = await getCurrentProfile();
  if (!canGenerate(profile.role)) {
    return { ok: false, error: "You do not have access to generate face sheets." } as const;
  }

  const memberId = String(input.memberId ?? "").trim();
  if (!memberId) {
    return { ok: false, error: "Member is required." } as const;
  }

  const built = await buildFaceSheetPdf(memberId);
  if ("error" in built) {
    return { ok: false, error: built.error } as const;
  }

  const saved = saveGeneratedMemberPdfToFiles({
    memberId,
    memberName: built.faceSheet.member.name,
    documentLabel: "Face Sheet",
    documentSource: "Face Sheet Generator",
    category: "Health Unit",
    dataUrl: built.dataUrl,
    uploadedBy: {
      id: profile.id,
      name: profile.full_name
    },
    generatedAtIso: toEasternISO()
  });

  revalidatePath(`/members/${memberId}/face-sheet`);
  revalidatePath(`/operations/member-command-center/${memberId}`);
  revalidatePath(`/health/member-health-profiles/${memberId}`);

  return {
    ok: true,
    fileName: saved.fileName,
    dataUrl: built.dataUrl
  } as const;
}
