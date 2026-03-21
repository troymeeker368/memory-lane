import { createClient } from "@/lib/supabase/server";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import {
  cleanText,
  computeNextProgressNoteDueDate,
  normalizeProgressNoteStatus
} from "@/lib/services/progress-note-model";
import type { DbProgressNote } from "@/lib/services/progress-note-types";
import { findDraftProgressNoteRow, loadProgressNoteRows } from "@/lib/services/progress-notes-read-model";

function isPostgresUniqueViolation(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const text = [error?.message, error?.details].filter(Boolean).join(" ").toLowerCase();
  return error?.code === "23505" || text.includes("duplicate key value") || text.includes("unique constraint");
}

function isProgressNoteDraftUniqueViolation(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const text = [error?.message, error?.details].filter(Boolean).join(" ").toLowerCase();
  return isPostgresUniqueViolation(error) && text.includes("idx_progress_notes_member_single_draft");
}

function normalizeNoteDate(value: string | null | undefined) {
  const normalized = cleanText(value);
  return normalized ?? toEasternDate();
}

async function loadProgressNoteRowForMutation(noteId: string) {
  const rows = await loadProgressNoteRows({ noteId });
  const row = rows[0] ?? null;
  if (!row) throw new Error("Progress note not found.");
  return row;
}

export async function saveProgressNoteDraft(input: {
  noteId?: string | null;
  memberId: string;
  noteDate: string;
  noteBody: string;
  actor: { id: string; fullName: string; signatureName: string };
}) {
  const canonicalMemberId = await resolveCanonicalMemberId(input.memberId, {
    actionLabel: "saveProgressNoteDraft"
  });
  const noteBody = cleanText(input.noteBody);
  if (!noteBody) throw new Error("Progress note content is required.");

  const noteDate = normalizeNoteDate(input.noteDate);
  const now = toEasternISO();
  const supabase = await createClient();
  const existingDraft = input.noteId
    ? await loadProgressNoteRowForMutation(input.noteId)
    : await findDraftProgressNoteRow(canonicalMemberId);

  if (existingDraft) {
    if (existingDraft.member_id !== canonicalMemberId) {
      throw new Error("Progress note/member mismatch.");
    }
    if (normalizeProgressNoteStatus(existingDraft.status) === "signed") {
      throw new Error("Signed progress notes are read-only.");
    }

    const { data, error } = await supabase
      .from("progress_notes")
      .update({
        note_date: noteDate,
        note_body: noteBody,
        updated_at: now,
        updated_by_user_id: input.actor.id,
        updated_by_name: input.actor.fullName
      })
      .eq("id", existingDraft.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await recordWorkflowEvent({
      eventType: "progress_note_draft_saved",
      entityType: "progress_note",
      entityId: existingDraft.id,
      actorType: "user",
      actorUserId: input.actor.id,
      status: "draft",
      severity: "low",
      metadata: {
        member_id: canonicalMemberId,
        note_date: noteDate
      }
    });

    return {
      id: String((data as DbProgressNote).id),
      memberId: canonicalMemberId,
      status: normalizeProgressNoteStatus((data as DbProgressNote).status)
    };
  }

  const insertPayload = {
    member_id: canonicalMemberId,
    note_date: noteDate,
    note_body: noteBody,
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by_user_id: input.actor.id,
    created_by_name: input.actor.fullName,
    updated_by_user_id: input.actor.id,
    updated_by_name: input.actor.fullName
  };

  const { data, error } = await supabase
    .from("progress_notes")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    if (isProgressNoteDraftUniqueViolation(error)) {
      const recoveredDraft = await findDraftProgressNoteRow(canonicalMemberId);
      if (!recoveredDraft) throw new Error(error.message);
      return saveProgressNoteDraft({
        ...input,
        noteId: recoveredDraft.id
      });
    }
    throw new Error(error.message);
  }

  await recordWorkflowEvent({
    eventType: "progress_note_draft_saved",
    entityType: "progress_note",
    entityId: String((data as DbProgressNote).id),
    actorType: "user",
    actorUserId: input.actor.id,
    status: "draft",
    severity: "low",
    metadata: {
      member_id: canonicalMemberId,
      note_date: noteDate
    }
  });

  return {
    id: String((data as DbProgressNote).id),
    memberId: canonicalMemberId,
    status: normalizeProgressNoteStatus((data as DbProgressNote).status)
  };
}

export async function signProgressNote(input: {
  noteId?: string | null;
  memberId: string;
  noteDate: string;
  noteBody: string;
  actor: { id: string; fullName: string; signatureName: string };
  attested: boolean;
  signatureImageDataUrl: string;
}) {
  const canonicalMemberId = await resolveCanonicalMemberId(input.memberId, {
    actionLabel: "signProgressNote"
  });
  const noteBody = cleanText(input.noteBody);
  if (!noteBody) throw new Error("Progress note content is required before signing.");
  if (!input.attested) throw new Error("Electronic signature attestation is required before signing.");
  const signatureImageDataUrl = cleanText(input.signatureImageDataUrl);
  if (!signatureImageDataUrl || !signatureImageDataUrl.startsWith("data:image/")) {
    throw new Error("A valid drawn nurse/admin signature image is required before signing.");
  }

  const noteDate = normalizeNoteDate(input.noteDate);
  const signedAt = toEasternISO();
  const signatureMetadata = {
    signedVia: "progress-note-esign",
    attested: true,
    signatureName: input.actor.signatureName,
    noteDate
  } satisfies Record<string, unknown>;
  const supabase = await createClient();
  const existingDraft = input.noteId
    ? await loadProgressNoteRowForMutation(input.noteId)
    : await findDraftProgressNoteRow(canonicalMemberId);

  let savedRow: DbProgressNote;

  if (existingDraft) {
    if (existingDraft.member_id !== canonicalMemberId) {
      throw new Error("Progress note/member mismatch.");
    }
    if (normalizeProgressNoteStatus(existingDraft.status) === "signed") {
      throw new Error("Progress note is already signed.");
    }

    const { data, error } = await supabase
      .from("progress_notes")
      .update({
        note_date: noteDate,
        note_body: noteBody,
        status: "signed",
        signed_at: signedAt,
        signed_by_user_id: input.actor.id,
        signed_by_name: input.actor.signatureName,
        signature_attested: true,
        signature_blob: signatureImageDataUrl,
        signature_metadata: signatureMetadata,
        updated_at: signedAt,
        updated_by_user_id: input.actor.id,
        updated_by_name: input.actor.fullName
      })
      .eq("id", existingDraft.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    savedRow = data as DbProgressNote;
  } else {
    const { data, error } = await supabase
      .from("progress_notes")
      .insert({
        member_id: canonicalMemberId,
        note_date: noteDate,
        note_body: noteBody,
        status: "signed",
        signed_at: signedAt,
        signed_by_user_id: input.actor.id,
        signed_by_name: input.actor.signatureName,
        signature_attested: true,
        signature_blob: signatureImageDataUrl,
        signature_metadata: signatureMetadata,
        created_at: signedAt,
        updated_at: signedAt,
        created_by_user_id: input.actor.id,
        created_by_name: input.actor.fullName,
        updated_by_user_id: input.actor.id,
        updated_by_name: input.actor.fullName
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    savedRow = data as DbProgressNote;
  }

  const complianceAnchorDate = toEasternDate(savedRow.signed_at ?? signedAt);
  const nextDueDate = computeNextProgressNoteDueDate(complianceAnchorDate);

  await recordWorkflowEvent({
    eventType: "progress_note_signed",
    entityType: "progress_note",
    entityId: savedRow.id,
    actorType: "user",
    actorUserId: input.actor.id,
    status: "signed",
    severity: "low",
    metadata: {
      member_id: canonicalMemberId,
      note_date: noteDate,
      signed_at: savedRow.signed_at,
      next_due_date: nextDueDate,
      signature_attested: true,
      signed_via: "progress-note-esign"
    }
  });

  return {
    id: savedRow.id,
    memberId: canonicalMemberId,
    status: normalizeProgressNoteStatus(savedRow.status)
  };
}
