import "server-only";

import { redirect } from "next/navigation";

import { mutateMemberNoteWorkflow } from "@/lib/services/member-health-profiles";
import { toEasternISO } from "@/lib/timezone";

import { asString, requireNurseAdmin, revalidateMhp, toServiceActor } from "./shared";

function buildNotePayload(formData: FormData, noteText: string) {
  return {
    note_type: asString(formData, "noteType") || "General",
    note_text: noteText
  };
}

export async function addMhpNoteAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;

  const now = toEasternISO();
  await mutateMemberNoteWorkflow({
    memberId,
    operation: "create",
    payload: buildNotePayload(formData, asString(formData, "noteText")),
    actor: toServiceActor(actor),
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=notes`);
}

export async function updateMhpNoteAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const noteId = asString(formData, "noteId");
  if (!memberId || !noteId) return;

  const now = toEasternISO();
  await mutateMemberNoteWorkflow({
    memberId,
    noteId,
    operation: "update",
    payload: buildNotePayload(formData, asString(formData, "noteText")),
    actor: toServiceActor(actor),
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=notes`);
}

export async function addMhpNoteInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const noteText = asString(formData, "noteText");
  if (!noteText) return { ok: false, error: "Note text is required." };

  const now = toEasternISO();
  const created = await mutateMemberNoteWorkflow({
    memberId,
    operation: "create",
    payload: buildNotePayload(formData, noteText),
    actor: toServiceActor(actor),
    now
  });
  if (!created.changed || !created.entity_row) return { ok: false, error: "Unable to create note." };

  revalidateMhp(memberId);
  return { ok: true, row: created.entity_row };
}

export async function updateMhpNoteInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const noteId = asString(formData, "noteId");
  if (!memberId || !noteId) return { ok: false, error: "Missing note reference." };

  const noteText = asString(formData, "noteText");
  if (!noteText) return { ok: false, error: "Note text is required." };

  const now = toEasternISO();
  const updated = await mutateMemberNoteWorkflow({
    memberId,
    noteId,
    operation: "update",
    payload: buildNotePayload(formData, noteText),
    actor: toServiceActor(actor),
    now
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Note not found." };

  revalidateMhp(memberId);
  return { ok: true, row: updated.entity_row };
}

export async function deleteMhpNoteInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const noteId = asString(formData, "noteId");
  if (!memberId || !noteId) return { ok: false, error: "Missing note reference." };

  const now = toEasternISO();
  const deleted = await mutateMemberNoteWorkflow({
    memberId,
    noteId,
    operation: "delete",
    actor: toServiceActor(actor),
    now
  });
  if (!deleted.changed) return { ok: false, error: "Note not found." };

  revalidateMhp(memberId);
  return { ok: true };
}
