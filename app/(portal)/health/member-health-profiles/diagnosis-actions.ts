"use server";

import {
  addMhpDiagnosisAction as addMhpDiagnosisActionImpl,
  addMhpDiagnosisInlineAction as addMhpDiagnosisInlineActionImpl,
  deleteMhpDiagnosisInlineAction as deleteMhpDiagnosisInlineActionImpl,
  updateMhpDiagnosisAction as updateMhpDiagnosisActionImpl,
  updateMhpDiagnosisInlineAction as updateMhpDiagnosisInlineActionImpl
} from "./actions-impl";

export async function addMhpDiagnosisAction(formData: FormData) {
  return addMhpDiagnosisActionImpl(formData);
}

export async function updateMhpDiagnosisAction(formData: FormData) {
  return updateMhpDiagnosisActionImpl(formData);
}

export async function addMhpDiagnosisInlineAction(formData: FormData) {
  return addMhpDiagnosisInlineActionImpl(formData);
}

export async function updateMhpDiagnosisInlineAction(formData: FormData) {
  return updateMhpDiagnosisInlineActionImpl(formData);
}

export async function deleteMhpDiagnosisInlineAction(formData: FormData) {
  return deleteMhpDiagnosisInlineActionImpl(formData);
}
