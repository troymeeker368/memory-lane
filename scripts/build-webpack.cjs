#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
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
process.env.NEXT_USE_WEBPACK = "1";

runNodeScript(require.resolve("next/dist/bin/next"), ["build", "--webpack"]);
