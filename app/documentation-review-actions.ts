"use server";

import type {
  reviewDocumentationAction as reviewDocumentationActionImpl,
  reviewTimeCardAction as reviewTimeCardActionImpl
} from "@/app/documentation-actions-impl";
import { loadDocumentationActionsImpl } from "@/app/documentation-action-loaders";

export async function reviewDocumentationAction(raw: Parameters<typeof reviewDocumentationActionImpl>[0]) {
  const { reviewDocumentationAction } = await loadDocumentationActionsImpl();
  return reviewDocumentationAction(raw);
}

export async function reviewTimeCardAction(raw: Parameters<typeof reviewTimeCardActionImpl>[0]) {
  const { reviewTimeCardAction } = await loadDocumentationActionsImpl();
  return reviewTimeCardAction(raw);
}
