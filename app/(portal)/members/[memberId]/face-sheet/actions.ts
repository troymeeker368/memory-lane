"use server";

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import {
  DOCUMENT_CENTER_ADDRESS,
  DOCUMENT_CENTER_LOGO_PUBLIC_PATH,
  DOCUMENT_CENTER_NAME,
  DOCUMENT_CENTER_PHONE
} from "@/lib/services/document-branding";
import { saveGeneratedMemberPdfToFiles } from "@/lib/services/member-files";
import { getMemberFaceSheet } from "@/lib/services/member-face-sheet";
import { toEasternISO } from "@/lib/timezone";
import type { PDFDocument as PDFDocumentType } from "pdf-lib";

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

function publicAssetPath(publicPath: string) {
  const normalized = publicPath.startsWith("/") ? publicPath.slice(1) : publicPath;
  return path.join(process.cwd(), "public", normalized);
}

async function loadCenterLogoImage(pdf: PDFDocumentType) {
  try {
    const bytes = await readFile(publicAssetPath(DOCUMENT_CENTER_LOGO_PUBLIC_PATH));
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

async function buildFaceSheetPdf(memberId: string) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const faceSheet = await getMemberFaceSheet(memberId);
  if (!faceSheet) {
    return { error: "Member face sheet data not found." } as const;
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const logo = await loadCenterLogoImage(pdf);
  const brand = rgb(0.106, 0.243, 0.576);

  const pageWidth = page.getWidth();
  const left = 48;
  let y = 760;

  if (logo) {
    const logoHeight = 38;
    const scaled = logo.scale(logoHeight / logo.height);
    const logoWidth = Math.min(scaled.width, 160);
    page.drawImage(logo, {
      x: left,
      y: y - logoHeight + 4,
      width: logoWidth,
      height: logoHeight
    });
  }

  const centerX = pageWidth / 2;
  page.drawText(DOCUMENT_CENTER_NAME, {
    x: centerX - bold.widthOfTextAtSize(DOCUMENT_CENTER_NAME, 14) / 2,
    y,
    size: 14,
    font: bold,
    color: brand
  });
  y -= 14;
  page.drawText(DOCUMENT_CENTER_ADDRESS, {
    x: centerX - regular.widthOfTextAtSize(DOCUMENT_CENTER_ADDRESS, 9.5) / 2,
    y,
    size: 9.5,
    font: regular,
    color: rgb(0.1, 0.1, 0.1)
  });
  y -= 12;
  page.drawText(DOCUMENT_CENTER_PHONE, {
    x: centerX - regular.widthOfTextAtSize(DOCUMENT_CENTER_PHONE, 9.5) / 2,
    y,
    size: 9.5,
    font: regular,
    color: rgb(0.1, 0.1, 0.1)
  });

  const generated = `Generated: ${faceSheet.generatedAt} ET`;
  page.drawText(generated, {
    x: pageWidth - regular.widthOfTextAtSize(generated, 8.5) - left,
    y: 760,
    size: 8.5,
    font: regular,
    color: rgb(0.1, 0.1, 0.1)
  });
  page.drawLine({
    start: { x: left, y: 712 },
    end: { x: pageWidth - left, y: 712 },
    color: rgb(0.75, 0.78, 0.84),
    thickness: 1
  });
  y = 694;

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
  write("Facility", DOCUMENT_CENTER_NAME);
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

  const saved = await saveGeneratedMemberPdfToFiles({
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

