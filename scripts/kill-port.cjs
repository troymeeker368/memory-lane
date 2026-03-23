#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

function fail(message) {
  console.error(`[kill-port] ${message}`);
  process.exit(1);
}

function parsePort(rawValue) {
  const port = Number.parseInt(String(rawValue ?? "").trim(), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail("Provide a valid TCP port.");
  }
  return port;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error) {
    fail(result.error.message);
  }

  return result;
}

function unique(values) {
  return [...new Set(values)];
}

function parseWindowsPids(output, port) {
  return unique(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line.includes(`:${port}`) && line.toUpperCase().includes("LISTENING"))
      .map((line) => line.split(/\s+/).at(-1))
      .filter((value) => value && /^\d+$/.test(value))
  );
}

function parsePosixPids(output) {
  return unique(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((value) => /^\d+$/.test(value))
  );
}

function killWindowsPid(pid) {
  const result = run("taskkill", ["/PID", pid, "/F"]);
  if (result.status !== 0 && !String(result.stdout ?? "").includes("not found")) {
    const stderr = String(result.stderr ?? "").trim();
    const stdout = String(result.stdout ?? "").trim();
    fail(stderr || stdout || `Unable to kill PID ${pid}.`);
  }
}

function killPosixPid(pid) {
  const result = run("kill", ["-9", pid]);
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    fail(stderr || `Unable to kill PID ${pid}.`);
  }
}

function killPort(port) {
  if (process.platform === "win32") {
    const netstat = run("netstat", ["-ano"]);
    if (netstat.status !== 0) {
      const stderr = String(netstat.stderr ?? "").trim();
      fail(stderr || "netstat failed.");
    }
    const pids = parseWindowsPids(String(netstat.stdout ?? ""), port);
    pids.forEach(killWindowsPid);
    return pids;
  }

  const lsof = run("lsof", ["-ti", `tcp:${port}`]);
  if (lsof.status !== 0 && String(lsof.stderr ?? "").trim()) {
    const stderr = String(lsof.stderr ?? "").trim();
    fail(stderr);
  }
  const pids = parsePosixPids(String(lsof.stdout ?? ""));
  pids.forEach(killPosixPid);
  return pids;
}

const port = parsePort(process.argv[2] ?? process.env.PORT ?? "3001");
const killed = killPort(port);
if (killed.length > 0) {
  console.log(`[kill-port] Freed port ${port} by stopping PID${killed.length === 1 ? "" : "s"} ${killed.join(", ")}.`);
} else {
  console.log(`[kill-port] Port ${port} was already free.`);
}
