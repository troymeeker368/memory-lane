"use server";

export async function submitPayorAction(formData: FormData) {
  const implementation = await import("./actions-impl");
  return implementation.submitPayorActionImpl(formData);
}
