const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const compiledDir = path.join(repoRoot, ".tmp-quality-gates");

const failures = [];

function fail(message) {
  failures.push(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Child process exited with status ${result.status ?? 1}.`);
  }
}

function compileGateTargets() {
  if (fs.existsSync(compiledDir)) {
    fs.rmSync(compiledDir, { recursive: true, force: true });
  }

  runNodeScript(require.resolve("typescript/lib/tsc"), [
    "--target",
    "ES2020",
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--skipLibCheck",
    "--esModuleInterop",
    "--noEmit",
    "false",
    "--outDir",
    compiledDir,
    "lib/services/timecard-workflow.ts"
  ]);
}

function buildAppRoutes() {
  const appPortal = path.join(repoRoot, "app", "(portal)");
  const routes = new Set();

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    entries.forEach((entry) => {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        return;
      }
      if (!entry.isFile() || entry.name !== "page.tsx") return;

      const relativeDir = path.relative(appPortal, path.dirname(fullPath));
      const route = relativeDir === "" ? "/" : `/${relativeDir.split(path.sep).join("/")}`;
      routes.add(route);
    });
  }

  walk(appPortal);
  return routes;
}

function asDynamicRouteRegex(routePattern) {
  const segments = routePattern.split("/").filter(Boolean);
  const mapped = segments.map((segment) => {
    if (segment.startsWith("[") && segment.endsWith("]")) {
      return "[^/]+";
    }
    return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return new RegExp(`^/${mapped.join("/")}$`);
}

function routeExists(route, routeSet) {
  if (routeSet.has(route)) return true;
  for (const pattern of routeSet) {
    if (!pattern.includes("[")) continue;
    if (asDynamicRouteRegex(pattern).test(route)) {
      return true;
    }
  }
  return false;
}

function extractNavItems(source) {
  const navMatch = source.match(/export const NAV_ITEMS:[\s\S]*?=\s*\[([\s\S]*?)\];/);
  if (!navMatch) return [];
  const navBody = navMatch[1];

  const entries = [];
  const itemRegex = /\{[\s\S]*?label:\s*"([^"]+)"[\s\S]*?href:\s*"([^"]+)"[\s\S]*?\}/g;
  let match = itemRegex.exec(navBody);
  while (match) {
    entries.push({ label: match[1], href: match[2] });
    match = itemRegex.exec(navBody);
  }
  return entries;
}

function runPermissionChecks(coreSource, navSource) {
  check(
    /"program-assistant":\s*\{[\s\S]*?operations:\s*permission\(false,\s*false,\s*false,\s*false\)/.test(coreSource),
    "Program assistant default permissions should block operations."
  );
  check(
    /manager:\s*\{[\s\S]*?operations:\s*permission\(true,\s*true,\s*true,\s*false\)/.test(coreSource),
    "Manager default permissions should allow operations."
  );
  check(
    /\{ label: "Director Timecards"[\s\S]*?roles: \["manager", "director", "admin"\]/.test(navSource),
    "Director Timecards nav entry should stay limited to manager/director/admin."
  );
  check(
    /\{ label: "Billing"[\s\S]*?roles: \["admin", "manager", "director", "coordinator"\]/.test(navSource),
    "Billing nav entry should stay restricted to elevated roles."
  );
  check(!/staff_href:\s*`\/staff\//.test(`${coreSource}\n${navSource}`), "Legacy /staff links should not appear in permission/navigation source.");
}

function runTimeCalculationChecks(workflow) {
  const standardShift = workflow.calculateDailyTimecard({
    punches: [
      { timestamp: "2026-03-01T13:00:00.000Z", type: "in", source: "employee", status: "active" },
      { timestamp: "2026-03-01T22:00:00.000Z", type: "out", source: "employee", status: "active" }
    ],
    ptoHours: 2
  });

  check(standardShift.rawHours === 9, "Expected 9.00 raw hours for a 9-hour shift.");
  check(standardShift.mealDeductionHours === 0.5, "Expected meal deduction for shifts over 8 hours.");
  check(standardShift.workedHours === 8.5, "Expected adjusted worked hours after meal deduction.");
  check(standardShift.totalPaidHours === 10.5, "Expected paid hours to include PTO.");
  check(!standardShift.hasException, "Standard in/out shift should not have exceptions.");

  const missingOut = workflow.calculateDailyTimecard({
    punches: [{ timestamp: "2026-03-01T13:00:00.000Z", type: "in", source: "employee", status: "active" }],
    ptoHours: 0
  });
  check(missingOut.hasException, "Missing punch-out should raise an exception.");
  check(missingOut.exceptionReasons.includes("missing_in_or_out"), "Missing punch-out should include missing_in_or_out reason.");

  const duplicateSequence = workflow.calculateDailyTimecard({
    punches: [
      { timestamp: "2026-03-01T13:00:00.000Z", type: "in", source: "employee", status: "active" },
      { timestamp: "2026-03-01T13:02:00.000Z", type: "in", source: "employee", status: "active" },
      { timestamp: "2026-03-01T22:00:00.000Z", type: "out", source: "employee", status: "active" }
    ],
    ptoHours: 0
  });
  check(duplicateSequence.exceptionReasons.includes("odd_punch_sequence"), "Back-to-back IN punches should mark odd sequence.");
  check(duplicateSequence.exceptionReasons.includes("duplicate_punch_issue"), "Near-duplicate punches should mark duplicate punch issue.");

  const overtime = workflow.allocatePayPeriodOvertime([
    { id: "a", workDate: "2026-03-01", workedHours: 20, ptoHours: 0 },
    { id: "b", workDate: "2026-03-02", workedHours: 22, ptoHours: 0 }
  ]);
  check(overtime.get("a") === 0, "First day should not accrue overtime before threshold.");
  check(overtime.get("b") === 2, "Second day should accrue overtime after crossing 40 hours.");
}

function runRouteChecks(navItems) {
  const routes = buildAppRoutes();
  navItems
    .filter((item) => item.href.startsWith("/"))
    .forEach((item) => {
    check(routeExists(item.href, routes), `NAV route is unresolved: ${item.href} (${item.label}).`);
  });

  [
    "/time-card",
    "/time-card/director",
    "/time-card/forgotten-punch",
    "/time-card/punch-history",
    "/operations/payor",
    "/operations/payor/exports",
    "/time-hr/user-management",
    "/reports/monthly-ancillary",
    "/health/assessment",
    "/health/physician-orders"
  ].forEach((criticalRoute) => {
    check(routeExists(criticalRoute, routes), `Critical stabilized route missing: ${criticalRoute}.`);
  });
}

function runMigrationChecks() {
  const migrationDir = path.join(repoRoot, "supabase", "migrations");
  const files = fs
    .readdirSync(migrationDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  check(files.length > 0, "No SQL migrations found in supabase/migrations.");

  const prefixMap = new Map();
  files.forEach((file) => {
    const match = file.match(/^(\d+)_([a-z0-9_]+)\.sql$/);
    check(Boolean(match), `Migration filename should match ####_name.sql: ${file}.`);
    if (!match) return;

    const prefix = match[1];
    const grouped = prefixMap.get(prefix) ?? [];
    grouped.push(file);
    prefixMap.set(prefix, grouped);
  });

  for (const [prefix, grouped] of prefixMap.entries()) {
    if (grouped.length > 1) {
      fail(`Duplicate migration prefix ${prefix}: ${grouped.join(", ")}.`);
    }
  }
}

function runImplicitServiceRoleChecks() {
  const allowedImplicitDefaults = new Map([
    ["lib/services/care-plan-nurse-esign.ts", 2],
    ["lib/services/mar-member-options.ts", 1],
    ["lib/services/mar-monthly-report.ts", 1],
    ["lib/services/mar-prn-workflow.ts", 9],
    ["lib/services/mar-workflow-read.ts", 2],
    ["lib/services/mar-workflow.ts", 2],
    ["lib/services/notifications.ts", 2],
    ["lib/services/physician-order-post-sign-runtime.ts", 6],
    ["lib/services/physician-orders-supabase.ts", 1]
  ]);
  const foundImplicitDefaults = new Map();
  const roots = [path.join(repoRoot, "app"), path.join(repoRoot, "lib")];
  const pattern = /serviceRole\s*\?\?\s*true/g;

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    entries.forEach((entry) => {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        return;
      }
      if (!entry.isFile() || !/\.(ts|tsx|js|jsx)$/.test(entry.name)) return;

      const source = fs.readFileSync(fullPath, "utf8");
      const matches = source.match(pattern);
      if (!matches?.length) return;

      const relativePath = path.relative(repoRoot, fullPath).split(path.sep).join("/");
      foundImplicitDefaults.set(relativePath, matches.length);
    });
  }

  roots.forEach((root) => {
    if (fs.existsSync(root)) walk(root);
  });

  for (const [relativePath, count] of foundImplicitDefaults.entries()) {
    const allowedCount = allowedImplicitDefaults.get(relativePath);
    check(
      allowedCount === count,
      allowedCount == null
        ? `New implicit service-role default found: ${relativePath} (${count} match${count === 1 ? "" : "es"}). Use an explicit session-scoped default or the approved service-role gateway instead.`
        : `Implicit service-role defaults changed in ${relativePath}: expected ${allowedCount}, found ${count}. Migrate the call site or update the allowlist intentionally.`
    );
  }

  for (const [relativePath, allowedCount] of allowedImplicitDefaults.entries()) {
    if (!foundImplicitDefaults.has(relativePath)) continue;
    check(
      foundImplicitDefaults.get(relativePath) === allowedCount,
      `Implicit service-role defaults changed in ${relativePath}: expected ${allowedCount}, found ${foundImplicitDefaults.get(relativePath)}.`
    );
  }
}

function runPrivilegedClientBoundaryChecks() {
  const roots = [path.join(repoRoot, "app"), path.join(repoRoot, "lib"), path.join(repoRoot, "scripts")];
  const deprecatedCreateClientPattern = /createClient\(\{\s*serviceRole:\s*true\s*\}\)/;
  const unlabeledAdminPattern = /createSupabaseAdminClient\(\s*\)/;

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    entries.forEach((entry) => {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        return;
      }
      if (!entry.isFile() || !/\.(ts|tsx|js|jsx)$/.test(entry.name)) return;

      const source = fs.readFileSync(fullPath, "utf8");
      const relativePath = path.relative(repoRoot, fullPath).split(path.sep).join("/");
      if (deprecatedCreateClientPattern.test(source)) {
        fail(
          `Deprecated privileged client pattern found in ${relativePath}. Replace createClient({ serviceRole: true }) with a named service-role use case.`
        );
      }
      if (unlabeledAdminPattern.test(source)) {
        fail(
          `Unlabeled privileged admin client found in ${relativePath}. createSupabaseAdminClient() must always receive a named use case.`
        );
      }
    });
  }

  roots.forEach((root) => {
    if (fs.existsSync(root)) walk(root);
  });
}

function main() {
  try {
    compileGateTargets();
    const permissionCoreSource = fs.readFileSync(path.join(repoRoot, "lib", "permissions", "core.ts"), "utf8");
    const permissionNavSource = fs.readFileSync(path.join(repoRoot, "lib", "permissions", "nav.ts"), "utf8");
    const navItems = extractNavItems(permissionNavSource);
    const workflow = require(path.join(compiledDir, "timecard-workflow.js"));

    runPermissionChecks(permissionCoreSource, permissionNavSource);
    runTimeCalculationChecks(workflow);
    runRouteChecks(navItems);
    runMigrationChecks();
    runImplicitServiceRoleChecks();
    runPrivilegedClientBoundaryChecks();
  } catch (error) {
    fail(`Quality gate runtime failure: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (fs.existsSync(compiledDir)) {
      fs.rmSync(compiledDir, { recursive: true, force: true });
    }
  }

  if (failures.length > 0) {
    console.error("Quality gates failed:");
    failures.forEach((message) => console.error(`- ${message}`));
    process.exit(1);
  }

  console.log("Quality gates passed.");
}

main();
