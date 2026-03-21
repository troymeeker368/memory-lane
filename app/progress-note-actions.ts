"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireProgressNoteAuthorizedUser } from "@/lib/services/progress-note-authorization";
import { saveProgressNoteDraft, signProgressNote } from "@/lib/services/progress-notes-write";

const progressNoteMutationSchema = z.object({
  noteId: z.string().uuid().optional().or(z.literal("")),
  memberId: z.string().uuid(),
  noteDate: z.string().min(1),
  noteBody: z.string().min(1)
});

const progressNoteSignSchema = progressNoteMutationSchema.extend({
  signatureAttested: z.boolean(),
  signatureImageDataUrl: z.string().min(1)
});

function revalidateProgressNoteSurfaces(memberId: string, noteId: string) {
  revalidatePath("/health");
  revalidatePath("/health/progress-notes");
  revalidatePath(`/health/progress-notes/${noteId}`);
  revalidatePath(`/health/member-health-profiles/${memberId}`);
  revalidatePath("/health/member-health-profiles");
  revalidatePath(`/operations/member-command-center/${memberId}`);
  revalidatePath(`/members/${memberId}`);
  revalidatePath("/documentation");
  revalidatePath("/reports");
}

export async function saveProgressNoteDraftAction(raw: z.infer<typeof progressNoteMutationSchema>) {
  const user = await requireProgressNoteAuthorizedUser();
  const payload = progressNoteMutationSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false as const, error: "Invalid progress note draft submission." };
  }

  try {
    const saved = await saveProgressNoteDraft({
      noteId: payload.data.noteId || null,
      memberId: payload.data.memberId,
      noteDate: payload.data.noteDate,
      noteBody: payload.data.noteBody,
      actor: {
        id: user.userId,
        fullName: user.fullName,
        signatureName: user.signatureName
      }
    });
    revalidateProgressNoteSurfaces(saved.memberId, saved.id);
    return { ok: true as const, error: null, id: saved.id, memberId: saved.memberId };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to save progress note draft."
    };
  }
}

export async function signProgressNoteAction(raw: z.infer<typeof progressNoteSignSchema>) {
  const user = await requireProgressNoteAuthorizedUser();
  const payload = progressNoteSignSchema.safeParse(raw);
  if (!payload.success) {
    const attested = typeof (raw as { signatureAttested?: unknown }).signatureAttested === "boolean"
      ? (raw as { signatureAttested?: boolean }).signatureAttested
      : false;
    if (!attested) {
      return { ok: false as const, error: "Electronic signature attestation is required." };
    }
    const signatureImageDataUrl = typeof (raw as { signatureImageDataUrl?: unknown }).signatureImageDataUrl === "string"
      ? ((raw as { signatureImageDataUrl?: string }).signatureImageDataUrl ?? "").trim()
      : "";
    if (!signatureImageDataUrl) {
      return { ok: false as const, error: "Draw nurse/admin signature before signing." };
    }
    return { ok: false as const, error: "Invalid progress note signature submission." };
  }
  if (!payload.data.signatureImageDataUrl.trim().startsWith("data:image/")) {
    return { ok: false as const, error: "A valid drawn nurse/admin signature image is required." };
  }

  try {
    const saved = await signProgressNote({
      noteId: payload.data.noteId || null,
      memberId: payload.data.memberId,
      noteDate: payload.data.noteDate,
      noteBody: payload.data.noteBody,
      actor: {
        id: user.userId,
        fullName: user.fullName,
        signatureName: user.signatureName
      },
      attested: payload.data.signatureAttested,
      signatureImageDataUrl: payload.data.signatureImageDataUrl
    });
    revalidateProgressNoteSurfaces(saved.memberId, saved.id);
    return { ok: true as const, error: null, id: saved.id, memberId: saved.memberId, status: saved.status };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to sign progress note."
    };
  }
}
