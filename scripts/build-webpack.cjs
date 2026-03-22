#!/usr/bin/env node

const { rmSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

function runShell(command) {
  const result = spawnSync(command, {
    stdio: "inherit",
    shell: true,
    env: process.env
  });

  if (result.error) {
    console.error(`[build-webpack] ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.env.NEXT_DISABLE_WEBPACK_CACHE = "1";

runShell("npx kill-port 3001");
rmSync(".next", { recursive: true, force: true });
runShell("npx next build");
