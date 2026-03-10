import "server-only";

import fs from "node:fs";
import path from "node:path";

const PROJECT_MOCK_STATE_DIR = path.join(process.cwd(), ".mock-state");
const TEMP_MOCK_STATE_DIR = path.join(process.env.TEMP ?? process.env.TMPDIR ?? "/tmp", "memory-lane-mock-state");
const WRITE_RETRY_COUNT = 5;
const WRITE_RETRY_DELAY_MS = 40;
let resolvedMockStateDir: string | null | undefined;

function sleepSync(ms: number) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Busy wait is acceptable here because this code runs in local mock mode only.
  }
}

function ensureWritableDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
}

function resolveMockStateDir() {
  if (resolvedMockStateDir !== undefined) {
    return resolvedMockStateDir;
  }

  const candidates = [PROJECT_MOCK_STATE_DIR, TEMP_MOCK_STATE_DIR];
  for (const dir of candidates) {
    try {
      ensureWritableDir(dir);
      resolvedMockStateDir = dir;
      return resolvedMockStateDir;
    } catch {
      // Try next candidate.
    }
  }

  resolvedMockStateDir = null;
  return resolvedMockStateDir;
}

function getFilePath(fileName: string) {
  const stateDir = resolveMockStateDir();
  if (!stateDir) return null;
  return path.join(stateDir, fileName);
}

function tryParseJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return null;
  return JSON.parse(raw) as T;
}

export function readMockStateJson<T>(fileName: string, fallback: T): T {
  const filePath = getFilePath(fileName);
  if (!filePath) return fallback;
  const backupPath = `${filePath}.bak`;

  try {
    const primary = tryParseJsonFile<T>(filePath);
    if (primary != null) return primary;
  } catch {
    // Continue to backup fallback below.
  }

  try {
    const backup = tryParseJsonFile<T>(backupPath);
    if (backup != null) {
      try {
        // Attempt self-heal of the primary file from backup.
        fs.copyFileSync(backupPath, filePath);
      } catch {
        // Non-fatal in mock mode.
      }
      return backup;
    }
  } catch {
    // Fall through to fallback.
  }

  return fallback;
}

export function writeMockStateJson<T>(fileName: string, data: T) {
  const filePath = getFilePath(fileName);
  if (!filePath) return;
  const backupPath = `${filePath}.bak`;
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;

  fs.writeFileSync(tempPath, payload, "utf8");

  const tryReplace = () => {
    try {
      fs.renameSync(tempPath, filePath);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows can throw EPERM/EBUSY/EACCES during replace if destination
      // is briefly in use by another process (AV/indexer/dev watcher).
      if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
        return false;
      }
      throw error;
    }
  };

  let replaced = false;
  for (let attempt = 0; attempt < WRITE_RETRY_COUNT; attempt += 1) {
    replaced = tryReplace();
    if (replaced) break;
    sleepSync(WRITE_RETRY_DELAY_MS * (attempt + 1));
  }

  if (!replaced) {
    // Last-resort write path: overwrite destination directly from temp.
    // This is still guarded by retries and used only when atomic rename is locked.
    for (let attempt = 0; attempt < WRITE_RETRY_COUNT; attempt += 1) {
      try {
        fs.copyFileSync(tempPath, filePath);
        replaced = true;
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") {
          throw error;
        }
        sleepSync(WRITE_RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  try {
    if (!replaced) {
      throw new Error(`Unable to persist mock state file: ${fileName}`);
    }
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch {
      // Non-fatal in mock mode.
    }
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {
        // Non-fatal in mock mode.
      }
    }
  }
}
