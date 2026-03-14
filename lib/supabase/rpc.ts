import { randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";

type RpcArgs = Record<string, unknown>;

type RpcClient = {
  rpc: (fn: string, args?: RpcArgs) => unknown;
};

export type SupabaseRpcSuccess<TData> = {
  ok: true;
  data: TData;
  correlationId: string;
};

export type SupabaseRpcFailure = {
  ok: false;
  code: string;
  message: string;
  correlationId: string;
};

export type SupabaseRpcResult<TData> = SupabaseRpcSuccess<TData> | SupabaseRpcFailure;

export class SupabaseRpcError extends Error {
  code: string;
  correlationId: string;
  rpcName: string;

  constructor(input: { rpcName: string; code: string; message: string; correlationId: string }) {
    super(`[RPC:${input.rpcName}] ${input.message} (ref ${input.correlationId})`);
    this.name = "SupabaseRpcError";
    this.code = input.code;
    this.correlationId = input.correlationId;
    this.rpcName = input.rpcName;
  }
}

function sanitizeMessage(value: string | null | undefined) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Supabase RPC call failed.";
  return normalized.slice(0, 280);
}

function sanitizeCode(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "rpc_failed";
  return normalized.slice(0, 64);
}

export async function invokeSupabaseRpc<TData>(
  client: RpcClient,
  rpcName: string,
  args: RpcArgs = {},
  options?: {
    correlationId?: string;
    suppressErrorLog?: boolean;
  }
): Promise<SupabaseRpcResult<TData>> {
  const correlationId = options?.correlationId ?? randomUUID();
  const { data, error } = (await client.rpc(rpcName, args)) as {
    data: unknown;
    error: PostgrestError | null;
  };

  if (error) {
    const code = sanitizeCode(error.code);
    const message = sanitizeMessage(error.message);
    if (!options?.suppressErrorLog) {
      console.error("[supabase-rpc] call failed", {
        rpcName,
        code,
        correlationId,
        message
      });
    }
    return {
      ok: false,
      code,
      message,
      correlationId
    };
  }

  return {
    ok: true,
    data: data as TData,
    correlationId
  };
}

export async function invokeSupabaseRpcOrThrow<TData>(
  client: RpcClient,
  rpcName: string,
  args: RpcArgs = {},
  options?: {
    correlationId?: string;
    suppressErrorLog?: boolean;
  }
): Promise<TData> {
  const result = await invokeSupabaseRpc<TData>(client, rpcName, args, options);
  if (result.ok) return result.data;
  throw new SupabaseRpcError({
    rpcName,
    code: result.code,
    message: result.message,
    correlationId: result.correlationId
  });
}
