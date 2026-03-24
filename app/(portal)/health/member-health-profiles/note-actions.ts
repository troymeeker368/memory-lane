"use server";

import {
  addMhpNoteAction as addMhpNoteActionImpl,
  addMhpNoteInlineAction as addMhpNoteInlineActionImpl,
  deleteMhpNoteInlineAction as deleteMhpNoteInlineActionImpl,
  updateMhpNoteAction as updateMhpNoteActionImpl,
  updateMhpNoteInlineAction as updateMhpNoteInlineActionImpl
} from "./actions-impl";

export async function addMhpNoteAction(formData: FormData) {
  return addMhpNoteActionImpl(formData);
}

export async function updateMhpNoteAction(formData: FormData) {
  return updateMhpNoteActionImpl(formData);
}

export async function addMhpNoteInlineAction(formData: FormData) {
  return addMhpNoteInlineActionImpl(formData);
}

export async function updateMhpNoteInlineAction(formData: FormData) {
  return updateMhpNoteInlineActionImpl(formData);
}

export async function deleteMhpNoteInlineAction(formData: FormData) {
  return deleteMhpNoteInlineActionImpl(formData);
}
