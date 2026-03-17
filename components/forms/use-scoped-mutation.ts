"use client";

import { useRef, useState } from "react";

import { mutationError, normalizeMutationResult, type MutationResult } from "@/lib/mutations/result";

export function useScopedMutation() {
  const inFlightRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);

  async function run<TData = null>(
    action: () => Promise<unknown>,
    options?: {
      successMessage?: string;
      errorMessage?: string;
      fallbackData?: TData;
      onSuccess?: (result: Extract<MutationResult<TData>, { ok: true }>) => void | Promise<void>;
      onError?: (result: Extract<MutationResult<TData>, { ok: false }>) => void | Promise<void>;
    }
  ) {
    if (inFlightRef.current) {
      const duplicateResult = mutationError("A save is already in progress. Please wait.");
      await options?.onError?.(duplicateResult);
      return duplicateResult;
    }

    inFlightRef.current = true;
    setIsSaving(true);

    try {
      const rawResult = await action();
      const result = normalizeMutationResult<TData>(rawResult, options);
      if (result.ok) {
        await options?.onSuccess?.(result);
      } else {
        await options?.onError?.(result);
      }
      return result;
    } catch (error) {
      const result = mutationError(error instanceof Error ? error.message : options?.errorMessage ?? "Unable to save changes.");
      await options?.onError?.(result);
      return result;
    } finally {
      inFlightRef.current = false;
      setIsSaving(false);
    }
  }

  return {
    isSaving,
    run
  };
}
