export const BADGE_DISPLAY_NAME_RESOLUTION_ORDER = [
  "preferred_name+last_name",
  "first_name+last_name",
  "full_name",
  "name"
] as const;

export type BadgeDisplayNameResolutionSource =
  | (typeof BADGE_DISPLAY_NAME_RESOLUTION_ORDER)[number]
  | "unresolved";

export interface BadgeDisplayNameInput {
  preferred_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  name?: string | null;
}

export interface BadgeDisplayNameResolution {
  displayName: string | null;
  firstName: string | null;
  lastInitial: string | null;
  source: BadgeDisplayNameResolutionSource;
}

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function firstToken(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return null;
  const parts = normalized.split(/\s+/).filter(Boolean);
  return parts[0] ?? null;
}

function firstInitial(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return null;
  const match = normalized.match(/[A-Za-z0-9]/);
  return match ? match[0].toUpperCase() : null;
}

function buildDisplayName(input: {
  firstName: string | null;
  lastName: string | null;
  withPeriod: boolean;
}): Omit<BadgeDisplayNameResolution, "source"> {
  const firstName = clean(input.firstName);
  if (!firstName) {
    return {
      displayName: null,
      firstName: null,
      lastInitial: null
    };
  }
  const lastInitial = firstInitial(input.lastName);
  if (!lastInitial) {
    return {
      displayName: firstName,
      firstName,
      lastInitial: null
    };
  }
  return {
    displayName: `${firstName} ${lastInitial}${input.withPeriod ? "." : ""}`,
    firstName,
    lastInitial
  };
}

function fromFreeTextName(value: string | null | undefined, withPeriod: boolean) {
  const normalized = clean(value);
  if (!normalized) {
    return buildDisplayName({
      firstName: null,
      lastName: null,
      withPeriod
    });
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? null;
  const lastName = parts.length > 1 ? parts[parts.length - 1] : null;
  return buildDisplayName({
    firstName,
    lastName,
    withPeriod
  });
}

export function formatMemberBadgeDisplayName(
  input: BadgeDisplayNameInput,
  options?: {
    withPeriod?: boolean;
  }
): BadgeDisplayNameResolution {
  const withPeriod = options?.withPeriod === true;
  const preferredFirst = firstToken(input.preferred_name);
  const preferredLast = clean(input.last_name);
  const fromPreferred = buildDisplayName({
    firstName: preferredFirst,
    lastName: preferredLast,
    withPeriod
  });
  if (fromPreferred.displayName) {
    return { ...fromPreferred, source: "preferred_name+last_name" };
  }

  const legalFirst = firstToken(input.first_name);
  const legalLast = clean(input.last_name);
  const fromLegal = buildDisplayName({
    firstName: legalFirst,
    lastName: legalLast,
    withPeriod
  });
  if (fromLegal.displayName) {
    return { ...fromLegal, source: "first_name+last_name" };
  }

  const fromFullName = fromFreeTextName(input.full_name, withPeriod);
  if (fromFullName.displayName) {
    return { ...fromFullName, source: "full_name" };
  }

  const fromName = fromFreeTextName(input.name, withPeriod);
  if (fromName.displayName) {
    return { ...fromName, source: "name" };
  }

  return {
    displayName: null,
    firstName: null,
    lastInitial: null,
    source: "unresolved"
  };
}
