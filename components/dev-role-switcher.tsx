"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { AppRole } from "@/types/app";
import { CANONICAL_ROLE_ORDER, getRoleLabel, normalizeRoleKey } from "@/lib/permissions";

const ROLE_OPTIONS: AppRole[] = [...CANONICAL_ROLE_ORDER];
const ROLE_STORAGE_KEY = "memory_lane_dev_role";
const USER_STORAGE_KEY = "memory_lane_dev_user";
const ROLE_COOKIE_KEY = "ml_mock_role";
const USER_COOKIE_KEY = "ml_mock_user_id";

type DevUserOption = {
  id: string;
  full_name: string;
  role: AppRole;
};

function isRole(value: string | null | undefined): value is AppRole {
  return Boolean(value && ROLE_OPTIONS.includes(normalizeRoleKey(value)));
}

function persistRole(role: AppRole) {
  window.localStorage.setItem(ROLE_STORAGE_KEY, role);
  document.cookie = `${ROLE_COOKIE_KEY}=${role}; path=/; max-age=31536000; samesite=lax`;
}

function persistUser(userId: string | null) {
  if (!userId) {
    window.localStorage.removeItem(USER_STORAGE_KEY);
    document.cookie = `${USER_COOKIE_KEY}=; path=/; max-age=0; samesite=lax`;
    return;
  }

  window.localStorage.setItem(USER_STORAGE_KEY, userId);
  document.cookie = `${USER_COOKIE_KEY}=${userId}; path=/; max-age=31536000; samesite=lax`;
}

export function DevRoleSwitcher({
  currentRole,
  currentUserId,
  availableUsers,
  enabled
}: {
  currentRole: AppRole;
  currentUserId: string;
  availableUsers: DevUserOption[];
  enabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedRole, setSelectedRole] = useState<AppRole>(currentRole);
  const [selectedUserId, setSelectedUserId] = useState<string>(currentUserId);

  const usersForRole = useMemo(
    () => availableUsers.filter((user) => normalizeRoleKey(user.role) === selectedRole).sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [availableUsers, selectedRole]
  );

  useEffect(() => {
    if (!enabled) return;

    const storedRole = window.localStorage.getItem(ROLE_STORAGE_KEY);
    const effectiveRole = normalizeRoleKey(isRole(storedRole) ? storedRole : currentRole);

    const storedUserId = window.localStorage.getItem(USER_STORAGE_KEY);
    const roleUsers = availableUsers.filter((user) => normalizeRoleKey(user.role) === effectiveRole);

    const currentUserForRole = roleUsers.find((user) => user.id === currentUserId)?.id ?? null;
    const storedUserForRole = roleUsers.find((user) => user.id === storedUserId)?.id ?? null;
    const effectiveUserId = storedUserForRole ?? currentUserForRole ?? roleUsers[0]?.id ?? "";

    setSelectedRole(effectiveRole);
    setSelectedUserId(effectiveUserId);

    persistRole(effectiveRole);
    persistUser(effectiveUserId || null);

    if (effectiveRole !== currentRole || (effectiveUserId && effectiveUserId !== currentUserId)) {
      startTransition(() => router.refresh());
    }
  }, [availableUsers, currentRole, currentUserId, enabled, router]);

  if (!enabled) return null;

  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <label className="flex items-center gap-2">
        <span className="font-semibold">Dev Role</span>
        <select
          className="h-9 rounded-md border border-border bg-white px-2 text-xs text-brand"
          value={selectedRole}
          disabled={isPending}
          onChange={(event) => {
            const nextRole = normalizeRoleKey(event.target.value);
            const nextUsers = availableUsers
              .filter((user) => normalizeRoleKey(user.role) === nextRole)
              .sort((a, b) => a.full_name.localeCompare(b.full_name));
            const nextUserId = nextUsers[0]?.id ?? "";

            setSelectedRole(nextRole);
            setSelectedUserId(nextUserId);
            persistRole(nextRole);
            persistUser(nextUserId || null);
            startTransition(() => router.refresh());
          }}
        >
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {getRoleLabel(role)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="font-semibold">Dev Staff</span>
        <select
          className="h-9 rounded-md border border-border bg-white px-2 text-xs text-brand"
          value={selectedUserId}
          disabled={isPending || usersForRole.length === 0}
          onChange={(event) => {
            const nextUserId = event.target.value;
            setSelectedUserId(nextUserId);
            persistUser(nextUserId || null);
            startTransition(() => router.refresh());
          }}
        >
          {usersForRole.length === 0 ? <option value="">No users</option> : null}
          {usersForRole.map((user) => (
            <option key={user.id} value={user.id}>
              {user.full_name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
