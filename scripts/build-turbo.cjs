#!/usr/bin/env node

const { rmSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    console.error(`[build-turbo] ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.env.NEXT_USE_TURBOPACK = "1";

rmSync(".next", { recursive: true, force: true });
runNodeScript(require.resolve("next/dist/bin/next"), ["build", "--turbopack"]);
