export function firstSearchParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function parsePositivePageParam(value: string | undefined, fallback = 1): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function parseEnumSearchParam<TValue extends string>(
  value: string | undefined,
  allowed: readonly TValue[],
  fallback: TValue
): TValue {
  if (!value) {
    return fallback;
  }
  return allowed.includes(value as TValue) ? (value as TValue) : fallback;
}

export function parseDateOnlySearchParam(value: string | undefined, fallback: string): string {
  const normalized = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : fallback;
}
