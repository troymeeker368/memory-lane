#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

function runNodeScript(scriptPath, args = [], options = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(options.env ?? {})
    }
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

runNodeScript(require.resolve("next/dist/bin/next"), ["build", "--webpack"], {
  env: {
    NEXT_BUILD_CPUS: "1",
    NEXT_BUILD_WORKER_THREADS: "1",
    NEXT_DISABLE_WEBPACK_CACHE: "1",
    NEXT_USE_WEBPACK: "1",
    NEXT_SKIP_BUILD_TYPECHECK: "1"
  }
});
