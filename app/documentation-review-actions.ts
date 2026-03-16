"use server";

import type {
  reviewDocumentationAction as reviewDocumentationActionImpl,
  reviewTimeCardAction as reviewTimeCardActionImpl
} from "@/app/documentation-actions-impl";

export async function reviewDocumentationAction(raw: Parameters<typeof reviewDocumentationActionImpl>[0]) {
  const { reviewDocumentationAction } = await import("@/app/documentation-actions-impl");
  return reviewDocumentationAction(raw);
}

export async function reviewTimeCardAction(raw: Parameters<typeof reviewTimeCardActionImpl>[0]) {
  const { reviewTimeCardAction } = await import("@/app/documentation-actions-impl");
  return reviewTimeCardAction(raw);
}
