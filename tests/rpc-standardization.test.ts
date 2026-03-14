import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("shared Supabase RPC wrapper exposes normalized invoke helpers", () => {
  const source = readWorkspaceFile("lib/supabase/rpc.ts");

  assert.equal(source.includes("export async function invokeSupabaseRpc"), true);
  assert.equal(source.includes("export async function invokeSupabaseRpcOrThrow"), true);
  assert.equal(source.includes("SupabaseRpcError"), true);
});

test("lead conversion service uses canonical rpc_* names through shared wrapper", () => {
  const source = readWorkspaceFile("lib/services/sales-lead-conversion-supabase.ts");

  assert.equal(source.includes('const RPC_CONVERT_LEAD_TO_MEMBER = "rpc_convert_lead_to_member"'), true);
  assert.equal(source.includes('const RPC_CREATE_LEAD_WITH_MEMBER_CONVERSION = "rpc_create_lead_with_member_conversion"'), true);
  assert.equal(source.includes("invokeLeadConversionRpcWithFallback"), true);
});

test("POF public signing finalization uses canonical RPC and shared post-sign sync helper", () => {
  const source = readWorkspaceFile("lib/services/pof-esign.ts");

  assert.equal(source.includes('const RPC_FINALIZE_POF_SIGNATURE = "rpc_finalize_pof_signature"'), true);
  assert.equal(source.includes("invokeSupabaseRpcOrThrow<unknown>(admin, RPC_FINALIZE_POF_SIGNATURE"), true);
  assert.equal(source.includes("processSignedPhysicianOrderPostSignSync"), true);
});

test("physician order signing path routes lifecycle DB transition through rpc_sign_physician_order", () => {
  const source = readWorkspaceFile("lib/services/physician-orders-supabase.ts");

  assert.equal(source.includes('const RPC_SIGN_PHYSICIAN_ORDER = "rpc_sign_physician_order"'), true);
  assert.equal(source.includes("invokeSignPhysicianOrderRpc"), true);
  assert.equal(source.includes("processSignedPhysicianOrderPostSignSync"), true);
});
