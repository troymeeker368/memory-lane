"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const hookPath = path.join(repoRoot, ".githooks", "pre-push");

function runGit(args) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe"
  });
}

function main() {
  if (!fs.existsSync(path.join(repoRoot, ".git"))) {
    console.log("[hooks] No .git directory found. Skipping git hook install.");
    return;
  }

  if (!fs.existsSync(hookPath)) {
    console.log("[hooks] No pre-push hook file found. Skipping git hook install.");
    return;
  }

  const current = runGit(["config", "--get", "core.hooksPath"]);
  const currentValue = (current.stdout ?? "").trim();

  if (current.status !== 0 || currentValue !== ".githooks") {
    const configured = runGit(["config", "core.hooksPath", ".githooks"]);
    if (configured.status !== 0) {
      throw new Error((configured.stderr ?? "").trim() || "git config core.hooksPath .githooks failed.");
    }
  }

  fs.chmodSync(hookPath, 0o755);
  console.log("[hooks] Configured git core.hooksPath to .githooks");
}

try {
  main();
} catch (error) {
  console.warn(`[hooks] ${error instanceof Error ? error.message : String(error)}`);
}
