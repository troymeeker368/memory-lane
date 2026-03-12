"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { AppRole } from "@/types/app";
import { getRoleLabel } from "@/lib/permissions";
import {
  DEV_ROLE_COOKIE_KEY,
  DEV_ROLE_STORAGE_KEY,
  LEGACY_DEV_ROLE_COOKIE_KEY,
  resolveDevRoleOverride
} from "@/lib/runtime";

const ROLE_OPTIONS: AppRole[] = [
  "program-assistant",
  "coordinator",
  "nurse",
  "manager",
  "director",
  "admin"
];

function readCookie(name: string): string | null {
  const cookiePart = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  if (!cookiePart) return null;
  return cookiePart.slice(name.length + 1) || null;
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

function persistRole(role: AppRole | null) {
  if (!role) {
    window.localStorage.removeItem(DEV_ROLE_STORAGE_KEY);
    clearCookie(DEV_ROLE_COOKIE_KEY);
    clearCookie(LEGACY_DEV_ROLE_COOKIE_KEY);
    return;
  }

  window.localStorage.setItem(DEV_ROLE_STORAGE_KEY, role);
  setCookie(DEV_ROLE_COOKIE_KEY, role);
  // Keep legacy cookie in sync for backwards compatibility.
  setCookie(LEGACY_DEV_ROLE_COOKIE_KEY, role);
}

export function DevRoleSwitcher({
  currentRole,
  enabled,
  envRoleOverride
}: {
  currentRole: AppRole;
  enabled: boolean;
  envRoleOverride: AppRole | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedRole, setSelectedRole] = useState<AppRole | "">(envRoleOverride ?? "");

  useEffect(() => {
    if (!enabled) return;

    if (envRoleOverride) {
      setSelectedRole(envRoleOverride);
      return;
    }

    const storedRole = window.localStorage.getItem(DEV_ROLE_STORAGE_KEY);
    const cookieRole = readCookie(DEV_ROLE_COOKIE_KEY) ?? readCookie(LEGACY_DEV_ROLE_COOKIE_KEY);
    const effectiveOverride = resolveDevRoleOverride(storedRole) ?? resolveDevRoleOverride(cookieRole);

    if (!effectiveOverride) {
      setSelectedRole("");
      persistRole(null);
      return;
    }

    setSelectedRole(effectiveOverride);
    persistRole(effectiveOverride);

    if (effectiveOverride !== currentRole) {
      startTransition(() => router.refresh());
    }
  }, [currentRole, enabled, envRoleOverride, router]);

  if (!enabled) return null;

  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <label className="flex items-center gap-2">
        <span className="font-semibold">Dev Role</span>
        <select
          className="h-9 rounded-md border border-border bg-white px-2 text-xs text-brand"
          value={selectedRole}
          disabled={isPending || Boolean(envRoleOverride)}
          onChange={(event) => {
            const nextRole = resolveDevRoleOverride(event.target.value);
            setSelectedRole(nextRole ?? "");
            persistRole(nextRole);
            startTransition(() => router.refresh());
          }}
        >
          <option value="">Database Profile</option>
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {getRoleLabel(role)}
            </option>
          ))}
        </select>
      </label>
      {envRoleOverride ? <p className="text-[11px] text-muted">Locked by `DEV_ROLE_OVERRIDE`.</p> : null}
    </div>
  );
}
