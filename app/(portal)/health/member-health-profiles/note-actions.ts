"use server";

export async function addMhpNoteAction(formData: FormData) {
  const { addMhpNoteAction } = await import("./actions-impl");
  return addMhpNoteAction(formData);
}

export async function updateMhpNoteAction(formData: FormData) {
  const { updateMhpNoteAction } = await import("./actions-impl");
  return updateMhpNoteAction(formData);
}

export async function addMhpNoteInlineAction(formData: FormData) {
  const { addMhpNoteInlineAction } = await import("./actions-impl");
  return addMhpNoteInlineAction(formData);
}

export async function updateMhpNoteInlineAction(formData: FormData) {
  const { updateMhpNoteInlineAction } = await import("./actions-impl");
  return updateMhpNoteInlineAction(formData);
}

export async function deleteMhpNoteInlineAction(formData: FormData) {
  const { deleteMhpNoteInlineAction } = await import("./actions-impl");
  return deleteMhpNoteInlineAction(formData);
}
