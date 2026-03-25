import { existsSync, readFileSync } from "node:fs";
import Module from "node:module";
import { join } from "node:path";

function loadEnvFiles() {
  const parseEnvValue = (raw: string) => {
    const trimmed = raw.trim();
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  };

  for (const fileName of [".env.local", ".env"]) {
    const fullPath = join(process.cwd(), fileName);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = parseEnvValue(trimmed.slice(eqIndex + 1));
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
  }
}

function installServerOnlyShim() {
  type ModuleLoad = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
  const moduleShim = Module as typeof Module & { _load: ModuleLoad };
  const originalLoad = moduleShim._load;

  moduleShim._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (
      request === "server-only" ||
      request.endsWith("\\server-only\\index.js") ||
      request.endsWith("/server-only/index.js")
    ) {
      return {};
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveSupabaseHost() {
  const raw = clean(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL);
  if (!raw) return { host: "", isLocal: false };
  try {
    const host = new URL(raw).host;
    return { host, isLocal: /localhost|127\.0\.0\.1/i.test(host) };
  } catch {
    return { host: raw, isLocal: false };
  }
}

function parseArgs(argv: string[]) {
  const packetIds = new Set<string>();
  let limit = 25;
  let dryRun = true;
  let apply = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
      dryRun = false;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      apply = false;
    }
    if (arg === "--limit" && argv[i + 1]) {
      limit = Number(argv[i + 1]);
      i += 1;
    }
    if (arg.startsWith("--limit=")) {
      limit = Number(arg.split("=")[1]);
    }
    if (arg === "--packet-id" && argv[i + 1]) {
      packetIds.add(argv[i + 1].trim());
      i += 1;
    }
    if (arg.startsWith("--packet-id=")) {
      packetIds.add(arg.split("=")[1].trim());
    }
  }

  if (!Number.isFinite(limit) || limit <= 0) limit = 25;
  limit = Math.max(1, Math.min(100, Math.trunc(limit)));

  return {
    packetIds: Array.from(packetIds).filter(Boolean),
    limit,
    dryRun,
    apply
  };
}

async function main() {
  loadEnvFiles();
  installServerOnlyShim();
  const target = resolveSupabaseHost();
  const args = parseArgs(process.argv.slice(2));

  const {
    listCommittedEnrollmentPacketCompletionRepairCandidates,
    repairCommittedEnrollmentPacketCompletions
  } = await import("../lib/services/enrollment-packet-completion-cascade");

  if (args.dryRun) {
    const packetIds = args.packetIds.length > 0 ? args.packetIds : await listCommittedEnrollmentPacketCompletionRepairCandidates({
      limit: args.limit
    });
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          targetHost: target.host,
          limit: args.limit,
          packetIds
        },
        null,
        2
      )
    );
    return;
  }

  if (!args.apply) {
    throw new Error("Use --apply to replay the canonical enrollment packet completion cascade.");
  }

  if (!target.isLocal && process.env.ALLOW_REMOTE_ENROLLMENT_PACKET_REPAIR !== "true") {
    throw new Error(
      `Refusing to repair enrollment packets against remote Supabase host ${target.host}. Set ALLOW_REMOTE_ENROLLMENT_PACKET_REPAIR=true to override.`
    );
  }

  const result = await repairCommittedEnrollmentPacketCompletions(
    args.packetIds.length > 0 ? { packetIds: args.packetIds } : { limit: args.limit }
  );

  console.log(
    JSON.stringify(
      {
        done: true,
        targetHost: target.host,
        limit: args.limit,
        ...result
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown enrollment packet repair error."
      },
      null,
      2
    )
  );
  process.exit(1);
});
