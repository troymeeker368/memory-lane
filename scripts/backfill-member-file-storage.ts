import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createSupabaseAdminClient } from "../lib/supabase/admin";

const MEMBER_DOCUMENTS_BUCKET = "member-documents";

type LegacyMemberFileRow = {
  id: string;
  member_id: string;
  file_name: string | null;
  file_type: string | null;
  file_data_url: string | null;
  storage_object_path: string | null;
};

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

function resolveSupabaseHost() {
  const raw = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!raw) return { host: "", isLocal: false };
  try {
    const host = new URL(raw).host;
    return {
      host,
      isLocal: /localhost|127\.0\.0\.1/i.test(host)
    };
  } catch {
    return { host: raw, isLocal: false };
  }
}

function parseArgs(argv: string[]) {
  let dryRun = false;
  let limit = Number.POSITIVE_INFINITY;
  let batchSize = 100;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    if (arg === "--limit" && argv[i + 1]) {
      limit = Number(argv[i + 1]);
      i += 1;
    }
    if (arg.startsWith("--limit=")) {
      limit = Number(arg.split("=")[1]);
    }
    if (arg === "--batch-size" && argv[i + 1]) {
      batchSize = Number(argv[i + 1]);
      i += 1;
    }
    if (arg.startsWith("--batch-size=")) {
      batchSize = Number(arg.split("=")[1]);
    }
  }

  if (!Number.isFinite(limit) || limit <= 0) limit = Number.POSITIVE_INFINITY;
  if (!Number.isFinite(batchSize) || batchSize <= 0) batchSize = 100;
  batchSize = Math.max(1, Math.min(500, Math.trunc(batchSize)));

  return {
    dryRun,
    limit,
    batchSize
  };
}

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*]/g, "").trim();
}

function slugifyMemberFileSegment(value: string) {
  return safeFileName(value)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseDataUrlPayload(dataUrl: string, errorMessage = "Invalid data URL payload.") {
  const normalized = dataUrl.trim();
  const base64Match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(normalized);
  if (base64Match) {
    return {
      contentType: base64Match[1],
      bytes: Buffer.from(base64Match[2], "base64")
    };
  }
  const plainMatch = /^data:([^;,]+)(?:;charset=[^;,]+)?,(.*)$/i.exec(normalized);
  if (!plainMatch) throw new Error(errorMessage);
  return {
    contentType: plainMatch[1],
    bytes: Buffer.from(decodeURIComponent(plainMatch[2]), "utf8")
  };
}

function parseMemberDocumentStorageUri(storageUri: string | null | undefined) {
  const normalized = String(storageUri ?? "").trim();
  if (!normalized) return null;
  const prefix = `storage://${MEMBER_DOCUMENTS_BUCKET}/`;
  if (!normalized.startsWith(prefix)) return null;
  return normalized.slice(prefix.length);
}

function isDataUrl(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().startsWith("data:");
}

async function uploadMemberDocumentObject(objectPath: string, bytes: Buffer, contentType: string) {
  const admin = createSupabaseAdminClient("member_file_backfill");
  const { error } = await admin.storage.from(MEMBER_DOCUMENTS_BUCKET).upload(objectPath, bytes, {
    contentType,
    upsert: true
  });
  if (error) throw new Error(error.message);
}

async function deleteMemberDocumentObject(objectPath: string) {
  const admin = createSupabaseAdminClient("member_file_backfill");
  const { error } = await admin.storage.from(MEMBER_DOCUMENTS_BUCKET).remove([objectPath]);
  if (error) throw new Error(error.message);
}

async function backfillLegacyRow(row: LegacyMemberFileRow) {
  const existingStoragePath = String(row.storage_object_path ?? "").trim();
  if (existingStoragePath) return existingStoragePath;

  const legacyValue = String(row.file_data_url ?? "").trim();
  if (!legacyValue) return null;

  let objectPath = parseMemberDocumentStorageUri(legacyValue);
  if (!objectPath) {
    if (!isDataUrl(legacyValue)) {
      throw new Error("Legacy member file data is neither a supported data URL nor a storage URI.");
    }
    const parsed = parseDataUrlPayload(legacyValue, "Stored member file data is invalid.");
    const objectName = slugifyMemberFileSegment(String(row.file_name ?? "").trim() || `${row.id}.pdf`) || `${row.id}.pdf`;
    objectPath = `members/${row.member_id}/member-files/legacy/${row.id}-${objectName}`;
    await uploadMemberDocumentObject(
      objectPath,
      parsed.bytes,
      String(row.file_type ?? "").trim() || parsed.contentType || "application/octet-stream"
    );
  }

  const admin = createSupabaseAdminClient("member_file_backfill");
  const { error: updateError } = await admin
    .from("member_files")
    .update({
      storage_object_path: objectPath,
      file_data_url: null
    })
    .eq("id", row.id);
  if (updateError) {
    if (isDataUrl(legacyValue)) {
      await deleteMemberDocumentObject(objectPath);
    }
    throw new Error(updateError.message);
  }

  return objectPath;
}

async function backfillLegacyMemberFileStorageBatch(limit: number) {
  const pending = await listPendingRows(limit);
  const rows = pending.rows as LegacyMemberFileRow[];
  let repaired = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (const row of rows) {
    try {
      const result = await backfillLegacyRow(row);
      if (result) repaired += 1;
    } catch (error) {
      failures.push({
        id: row.id,
        error: error instanceof Error ? error.message : "Unknown legacy member file backfill error."
      });
    }
  }

  return {
    scanned: rows.length,
    repaired,
    failures
  };
}

async function listPendingRows(limit: number) {
  const admin = createSupabaseAdminClient("member_file_backfill");
  const { data, error, count } = await admin
    .from("member_files")
    .select("id, member_id, file_name, file_type, file_data_url, storage_object_path", {
      count: "exact"
    })
    .is("storage_object_path", null)
    .not("file_data_url", "is", null)
    .order("uploaded_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  return {
    rows: data ?? [],
    totalCount: count ?? 0
  };
}

async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  const previewLimit = Number.isFinite(args.limit) ? Math.min(args.batchSize, args.limit) : args.batchSize;
  const target = resolveSupabaseHost();

  if (args.dryRun) {
    const pending = await listPendingRows(previewLimit);
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          targetHost: target.host,
          totalPending: pending.totalCount,
          previewed: pending.rows.length,
          rows: pending.rows.map((row) => ({
            id: row.id,
            memberId: row.member_id,
            fileName: row.file_name,
            fileType: row.file_type,
            legacyShape: String(row.file_data_url ?? "").startsWith("storage://") ? "storage-uri" : "data-url"
          }))
        },
        null,
        2
      )
    );
    return;
  }

  if (!target.isLocal && process.env.ALLOW_REMOTE_MEMBER_FILE_BACKFILL !== "true") {
    throw new Error(
      `Refusing live member-file backfill against remote Supabase host ${target.host}. Set ALLOW_REMOTE_MEMBER_FILE_BACKFILL=true to override.`
    );
  }

  let repaired = 0;
  let scanned = 0;
  let processed = 0;
  const failures: Array<{ id: string; error: string }> = [];

  while (processed < args.limit) {
    const remaining = Number.isFinite(args.limit) ? args.limit - processed : args.batchSize;
    const batchLimit = Math.max(1, Math.min(args.batchSize, remaining));
    const result = await backfillLegacyMemberFileStorageBatch(batchLimit);
    scanned += result.scanned;
    repaired += result.repaired;
    processed += result.scanned;
    failures.push(...result.failures);

    console.log(
      JSON.stringify(
        {
          batchScanned: result.scanned,
          batchRepaired: result.repaired,
          batchFailures: result.failures.length,
          totalScanned: scanned,
          totalRepaired: repaired,
          totalFailures: failures.length,
          totalProcessed: processed
        },
        null,
        2
      )
    );

    if (result.scanned < batchLimit) break;
    if (result.scanned === 0) break;
    if (result.repaired === 0 && result.failures.length > 0) break;
  }

  console.log(
    JSON.stringify(
      {
        done: true,
        scanned,
        repaired,
        failures,
        processed
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
        error: error instanceof Error ? error.message : "Unknown backfill error."
      },
      null,
      2
    )
  );
  process.exit(1);
});
