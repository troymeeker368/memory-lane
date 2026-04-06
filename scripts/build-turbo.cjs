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
  return process.platform === "win32" && (
    result.error?.code === "EPERM" ||
    combinedOutput.includes("Error: spawn EPERM") ||
    combinedOutput.includes("spawnSync") && combinedOutput.includes("EPERM")
  );
}

function runNodeScript(scriptPath, args = [], options = {}) {
  const maxAttempts = options.maxAttempts ?? 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync(process.execPath, [scriptPath, ...args], {
      stdio: "pipe",
      env: {
        ...process.env,
        ...(options.env ?? {})
      },
      encoding: "utf8"
    });

    writeCapturedOutput(result);

    if (!result.error && result.status === 0) {
      return result;
    }

    if (isTransientWindowsSpawnEperm(result) && attempt < maxAttempts) {
      console.warn(
        `[build-turbo] Windows worker spawn hit transient EPERM on attempt ${attempt}/${maxAttempts}. Retrying once...`
      );
      sleepMs(750);
      continue;
    }

    if (result.error) {
      const error = new Error(result.error.message);
      error.code = result.error.code ?? null;
      throw error;
    }

    const error = new Error(`[build-turbo] child process exited with status ${result.status ?? 1}`);
    error.status = result.status ?? 1;
    throw error;
  }
}

process.env.NEXT_USE_TURBOPACK = "1";

try {
  runNodeScript(require.resolve("next/dist/bin/next"), ["build", "--turbopack"], {
    maxAttempts: 2,
    env: {
      NEXT_BUILD_CPUS: "1",
      NEXT_BUILD_WORKER_THREADS: "1",
      NEXT_USE_TURBOPACK: "1",
      NEXT_SKIP_BUILD_TYPECHECK: "1"
    }
  });
} catch (error) {
  console.warn(
    `[build-turbo] falling back to webpack build after Turbopack failure: ${error instanceof Error ? error.message : "unknown error"}`
  );
  require("./build-webpack.cjs");
}
