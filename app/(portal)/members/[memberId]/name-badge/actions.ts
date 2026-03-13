"use server";

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { saveGeneratedMemberPdfToFiles } from "@/lib/services/member-files";
import { getMemberNameBadgeDetail } from "@/lib/services/member-name-badge";
import { toEasternISO } from "@/lib/timezone";
import type { PDFDocument as PDFDocumentType } from "pdf-lib";

const MILLIMETER_TO_POINTS = 72 / 25.4;
const BADGE_WIDTH_MM = 100;
const BADGE_HEIGHT_MM = 85;

const BADGE_LAYOUT = {
  sidePaddingMm: 6.3,
  logoTopMm: 7.9,
  logoWidthMm: 42.3,
  nameTopMm: 30.2,
  nameMaxSizePt: 22,
  nameMinSizePt: 14,
  lockerTopMm: 45.1,
  lockerSizePt: 13,
  dividerTopMm: 57.7,
  dividerThicknessPt: 1.5,
  iconsTopMm: 60.9,
  iconSizeMm: 9.5,
  iconGapMm: 2.1,
  textBadgeWidthMm: 11.9
} as const;

function toPoints(mm: number) {
  return mm * MILLIMETER_TO_POINTS;
}

function toPageYFromTop(pageHeight: number, topMm: number, heightPoints = 0) {
  return pageHeight - toPoints(topMm) - heightPoints;
}

function roleCanGenerate(role: string) {
  return role === "admin" || role === "manager" || role === "nurse";
}

function imagePathFromPublicSrc(src: string) {
  const normalized = src.startsWith("/") ? src.slice(1) : src;
  return path.join(process.cwd(), "public", normalized.replaceAll("/", path.sep));
}

async function loadPngFromPublic(pdf: PDFDocumentType, src: string) {
  try {
    const bytes = await readFile(imagePathFromPublicSrc(src));
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

async function buildNameBadgePdfDataUrl(memberId: string, selectedIndicatorKeys?: string[]) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const badge = await getMemberNameBadgeDetail(memberId);
  if (!badge) {
    return { error: "Member badge data not found." } as const;
  }
  const memberDisplayName = (badge.member.displayName ?? "").trim();
  if (!memberDisplayName) {
    return {
      error:
        "Unable to generate badge: this member does not have a usable name. Add a preferred/first/last name or full display name, then try again."
    } as const;
  }

  const pageWidth = toPoints(BADGE_WIDTH_MM);
  const pageHeight = toPoints(BADGE_HEIGHT_MM);
  const sidePadding = toPoints(BADGE_LAYOUT.sidePaddingMm);
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([pageWidth, pageHeight]);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brandBlue = rgb(0.106, 0.243, 0.576);

  const logoWidth = toPoints(BADGE_LAYOUT.logoWidthMm);
  let logoHeight = toPoints(12);
  const logoImage = await loadPngFromPublic(pdf, badge.logoSrc);
  if (logoImage) {
    const logoScale = logoWidth / logoImage.width;
    const scaledLogoWidth = logoImage.width * logoScale;
    logoHeight = logoImage.height * logoScale;
    page.drawImage(logoImage, {
      x: (pageWidth - scaledLogoWidth) / 2,
      y: toPageYFromTop(pageHeight, BADGE_LAYOUT.logoTopMm, logoHeight),
      width: scaledLogoWidth,
      height: logoHeight
    });
  } else {
    const fallbackText = "Town Square";
    const fallbackSize = 12;
    page.drawText(fallbackText, {
      x: (pageWidth - fontBold.widthOfTextAtSize(fallbackText, fallbackSize)) / 2,
      y: toPageYFromTop(pageHeight, BADGE_LAYOUT.logoTopMm + 2, fallbackSize),
      size: fallbackSize,
      font: fontBold,
      color: brandBlue
    });
  }

  const availableNameWidth = pageWidth - sidePadding * 2;
  let nameFontSize = BADGE_LAYOUT.nameMaxSizePt;
  while (
    nameFontSize > BADGE_LAYOUT.nameMinSizePt &&
    fontBold.widthOfTextAtSize(memberDisplayName, nameFontSize) > availableNameWidth
  ) {
    nameFontSize -= 1;
  }
  const nameTextWidth = fontBold.widthOfTextAtSize(memberDisplayName, nameFontSize);
  page.drawText(memberDisplayName, {
    x: Math.max(sidePadding, (pageWidth - nameTextWidth) / 2),
    y: toPageYFromTop(pageHeight, BADGE_LAYOUT.nameTopMm, nameFontSize),
    size: nameFontSize,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1)
  });

  const lockerLabel = badge.member.lockerNumber ? `LOCKER ${badge.member.lockerNumber}` : "LOCKER ##";
  const lockerSize = BADGE_LAYOUT.lockerSizePt;
  const lockerWidth = fontBold.widthOfTextAtSize(lockerLabel, lockerSize);
  page.drawText(lockerLabel, {
    x: (pageWidth - lockerWidth) / 2,
    y: toPageYFromTop(pageHeight, BADGE_LAYOUT.lockerTopMm, lockerSize),
    size: lockerSize,
    font: fontBold,
    color: brandBlue
  });

  const dividerY = toPageYFromTop(pageHeight, BADGE_LAYOUT.dividerTopMm);
  page.drawLine({
    start: { x: sidePadding, y: dividerY },
    end: { x: pageWidth - sidePadding, y: dividerY },
    thickness: BADGE_LAYOUT.dividerThicknessPt,
    color: brandBlue
  });

  const allowedKeys = new Set(badge.indicators.map((indicator) => indicator.key));
  const selectedKeys =
    Array.isArray(selectedIndicatorKeys)
      ? new Set(selectedIndicatorKeys.filter((key) => allowedKeys.has(key as (typeof badge.indicators)[number]["key"])))
      : null;
  const enabledIndicators = badge.indicators.filter((indicator) =>
    selectedKeys ? selectedKeys.has(indicator.key) : indicator.enabled
  );
  const iconSize = toPoints(BADGE_LAYOUT.iconSizeMm);
  const iconGap = toPoints(BADGE_LAYOUT.iconGapMm);
  const textBadgeWidth = toPoints(BADGE_LAYOUT.textBadgeWidthMm);
  const totalUnits = enabledIndicators.reduce((width, indicator, index) => {
    const nextWidth = indicator.iconSrc ? iconSize : textBadgeWidth;
    return width + nextWidth + (index > 0 ? iconGap : 0);
  }, 0);
  let cursorX = Math.max(sidePadding, (pageWidth - totalUnits) / 2);
  const iconY = toPageYFromTop(pageHeight, BADGE_LAYOUT.iconsTopMm, iconSize);

  for (const indicator of enabledIndicators) {
    if (indicator.iconSrc) {
      const embedded = await loadPngFromPublic(pdf, indicator.iconSrc);
      if (embedded) {
        page.drawImage(embedded, {
          x: cursorX,
          y: iconY,
          width: iconSize,
          height: iconSize
        });
      } else {
        page.drawRectangle({
          x: cursorX,
          y: iconY,
          width: iconSize,
          height: iconSize,
          borderColor: brandBlue,
          borderWidth: 1
        });
      }
      cursorX += iconSize + iconGap;
      continue;
    }

    page.drawRectangle({
      x: cursorX,
      y: iconY,
      width: textBadgeWidth,
      height: iconSize,
      borderColor: brandBlue,
      borderWidth: 1
    });
    cursorX += textBadgeWidth + iconGap;
  }

  const pdfBytes = await pdf.save();
  const dataUrl = `data:application/pdf;base64,${Buffer.from(pdfBytes).toString("base64")}`;
  return {
    badge,
    dataUrl
  } as const;
}

export async function generateMemberNameBadgePdfAction(input: {
  memberId: string;
  selectedIndicatorKeys?: string[];
}) {
  const profile = await getCurrentProfile();
  if (!roleCanGenerate(profile.role)) {
    return { ok: false, error: "You do not have access to generate member badges." } as const;
  }

  const memberId = String(input.memberId ?? "").trim();
  if (!memberId) {
    return { ok: false, error: "Member is required." } as const;
  }

  const built = await buildNameBadgePdfDataUrl(memberId, input.selectedIndicatorKeys);
  if ("error" in built) {
    return { ok: false, error: built.error } as const;
  }

  const saved = await saveGeneratedMemberPdfToFiles({
    memberId,
    memberName: built.badge.member.displayName ?? "Member",
    documentLabel: "Name Badge",
    documentSource: "Name Badge Generator",
    category: "Name Badge",
    dataUrl: built.dataUrl,
    uploadedBy: {
      id: profile.id,
      name: profile.full_name
    },
    generatedAtIso: toEasternISO()
  });

  revalidatePath(`/members/${memberId}/name-badge`);
  revalidatePath(`/operations/member-command-center/${memberId}`);
  revalidatePath(`/health/member-health-profiles/${memberId}`);

  return {
    ok: true,
    fileName: saved.fileName,
    dataUrl: built.dataUrl
  } as const;
}

