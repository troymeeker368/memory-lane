"use strict";

const fs = require("node:fs");

const {
  assertDatabaseUpToDate,
  buildTypesFileContent,
  canonicalTypesFile,
  generateTypesBody,
  getSchemaMetadata,
  normalizeNewlines,
  readCanonicalTypesFile
} = require("./lib/db-sync.cjs");

function resolveBody(argv) {
  if (argv.includes("--stdin")) {
    const body = fs.readFileSync(0, "utf8");
    if (!String(body).trim()) {
      throw new Error(
        "Supabase type generation returned no output on stdin. If the Supabase CLI reported \"Access token not provided\", run `npx supabase login` or set SUPABASE_ACCESS_TOKEN before running db:check."
      );
    }
    return body;
  }

  assertDatabaseUpToDate("linked");
  return generateTypesBody("linked");
}

function main() {
  const schemaMetadata = getSchemaMetadata();
  const actualContent = readCanonicalTypesFile();

  if (!actualContent) {
    throw new Error(`Generated Supabase types file is missing at ${canonicalTypesFile}. Run npm run db:sync.`);
  }

  const expectedContent = buildTypesFileContent({
    mode: "linked",
    ...schemaMetadata,
    body: resolveBody(process.argv.slice(2))
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
