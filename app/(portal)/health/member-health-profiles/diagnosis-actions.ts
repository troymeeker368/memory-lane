"use server";

export async function addMhpDiagnosisAction(formData: FormData) {
  const { addMhpDiagnosisAction } = await import("./actions-impl");
  return addMhpDiagnosisAction(formData);
}

export async function updateMhpDiagnosisAction(formData: FormData) {
  const { updateMhpDiagnosisAction } = await import("./actions-impl");
  return updateMhpDiagnosisAction(formData);
}

export async function addMhpDiagnosisInlineAction(formData: FormData) {
  const { addMhpDiagnosisInlineAction } = await import("./actions-impl");
  return addMhpDiagnosisInlineAction(formData);
}

export async function updateMhpDiagnosisInlineAction(formData: FormData) {
  const { updateMhpDiagnosisInlineAction } = await import("./actions-impl");
  return updateMhpDiagnosisInlineAction(formData);
}

export async function deleteMhpDiagnosisInlineAction(formData: FormData) {
  const { deleteMhpDiagnosisInlineAction } = await import("./actions-impl");
  return deleteMhpDiagnosisInlineAction(formData);
}
