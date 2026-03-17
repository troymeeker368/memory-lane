"use strict";

const {
  assertDatabaseUpToDate,
  buildTypesFileContent,
  canonicalTypesFile,
  generateTypesBody,
  getSchemaMetadata,
  normalizeNewlines,
  readCanonicalTypesFile
} = require("./lib/db-sync.cjs");

function main() {
  const schemaMetadata = getSchemaMetadata();
  const actualContent = readCanonicalTypesFile();

  if (!actualContent) {
    throw new Error(`Generated Supabase types file is missing at ${canonicalTypesFile}. Run npm run db:sync.`);
  }

  assertDatabaseUpToDate("linked");

  const expectedContent = buildTypesFileContent({
    mode: "linked",
    ...schemaMetadata,
    body: generateTypesBody("linked")
  });

  if (normalizeNewlines(actualContent) !== normalizeNewlines(expectedContent)) {
    throw new Error(
      [
        `Supabase schema/types are out of sync with the linked project or local migrations.`,
        `Run npm run db:sync and commit ${canonicalTypesFile}.`
      ].join("\n")
    );
  }

  console.log("[db:check] linked database and generated types are in sync.");
}

try {
  main();
} catch (error) {
  console.error(`[db:check] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
