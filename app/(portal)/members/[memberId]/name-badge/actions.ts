"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { canGenerateMemberDocumentForRole } from "@/lib/permissions";
import {
  buildGeneratedMemberFilePersistenceState,
  saveGeneratedMemberPdfToFiles
} from "@/lib/services/member-files";
import { toEasternISO } from "@/lib/timezone";

async function loadNameBadgePdfBuilder() {
  const { buildNameBadgePdfBytes } = await import("@/lib/documents/member/name-badge-pdf");
  return buildNameBadgePdfBytes;
}

function normalizeBadgeActionError(error: unknown) {
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

export async function generateMemberNameBadgePdfAction(input: {
  memberId: string;
  selectedIndicatorKeys?: string[];
}) {
  const profile = await getCurrentProfile();
  if (!canGenerateMemberDocumentForRole(profile.role)) {
    return { ok: false, status: "error" as const, error: "You do not have access to generate member badges." } as const;
  }

  const memberId = String(input.memberId ?? "").trim();
  if (!memberId) {
    return { ok: false, status: "error" as const, error: "Member is required." } as const;
  }

  let built: Awaited<ReturnType<Awaited<ReturnType<typeof loadNameBadgePdfBuilder>>>>;
  try {
    const buildNameBadgePdf = await loadNameBadgePdfBuilder();
    built = await buildNameBadgePdf(memberId, input.selectedIndicatorKeys);
  } catch (error) {
    const message = normalizeBadgeActionError(error);
    console.error("[NameBadge] generateMemberNameBadgePdfAction build failed", {
      memberId,
      message
    });
    return { ok: false, status: "error" as const, error: message } as const;
  }
  if ("error" in built) {
    return { ok: false, status: "error" as const, error: built.error } as const;
  }

  let saved: Awaited<ReturnType<typeof saveGeneratedMemberPdfToFiles>>;
  try {
    saved = await saveGeneratedMemberPdfToFiles({
      memberId,
      memberName: built.badge.member.displayName ?? "Member",
      documentLabel: "Name Badge",
      documentSource: "Name Badge Generator",
      category: "Name Badge",
      bytes: built.pdfBytes,
      contentType: "application/pdf",
      uploadedBy: {
        id: profile.id,
        name: profile.full_name
      },
      generatedAtIso: toEasternISO()
    });
  } catch (error) {
    const message = normalizeBadgeActionError(error);
    console.error("[NameBadge] generateMemberNameBadgePdfAction save failed", {
      memberId,
      message
    });
    return { ok: false, status: "error" as const, error: message } as const;
  }

  revalidatePath(`/members/${memberId}/name-badge`);
  revalidatePath(`/operations/member-command-center/${memberId}`);
  revalidatePath(`/health/member-health-profiles/${memberId}`);

  return {
    ok: saved.verifiedPersisted,
    status: saved.verifiedPersisted ? ("verified" as const) : ("follow-up-needed" as const),
    fileName: saved.fileName,
    downloadUrl: saved.downloadUrl,
    pdfGenerated: true as const,
    storageUploaded: true as const,
    memberFilesVerified: saved.verifiedPersisted,
    ...buildGeneratedMemberFilePersistenceState({
      documentLabel: "Name Badge",
      verifiedPersisted: saved.verifiedPersisted
    })
  } as const;
}
