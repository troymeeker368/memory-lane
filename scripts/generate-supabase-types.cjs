"use strict";

const fs = require("node:fs");

const {
  assertDatabaseUpToDate,
  buildTypesFileContent,
  canonicalTypesFile,
  generateTypesBody,
  getSchemaMetadata,
  writeCanonicalTypesFile
} = require("./lib/db-sync.cjs");

function resolveMode(argv) {
  if (argv.includes("--local")) return "local";
  return "linked";
}

function resolveBody(argv, mode) {
  if (argv.includes("--stdin")) {
    const body = fs.readFileSync(0, "utf8");
    if (!String(body).trim()) {
      throw new Error(
        "Supabase type generation returned no output on stdin. If the Supabase CLI reported \"Access token not provided\", run `npx supabase login` or set SUPABASE_ACCESS_TOKEN before running db:types."
      );
    }
    return body;
  }

  assertDatabaseUpToDate(mode);
  return generateTypesBody(mode);
}

function main() {
  const mode = resolveMode(process.argv.slice(2));
  const schemaMetadata = getSchemaMetadata();
  const body = resolveBody(process.argv.slice(2), mode);
  const nextContent = buildTypesFileContent({
    mode,
    ...schemaMetadata,
    body
  });

  writeCanonicalTypesFile(nextContent);
  console.log(`[db:types] wrote ${canonicalTypesFile}`);
  console.log(`[db:types] source=${mode} latestMigration=${schemaMetadata.latestMigration}`);
}

try {
  main();
} catch (error) {
  console.error(`[db:types] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
