"use server";

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { saveGeneratedMemberPdfToFiles } from "@/lib/services/member-files";
import { getMemberNameBadgeDetail } from "@/lib/services/member-name-badge";
import { toEasternISO } from "@/lib/timezone";

const MILLIMETER_TO_POINTS = 72 / 25.4;

function toPoints(mm: number) {
  return mm * MILLIMETER_TO_POINTS;
}

function roleCanGenerate(role: string) {
  return role === "admin" || role === "manager" || role === "nurse";
}

function imagePathFromPublicSrc(src: string) {
  const normalized = src.startsWith("/") ? src.slice(1) : src;
  return path.join(process.cwd(), "public", normalized.replaceAll("/", path.sep));
}

async function loadPngFromPublic(pdf: PDFDocument, src: string) {
  try {
    const bytes = await readFile(imagePathFromPublicSrc(src));
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

async function buildNameBadgePdfDataUrl(memberId: string, selectedIndicatorKeys?: string[]) {
  const badge = getMemberNameBadgeDetail(memberId);
  if (!badge) {
    return { error: "Member badge data not found." } as const;
  }
  const memberDisplayName = badge.member.name.trim() || badge.member.initials.trim() || "Member Name";

  const pageWidth = toPoints(100);
  const pageHeight = toPoints(85);
  const margin = toPoints(6);
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([pageWidth, pageHeight]);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brandBlue = rgb(0.106, 0.243, 0.576);

  const logoMaxWidth = toPoints(45);
  let logoHeight = toPoints(12);
  const logoImage = await loadPngFromPublic(pdf, badge.logoSrc);
  if (logoImage) {
    const logoScale = logoMaxWidth / logoImage.width;
    const logoWidth = logoImage.width * logoScale;
    logoHeight = logoImage.height * logoScale;
    page.drawImage(logoImage, {
      x: (pageWidth - logoWidth) / 2,
      y: pageHeight - margin - logoHeight,
      width: logoWidth,
      height: logoHeight
    });
  } else {
    const fallbackText = "Town Square";
    page.drawText(fallbackText, {
      x: (pageWidth - fontBold.widthOfTextAtSize(fallbackText, 12)) / 2,
      y: pageHeight - margin - logoHeight + 2,
      size: 12,
      font: fontBold,
      color: brandBlue
    });
  }

  const availableNameWidth = pageWidth - margin * 2;
  let nameFontSize = 30;
  const minNameFontSize = 14;
  while (nameFontSize > minNameFontSize && fontBold.widthOfTextAtSize(memberDisplayName, nameFontSize) > availableNameWidth) {
    nameFontSize -= 1;
  }
  const nameTextWidth = fontBold.widthOfTextAtSize(memberDisplayName, nameFontSize);
  page.drawText(memberDisplayName, {
    x: Math.max(margin, (pageWidth - nameTextWidth) / 2),
    y: pageHeight - margin - logoHeight - toPoints(18),
    size: nameFontSize,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1)
  });

  const lockerLabel = badge.member.lockerNumber ? `LOCKER ${badge.member.lockerNumber}` : "LOCKER ##";
  const lockerSize = 18;
  const lockerWidth = fontBold.widthOfTextAtSize(lockerLabel, lockerSize);
  page.drawText(lockerLabel, {
    x: (pageWidth - lockerWidth) / 2,
    y: pageHeight - margin - logoHeight - toPoints(28),
    size: lockerSize,
    font: fontBold,
    color: brandBlue
  });

  const dividerY = toPoints(18);
  page.drawLine({
    start: { x: margin, y: dividerY },
    end: { x: pageWidth - margin, y: dividerY },
    thickness: 1.5,
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
  const iconSize = toPoints(9.6);
  const iconGap = toPoints(3);
  const textBadgeWidth = toPoints(14);
  const totalUnits = enabledIndicators.reduce((width, indicator, index) => {
    const nextWidth = indicator.iconSrc ? iconSize : textBadgeWidth;
    return width + nextWidth + (index > 0 ? iconGap : 0);
  }, 0);
  let cursorX = Math.max(margin, (pageWidth - totalUnits) / 2);
  const iconY = toPoints(6.2);

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

  const saved = saveGeneratedMemberPdfToFiles({
    memberId,
    memberName: built.badge.member.name,
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
