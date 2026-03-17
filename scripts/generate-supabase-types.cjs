"use strict";

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

function main() {
  const mode = resolveMode(process.argv.slice(2));
  const schemaMetadata = getSchemaMetadata();

  assertDatabaseUpToDate(mode);

  const body = generateTypesBody(mode);
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
