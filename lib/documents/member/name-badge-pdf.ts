import "server-only";

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { getMemberNameBadgeDetail } from "@/lib/services/member-name-badge";
import type { PDFDocument as PDFDocumentType } from "pdf-lib";

const MILLIMETER_TO_POINTS = 72 / 25.4;
const BADGE_WIDTH_MM = 100;
const BADGE_HEIGHT_MM = 85;
const STAR_GROUP_SRC =
  "https://dcnyjtfyftamcdsaxrsz.supabase.co/storage/v1/object/public/Assets/TS_Gray_Star_Group_4%20(1).png";

const BADGE_LAYOUT = {
  sidePaddingMm: 3.6,
  logoTopMm: 5.2,
  logoMaxWidthMm: 64,
  logoMaxHeightMm: 34,
  starTopMm: 7.8,
  starSideMm: 5.2,
  starWidthMm: 17.5,
  nameTopMm: 41.2,
  nameMaxSizePt: 36,
  nameMinSizePt: 14,
  nameLineHeight: 1.12,
  nameMaxLines: 2,
  lockerTopMm: 61.8,
  lockerSizePt: 16,
  dividerTopMm: 71,
  dividerThicknessPt: 1.5,
  iconsTopMm: 74,
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

interface WidthMeasurer {
  widthOfTextAtSize: (text: string, size: number) => number;
}

function trimLineToWidthWithEllipsis(
  text: string,
  maxWidth: number,
  font: WidthMeasurer,
  fontSize: number
) {
  const ellipsis = "...";
  const trimmed = text.trim();
  if (!trimmed) return ellipsis;
  if (font.widthOfTextAtSize(trimmed, fontSize) <= maxWidth) return trimmed;
  if (font.widthOfTextAtSize(ellipsis, fontSize) > maxWidth) return "";

  let next = trimmed;
  while (next.length > 0 && font.widthOfTextAtSize(`${next}${ellipsis}`, fontSize) > maxWidth) {
    next = next.slice(0, -1).trimEnd();
  }
  return next ? `${next}${ellipsis}` : ellipsis;
}

function wrapTextByWords(
  text: string,
  maxWidth: number,
  font: WidthMeasurer,
  fontSize: number,
  maxLines: number
) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return { lines: [] as string[], truncated: false };
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";
  let index = 0;

  while (index < words.length && lines.length < maxLines) {
    const word = words[index];
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate;
      index += 1;
      continue;
    }

    if (!currentLine) {
      currentLine = word;
      index += 1;
    }

    lines.push(currentLine);
    currentLine = "";
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  const truncated = index < words.length;
  if (truncated && lines.length > 0) {
    lines[lines.length - 1] = trimLineToWidthWithEllipsis(lines[lines.length - 1], maxWidth, font, fontSize);
  }

  return { lines, truncated };
}

export function normalizeBadgeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  if (
    normalized.includes("bad gateway") ||
    normalized.includes("error code 502") ||
    normalized.includes("<!doctype html>")
  ) {
    return "Supabase is temporarily unavailable (502 Bad Gateway). Please wait a minute and try again.";
  }
  if (normalized.includes("fetch failed") || normalized.includes("network")) {
    return "Unable to reach Supabase right now. Please check connectivity and try again.";
  }
  return message || "Unable to generate badge right now. Please try again.";
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

async function loadPngFromUrl(pdf: PDFDocumentType, src: string) {
  try {
    const response = await fetch(src, { cache: "force-cache" });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

export async function buildNameBadgePdfBytes(memberId: string, selectedIndicatorKeys?: string[]) {
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
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const brandBlue = rgb(0.106, 0.243, 0.576);

  const logoMaxWidth = toPoints(BADGE_LAYOUT.logoMaxWidthMm);
  const logoMaxHeight = toPoints(BADGE_LAYOUT.logoMaxHeightMm);
  let logoHeight = toPoints(12);
  const logoImage = await loadPngFromPublic(pdf, badge.logoSrc);
  if (logoImage) {
    const logoScale = Math.min(logoMaxWidth / logoImage.width, logoMaxHeight / logoImage.height);
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

  const starImage = await loadPngFromUrl(pdf, STAR_GROUP_SRC);
  if (starImage) {
    const starWidth = toPoints(BADGE_LAYOUT.starWidthMm);
    const starScale = starWidth / starImage.width;
    const starHeight = starImage.height * starScale;
    const starTopY = toPageYFromTop(pageHeight, BADGE_LAYOUT.starTopMm, starHeight);
    const leftX = toPoints(BADGE_LAYOUT.starSideMm);
    const rightX = pageWidth - toPoints(BADGE_LAYOUT.starSideMm) - starWidth;

    page.drawImage(starImage, {
      x: leftX,
      y: starTopY,
      width: starWidth,
      height: starHeight
    });

    try {
      page.drawImage(starImage, {
        x: rightX + starWidth,
        y: starTopY,
        width: -starWidth,
        height: starHeight
      });
    } catch {
      page.drawImage(starImage, {
        x: rightX,
        y: starTopY,
        width: starWidth,
        height: starHeight
      });
    }
  }

  const availableNameWidth = pageWidth - sidePadding * 2;
  let nameFontSize = BADGE_LAYOUT.nameMaxSizePt;
  let wrappedName = wrapTextByWords(
    memberDisplayName,
    availableNameWidth,
    fontBold,
    nameFontSize,
    BADGE_LAYOUT.nameMaxLines
  );
  while (
    nameFontSize > BADGE_LAYOUT.nameMinSizePt &&
    (wrappedName.truncated ||
      wrappedName.lines.some((line) => fontBold.widthOfTextAtSize(line, nameFontSize) > availableNameWidth) ||
      wrappedName.lines.length * nameFontSize * BADGE_LAYOUT.nameLineHeight >
        toPoints(BADGE_LAYOUT.lockerTopMm - BADGE_LAYOUT.nameTopMm - 2))
  ) {
    nameFontSize -= 1;
    wrappedName = wrapTextByWords(
      memberDisplayName,
      availableNameWidth,
      fontBold,
      nameFontSize,
      BADGE_LAYOUT.nameMaxLines
    );
  }
  const nameTopY = pageHeight - toPoints(BADGE_LAYOUT.nameTopMm);
  const nameLineHeight = nameFontSize * BADGE_LAYOUT.nameLineHeight;
  const linesToRender =
    wrappedName.lines.length > 0
      ? wrappedName.lines.slice(0, BADGE_LAYOUT.nameMaxLines)
      : [trimLineToWidthWithEllipsis(memberDisplayName, availableNameWidth, fontBold, nameFontSize)];
  linesToRender.forEach((line, index) => {
    const nameTextWidth = fontBold.widthOfTextAtSize(line, nameFontSize);
    page.drawText(line, {
      x: Math.max(sidePadding, (pageWidth - nameTextWidth) / 2),
      y: nameTopY - nameFontSize - index * nameLineHeight,
      size: nameFontSize,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1)
    });
  });

  const lockerLabel = badge.member.lockerNumber ? `LOCKER ${badge.member.lockerNumber}` : "LOCKER ##";
  const lockerSize = BADGE_LAYOUT.lockerSizePt;
  const lockerWidth = fontRegular.widthOfTextAtSize(lockerLabel, lockerSize);
  page.drawText(lockerLabel, {
    x: (pageWidth - lockerWidth) / 2,
    y: toPageYFromTop(pageHeight, BADGE_LAYOUT.lockerTopMm, lockerSize),
    size: lockerSize,
    font: fontRegular,
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
    const label = indicator.shortLabel ?? indicator.label;
    const labelSize = 7.2;
    const labelWidth = fontBold.widthOfTextAtSize(label, labelSize);
    page.drawText(label, {
      x: cursorX + Math.max((textBadgeWidth - labelWidth) / 2, 1),
      y: iconY + (iconSize - labelSize) / 2 + 1,
      size: labelSize,
      font: fontBold,
      color: brandBlue
    });
    cursorX += textBadgeWidth + iconGap;
  }

  const pdfBytes = await pdf.save();
  return {
    badge,
    pdfBytes: Buffer.from(pdfBytes)
  } as const;
}

export const buildNameBadgePdf = buildNameBadgePdfBytes;
