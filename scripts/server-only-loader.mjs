import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EMPTY_SERVER_ONLY_MODULE_URL = "data:text/javascript,export default {};";
const ROOT_DIR = process.cwd();

const EXTENSION_CANDIDATES = [
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  path.join("index.ts"),
  path.join("index.tsx"),
  path.join("index.js"),
  path.join("index.mjs")
];

function hasExtension(specifier) {
  return /\.[a-z0-9]+$/i.test(specifier);
}

function existingFileToUrl(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    if (!statSync(filePath).isFile()) return null;
  } catch {
    return null;
  }
  return pathToFileURL(filePath).href;
}

function resolvePathAlias(specifier) {
  if (!specifier.startsWith("@/")) return null;
  const basePath = path.resolve(ROOT_DIR, specifier.slice(2));
  if (hasExtension(basePath)) {
    return existingFileToUrl(basePath);
  }

  for (const candidate of EXTENSION_CANDIDATES) {
    const candidatePath =
      candidate.startsWith("index.") ? path.join(basePath, candidate) : `${basePath}${candidate}`;
    const match = existingFileToUrl(candidatePath);
    if (match) return match;
  }

  return null;
}

function resolveRelativeTs(specifier, parentURL) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../") && !specifier.startsWith("/")) return null;
  if (!parentURL) return null;
  const parentPath = fileURLToPath(parentURL);
  const basePath = path.resolve(path.dirname(parentPath), specifier);

  if (hasExtension(basePath)) {
    return existingFileToUrl(basePath);
  }

  for (const candidate of EXTENSION_CANDIDATES) {
    const candidatePath =
      candidate.startsWith("index.") ? path.join(basePath, candidate) : `${basePath}${candidate}`;
    const match = existingFileToUrl(candidatePath);
    if (match) return match;
  }

  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      url: EMPTY_SERVER_ONLY_MODULE_URL,
      shortCircuit: true
    };
  }

  const aliasResolved = resolvePathAlias(specifier);
  if (aliasResolved) {
    return {
      url: aliasResolved,
      shortCircuit: true
    };
  }

  const relativeResolved = resolveRelativeTs(specifier, context.parentURL);
  if (relativeResolved) {
    return {
      url: relativeResolved,
      shortCircuit: true
    };
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    const filePath = fileURLToPath(url);
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      format: "module",
      source: `export default ${JSON.stringify(parsed)};`,
      shortCircuit: true
    };
  }

  return nextLoad(url, context);
}
