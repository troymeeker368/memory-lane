import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("user_permissions repo migrations enforce an explicit RLS and service-role write boundary", () => {
  const rlsSource = readWorkspaceFile("supabase/migrations/0183_user_permissions_rls_hardening.sql");
  const grantsSource = readWorkspaceFile("supabase/migrations/0186_user_permissions_grants_hardening.sql");
  const boundarySource = readWorkspaceFile("supabase/migrations/0198_user_permissions_admin_boundary_hardening.sql");

  assert.equal(rlsSource.includes("alter table public.user_permissions enable row level security;"), true);
  assert.equal(rlsSource.includes('create policy "user_permissions_read_admin"'), true);
  assert.equal(rlsSource.includes('create policy "user_permissions_service_role_all"'), true);

  assert.equal(grantsSource.includes("grant select on table public.user_permissions to authenticated;"), true);
  assert.equal(
    grantsSource.includes("grant select, insert, update, delete on table public.user_permissions to service_role;"),
    true
  );

  assert.equal(boundarySource.includes("create or replace function public.current_profile_custom_permissions()"), true);
  assert.equal(boundarySource.includes('grant execute on function public.current_profile_custom_permissions() to authenticated;'), true);
});

test("runtime permission reads use the shared security-definer helper instead of direct self table reads", () => {
  const accessSource = readWorkspaceFile("lib/current-user-access.ts");

  assert.equal(accessSource.includes("current_profile_custom_permissions"), true);
  assert.equal(accessSource.includes('.from("user_permissions")'), false);
});
