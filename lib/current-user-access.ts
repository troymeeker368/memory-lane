import type { AppRole, PermissionModuleKey, UserProfile } from "@/types/app";

import {
  getPermissionSource,
  normalizeRoleKey,
  PERMISSION_MODULES,
  resolveEffectivePermissionSet
} from "@/lib/permissions/core";
import { invokeSupabaseRpc } from "@/lib/supabase/rpc";
import { logServerTiming, timingNowMs } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";

export type CurrentUserAccessOptions = {
  traceLabel?: string;
};

export type CurrentUserAccessResult =
  | {
      status: "authenticated";
      profile: UserProfile;
    }
  | {
      status: "no-auth-user" | "no-linked-profile" | "inactive-profile" | "disabled-profile" | "invited-password-setup";
      role: AppRole;
    };

type ProfileRow = {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  active: boolean;
  is_active?: boolean | null;
  status?: string | null;
  invited_at?: string | null;
  password_set_at?: string | null;
  last_sign_in_at?: string | null;
  disabled_at?: string | null;
  staff_id?: string | null;
  has_custom_permissions?: boolean | null;
};

type PermissionRow = {
  module_key: string;
  can_view: boolean | null;
  can_create: boolean | null;
  can_edit: boolean | null;
  can_admin: boolean | null;
};

function extractPostgrestErrorText(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const err = error as { message?: string; details?: string; hint?: string };
  return [err.message, err.details, err.hint].filter(Boolean).join(" ").toLowerCase();
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Unknown error";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.length > 0 ? message : "Unknown error";
}

function isMissingSchemaObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "");
  const text = extractPostgrestErrorText(error);
  return (
    code === "PGRST205" ||
    code === "PGRST116" ||
    code === "42P01" ||
    code === "42703" ||
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table")
  );
}

function buildCustomPermissions(rows: PermissionRow[]): UserProfile["permissions"] {
  return rows.reduce((acc, row) => {
    const moduleKey = String(row.module_key) as PermissionModuleKey;
    if (!PERMISSION_MODULES.includes(moduleKey)) {
      return acc;
    }
    acc[moduleKey] = {
      canView: Boolean(row.can_view),
      canCreate: Boolean(row.can_create),
      canEdit: Boolean(row.can_edit),
      canAdmin: Boolean(row.can_admin)
    };
    return acc;
  }, {} as UserProfile["permissions"]);
}

export async function resolveCurrentUserAccess(
  options?: CurrentUserAccessOptions
): Promise<CurrentUserAccessResult> {
  const traceLabel = options?.traceLabel;

  const userClientStartedAt = timingNowMs();
  const supabase = await createClient();
  logServerTiming(traceLabel, "create-user-client", userClientStartedAt);

  const authStartedAt = timingNowMs();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  logServerTiming(traceLabel, "session-auth-resolution", authStartedAt);

  if (!user) {
    return { status: "no-auth-user", role: "program-assistant" };
  }

  const baseSelect =
    "id, email, full_name, role, active, is_active, status, invited_at, password_set_at, last_sign_in_at, disabled_at, staff_id, has_custom_permissions";
  const legacySelect = "id, email, full_name, role, active, staff_id";

  const profileLookupStartedAt = timingNowMs();
  const profileLookup = await supabase.from("profiles").select(baseSelect).eq("id", user.id).maybeSingle();
  logServerTiming(traceLabel, "profile-role-lookup", profileLookupStartedAt);

  const { data: enrichedData, error: enrichedError } = profileLookup;

  let profileRow = enrichedData as ProfileRow | null;
  let profileError = enrichedError;
  let shouldLookupCustomPermissions = true;

  if (profileError) {
    const legacyLookupStartedAt = timingNowMs();
    const fallback = await supabase.from("profiles").select(legacySelect).eq("id", user.id).maybeSingle();
    logServerTiming(traceLabel, "profile-legacy-lookup", legacyLookupStartedAt);
    if (fallback.error) {
      throw new Error(`Failed to load profile row for authenticated user: ${getErrorMessage(profileError)}`);
    }
    profileRow = fallback.data as ProfileRow | null;
    profileError = null;
  } else {
    shouldLookupCustomPermissions = Boolean(profileRow?.has_custom_permissions);
  }

  if (!profileRow) {
    return { status: "no-linked-profile", role: "program-assistant" };
  }

  const role = normalizeRoleKey(profileRow.role) as AppRole;
  const normalizedStatus = String(profileRow.status ?? "").toLowerCase();
  const isActive = profileRow.is_active !== false;

  if (!profileRow.active || !isActive) {
    return { status: "inactive-profile", role };
  }

  if (normalizedStatus === "disabled") {
    return { status: "disabled-profile", role };
  }

  const passwordSetAt = profileRow.password_set_at ?? null;
  if (normalizedStatus === "invited" && !passwordSetAt) {
    return { status: "invited-password-setup", role };
  }

  let permissionRows: PermissionRow[] = [];
  let permissionsError: unknown = null;

  if (shouldLookupCustomPermissions) {
    const permissionsLookupStartedAt = timingNowMs();
    const permissionsLookup = await invokeSupabaseRpc<PermissionRow[]>(
      supabase,
      "current_profile_custom_permissions",
      {},
      { suppressErrorLog: true }
    );
    logServerTiming(traceLabel, "permission-row-lookup", permissionsLookupStartedAt);
    permissionRows = permissionsLookup.ok ? permissionsLookup.data ?? [] : [];
    permissionsError = permissionsLookup.ok ? null : permissionsLookup;
  }

  if (permissionsError) {
    if (isMissingSchemaObjectError(permissionsError)) {
      throw new Error(
        "Missing Supabase permission boundary schema for user overrides. Apply migrations 0002_rbac_roles_permissions.sql and 0198_user_permissions_admin_boundary_hardening.sql, then refresh Supabase/PostgREST schema cache."
      );
    }
    throw new Error(`Failed to load user permissions: ${getErrorMessage(permissionsError)}`);
  }

  const hasCustomPermissions = permissionRows.length > 0;
  const customPermissions = hasCustomPermissions ? buildCustomPermissions(permissionRows) : null;
  const permissions = resolveEffectivePermissionSet({
    role,
    hasCustomPermissions,
    customPermissions
  });

  return {
    status: "authenticated",
    profile: {
      id: profileRow.id,
      email: profileRow.email,
      full_name: profileRow.full_name,
      role,
      active: profileRow.active,
      status: normalizedStatus === "disabled" ? "disabled" : normalizedStatus === "invited" ? "invited" : "active",
      is_active: isActive,
      invited_at: profileRow.invited_at ?? null,
      password_set_at: passwordSetAt,
      last_sign_in_at: profileRow.last_sign_in_at ?? null,
      disabled_at: profileRow.disabled_at ?? null,
      staff_id: profileRow.staff_id ?? null,
      permissions,
      has_custom_permissions: hasCustomPermissions,
      permission_source: getPermissionSource(hasCustomPermissions)
    }
  };
}
