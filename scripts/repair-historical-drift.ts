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
  const raw = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!raw) return { host: "", isLocal: false };
  try {
    const host = new URL(raw).host;
    return { host, isLocal: /localhost|127\.0\.0\.1/i.test(host) };
  } catch {
    return { host: raw, isLocal: false };
  }
}

function parseArgs(argv: string[]) {
  const memberIds = new Set<string>();
  let dryRun = true;
  let apply = false;
  let memberFileBatchSize = 100;

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
    if (arg === "--member-id" && argv[i + 1]) {
      memberIds.add(argv[i + 1].trim());
      i += 1;
    }
    if (arg.startsWith("--member-id=")) {
      memberIds.add(arg.split("=")[1].trim());
    }
    if (arg === "--member-file-batch-size" && argv[i + 1]) {
      memberFileBatchSize = Number(argv[i + 1]);
      i += 1;
    }
    if (arg.startsWith("--member-file-batch-size=")) {
      memberFileBatchSize = Number(arg.split("=")[1]);
    }
  }

  if (!Number.isFinite(memberFileBatchSize) || memberFileBatchSize <= 0) memberFileBatchSize = 100;
  memberFileBatchSize = Math.max(1, Math.min(500, Math.trunc(memberFileBatchSize)));

  return {
    dryRun,
    apply,
    memberIds: Array.from(memberIds).filter(Boolean),
    memberFileBatchSize
  };
}

type MemberShellStatus = {
  scopedMemberIds: string[];
  missingCommandCenterMemberIds: string[];
  missingScheduleMemberIds: string[];
};

async function loadMemberShellStatus(memberIds: string[]): Promise<MemberShellStatus> {
  const { createSupabaseAdminClient } = await import("../lib/supabase/admin");
  const admin = createSupabaseAdminClient();

  const normalizedIds = Array.from(new Set(memberIds.map((value) => clean(value)).filter((value): value is string => Boolean(value))));
  const membersQuery = normalizedIds.length > 0
    ? admin.from("members").select("id").in("id", normalizedIds)
    : admin.from("members").select("id");
  const { data: membersData, error: membersError } = await membersQuery;
  if (membersError) throw new Error(`Unable to load members for historical drift repair: ${membersError.message}`);

  const scopedMemberIds = ((membersData ?? []) as Array<{ id: string }>).map((row) => String(row.id));
  if (scopedMemberIds.length === 0) {
    return {
      scopedMemberIds: [],
      missingCommandCenterMemberIds: [],
      missingScheduleMemberIds: []
    };
  }

  const [{ data: commandCenters, error: commandCentersError }, { data: schedules, error: schedulesError }] = await Promise.all([
    admin.from("member_command_centers").select("member_id").in("member_id", scopedMemberIds),
    admin.from("member_attendance_schedules").select("member_id").in("member_id", scopedMemberIds)
  ]);
  if (commandCentersError) throw new Error(`Unable to load member command center shells: ${commandCentersError.message}`);
  if (schedulesError) throw new Error(`Unable to load member attendance schedules: ${schedulesError.message}`);

  const commandCenterIds = new Set(((commandCenters ?? []) as Array<{ member_id: string }>).map((row) => String(row.member_id)));
  const scheduleIds = new Set(((schedules ?? []) as Array<{ member_id: string }>).map((row) => String(row.member_id)));

  return {
    scopedMemberIds,
    missingCommandCenterMemberIds: scopedMemberIds.filter((memberId) => !commandCenterIds.has(memberId)),
    missingScheduleMemberIds: scopedMemberIds.filter((memberId) => !scheduleIds.has(memberId))
  };
}

async function loadOperationsSettingsStatus() {
  const { createSupabaseAdminClient } = await import("../lib/supabase/admin");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("operations_settings").select("id").eq("id", "default").maybeSingle();
  if (error) throw new Error(`Unable to load operations settings singleton: ${error.message}`);
  return {
    exists: Boolean(data)
  };
}

async function loadPendingMemberFileBackfillPreview(limit: number) {
  const { createSupabaseAdminClient } = await import("../lib/supabase/admin");
  const admin = createSupabaseAdminClient();
  const { data, error, count } = await admin
    .from("member_files")
    .select("id, member_id, file_name, file_type, file_data_url, storage_object_path", { count: "exact" })
    .is("storage_object_path", null)
    .not("file_data_url", "is", null)
    .order("uploaded_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Unable to load pending member file backfill rows: ${error.message}`);

  return {
    totalPending: count ?? 0,
    preview: ((data ?? []) as Array<{
      id: string;
      member_id: string;
      file_name: string | null;
      file_type: string | null;
      file_data_url: string | null;
      storage_object_path: string | null;
    }>).map((row) => ({
      id: row.id,
      memberId: row.member_id,
      fileName: row.file_name,
      fileType: row.file_type,
      legacyShape: String(row.file_data_url ?? "").startsWith("storage://") ? "storage-uri" : "data-url"
    }))
  };
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function applyMemberShellRepair(memberIds: string[]) {
  const { backfillMissingMemberCommandCenterRowsSupabase } = await import("../lib/services/member-command-center-runtime");
  let commandCentersInserted = 0;
  let schedulesInserted = 0;

  for (const batch of chunk(memberIds, 250)) {
    const result = await backfillMissingMemberCommandCenterRowsSupabase(batch);
    commandCentersInserted += result.commandCentersInserted;
    schedulesInserted += result.schedulesInserted;
  }

  return {
    commandCentersInserted,
    schedulesInserted
  };
}

async function applyMemberFileRepair(batchSize: number) {
  const { backfillLegacyMemberFileStorageBatch } = await import("../lib/services/member-files");
  let scanned = 0;
  let repaired = 0;
  const failures: Array<{ id: string; error: string }> = [];

  while (true) {
    const batch = await backfillLegacyMemberFileStorageBatch({ limit: batchSize });
    scanned += batch.scanned;
    repaired += batch.repaired;
    failures.push(...batch.failures);
    if (batch.scanned < batchSize) break;
    if (batch.scanned === 0) break;
    if (batch.repaired === 0 && batch.failures.length > 0) break;
  }

  return {
    scanned,
    repaired,
    failures
  };
}

async function main() {
  loadEnvFiles();
  installServerOnlyShim();
  const args = parseArgs(process.argv.slice(2));
  const target = resolveSupabaseHost();

  const [operationsSettings, memberShells, pendingMemberFiles] = await Promise.all([
    loadOperationsSettingsStatus(),
    loadMemberShellStatus(args.memberIds),
    loadPendingMemberFileBackfillPreview(Math.min(args.memberFileBatchSize, 25))
  ]);

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          targetHost: target.host,
          operationsSettings,
          memberShells: {
            scopedMemberCount: memberShells.scopedMemberIds.length,
            missingCommandCenterCount: memberShells.missingCommandCenterMemberIds.length,
            missingScheduleCount: memberShells.missingScheduleMemberIds.length,
            previewMissingCommandCenterMemberIds: memberShells.missingCommandCenterMemberIds.slice(0, 25),
            previewMissingScheduleMemberIds: memberShells.missingScheduleMemberIds.slice(0, 25)
          },
          memberFiles: pendingMemberFiles
        },
        null,
        2
      )
    );
    return;
  }

  if (!args.apply) {
    throw new Error("Use --apply to run the explicit historical drift repair.");
  }

  if (!target.isLocal && process.env.ALLOW_REMOTE_HISTORICAL_DRIFT_REPAIR !== "true") {
    throw new Error(
      `Refusing historical drift repair against remote Supabase host ${target.host}. Set ALLOW_REMOTE_HISTORICAL_DRIFT_REPAIR=true to override.`
    );
  }

  const { repairOperationalSettingsSingleton } = await import("../lib/services/operations-settings");

  let operationsSettingsCreated = false;
  if (!operationsSettings.exists) {
    await repairOperationalSettingsSingleton();
    operationsSettingsCreated = true;
  }

  const shellRepairTargets = Array.from(
    new Set([...memberShells.missingCommandCenterMemberIds, ...memberShells.missingScheduleMemberIds])
  );
  const shellRepairResult =
    shellRepairTargets.length > 0
      ? await applyMemberShellRepair(shellRepairTargets)
      : { commandCentersInserted: 0, schedulesInserted: 0 };

  const memberFileRepairResult = await applyMemberFileRepair(args.memberFileBatchSize);
  const remainingMemberShells = await loadMemberShellStatus(args.memberIds);
  const operationsSettingsAfter = await loadOperationsSettingsStatus();

  console.log(
    JSON.stringify(
      {
        done: true,
        targetHost: target.host,
        operationsSettings: {
          created: operationsSettingsCreated,
          existsAfterRepair: operationsSettingsAfter.exists
        },
        memberShells: {
          scopedMemberCount: remainingMemberShells.scopedMemberIds.length,
          commandCentersInserted: shellRepairResult.commandCentersInserted,
          schedulesInserted: shellRepairResult.schedulesInserted,
          remainingMissingCommandCenterCount: remainingMemberShells.missingCommandCenterMemberIds.length,
          remainingMissingScheduleCount: remainingMemberShells.missingScheduleMemberIds.length
        },
        memberFiles: memberFileRepairResult
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
        error: error instanceof Error ? error.message : "Unknown historical drift repair error."
      },
      null,
      2
    )
  );
  process.exit(1);
});
