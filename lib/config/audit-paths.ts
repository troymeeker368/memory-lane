import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..", "..");
const auditOutputDir = path.resolve(projectRoot, "docs", "audits");

export const AUDIT_OUTPUT_DIR_RELATIVE = "docs/audits";
export const AUDIT_PROJECT_ROOT = normalizeAbsolutePath(projectRoot);
export const AUDIT_OUTPUT_DIR = normalizeAbsolutePath(auditOutputDir);

function normalizeAbsolutePath(input: string) {
  return path.normalize(path.resolve(input));
}

function isPathInsideDirectory(targetPath: string, directoryPath: string) {
  const relative = path.relative(directoryPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function getProjectRoot() {
  return AUDIT_PROJECT_ROOT;
}

export function getAuditOutputDir() {
  return AUDIT_OUTPUT_DIR;
}

export function ensureAuditOutputDir() {
  fs.mkdirSync(AUDIT_OUTPUT_DIR, { recursive: true });
  return AUDIT_OUTPUT_DIR;
}

export function assertAuditOutputPath(candidatePath: string) {
  const resolvedPath = normalizeAbsolutePath(candidatePath);

  if (!isPathInsideDirectory(resolvedPath, AUDIT_OUTPUT_DIR)) {
    throw new Error(
      `Audit output must stay within ${AUDIT_OUTPUT_DIR}. Received: ${resolvedPath}`,
    );
  }

  return resolvedPath;
}

export function buildAuditOutputPath(fileName: string) {
  const trimmedName = fileName.trim();

  if (!trimmedName) {
    throw new Error("Audit output filename is required.");
  }

  if (path.isAbsolute(trimmedName)) {
    throw new Error(
      `Audit output filenames must be relative to ${AUDIT_OUTPUT_DIR_RELATIVE}. Received: ${trimmedName}`,
    );
  }

  const normalizedRelativeName = normalizeAuditRelativePath(trimmedName);
  if (!normalizedRelativeName) {
    throw new Error("Audit output filename is required.");
  }

  return assertAuditOutputPath(path.join(AUDIT_OUTPUT_DIR, normalizedRelativeName));
}

export function ensureAuditOutputPath(fileName: string) {
  ensureAuditOutputDir();
  const outputPath = buildAuditOutputPath(fileName);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  return assertAuditOutputPath(outputPath);
}

function normalizeAuditRelativePath(input: string) {
  const canonicalPrefix = `${AUDIT_OUTPUT_DIR_RELATIVE}/`;
  let normalized = input.replace(/\\/g, "/").replace(/^\.\/+/, "");

  while (normalized.startsWith(canonicalPrefix)) {
    normalized = normalized.slice(canonicalPrefix.length);
  }

  return normalized.replace(/^\/+/, "");
}
