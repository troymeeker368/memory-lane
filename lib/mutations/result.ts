export type MutationFieldErrors = Record<string, string | string[] | undefined>;

export type MutationSuccess<TData = null> = {
  ok: true;
  data: TData;
  message: string;
};

export type MutationFailure = {
  ok: false;
  error: string;
  fieldErrors?: MutationFieldErrors;
};

export type MutationResult<TData = null> = MutationSuccess<TData> | MutationFailure;

function extractLegacyData<TData>(value: Record<string, unknown>, fallbackData: TData) {
  const entries = Object.entries(value).filter(([key]) => key !== "ok" && key !== "error" && key !== "message" && key !== "fieldErrors");
  if (entries.length === 0) {
    return fallbackData;
  }
  return Object.fromEntries(entries) as TData;
}

export function mutationOk<TData = null>(data: TData, message: string): MutationSuccess<TData> {
  return {
    ok: true,
    data,
    message
  };
}

export function mutationError(error: string, fieldErrors?: MutationFieldErrors): MutationFailure {
  return {
    ok: false,
    error,
    fieldErrors
  };
}

export function normalizeMutationResult<TData = null>(
  value: unknown,
  options?: {
    successMessage?: string;
    errorMessage?: string;
    fallbackData?: TData;
  }
): MutationResult<TData> {
  const successMessage = options?.successMessage ?? "Saved.";
  const errorMessage = options?.errorMessage ?? "Unable to save changes.";
  const fallbackData = (options?.fallbackData ?? null) as TData;

  if (!value) {
    return mutationError(errorMessage);
  }

  if (typeof value !== "object") {
    return mutationError(errorMessage);
  }

  const record = value as Record<string, unknown>;
  const explicitError = typeof record.error === "string" ? record.error.trim() : "";
  if (record.ok === false || explicitError.length > 0) {
    return mutationError(explicitError || errorMessage, (record.fieldErrors as MutationFieldErrors | undefined) ?? undefined);
  }

  if ("data" in record && record.ok === true) {
    return mutationOk(
      (record.data as TData) ?? fallbackData,
      typeof record.message === "string" && record.message.trim().length > 0 ? record.message : successMessage
    );
  }

  const legacyData = extractLegacyData(record, fallbackData);
  return mutationOk(
    legacyData,
    typeof record.message === "string" && record.message.trim().length > 0 ? record.message : successMessage
  );
}
