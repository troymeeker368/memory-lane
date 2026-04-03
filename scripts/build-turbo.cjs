#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeCapturedOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function isTransientWindowsSpawnEperm(result) {
  const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return process.platform === "win32" && (result.error?.code === "EPERM" || combinedOutput.includes("Error: spawn EPERM"));
}

function runNodeScript(scriptPath, args = [], options = {}) {
  const maxAttempts = options.maxAttempts ?? 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync(process.execPath, [scriptPath, ...args], {
      stdio: "pipe",
      env: process.env,
      encoding: "utf8"
    });

    writeCapturedOutput(result);

    if (!result.error && result.status === 0) {
      return;
    }

    if (isTransientWindowsSpawnEperm(result) && attempt < maxAttempts) {
      console.warn(
        `[build-turbo] Windows worker spawn hit transient EPERM on attempt ${attempt}/${maxAttempts}. Retrying once...`
      );
      sleepMs(750);
      continue;
    }

    if (result.error) {
      console.error(`[build-turbo] ${result.error.message}`);
      process.exit(1);
    }

    process.exit(result.status ?? 1);
  }
}

process.env.NEXT_USE_TURBOPACK = "1";
runNodeScript(require.resolve("next/dist/bin/next"), ["build", "--turbopack"], { maxAttempts: 2 });
