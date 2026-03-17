import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type CategoryKey =
  | "rls-security"
  | "canonicality"
  | "migration-safety"
  | "resolver-drift"
  | "shared-rpc-architecture"
  | "acid-transactionality"
  | "idempotency-duplicate-submission"
  | "query-performance"
  | "workflow-simulation"
  | "referential-integrity"
  | "schema-compatibility"
  | "production-readiness";

type MatchStrength = "filename" | "title" | "body";

interface CategoryDefinition {
  key: CategoryKey;
  label: string;
  aliases: {
    filename: RegExp[];
    title: RegExp[];
    body: RegExp[];
  };
}

interface CategoryMatch {
  key: CategoryKey;
  strength: MatchStrength;
  score: number;
}

interface AuditArtifact {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  extension: string;
  title: string | null;
  summaryLine: string | null;
  text: string;
  parsedDate: string | null;
  parsedDateLabel: string;
  matches: CategoryMatch[];
  ignoredReason?: string;
}

const repoRoot = process.cwd();
const auditsDir = path.join(repoRoot, "docs", "audits");
const generatedDate = new Date().toISOString().slice(0, 10);
const outputPath = path.join(auditsDir, `fix-prompt-generator-${generatedDate}.md`);
const supportedExtensions = new Set([".md", ".markdown", ".mdx", ".json", ".txt", ".log"]);

const categories: CategoryDefinition[] = [
  {
    key: "rls-security",
    label: "Supabase RLS & Security Audit",
    aliases: {
      filename: [/rls/i, /security/i],
      title: [/rls/i, /security/i],
      body: [/rls\/policy parity/i, /rls\/policies/i, /security audit/i, /sensitive domain rls/i],
    },
  },
  {
    key: "canonicality",
    label: "Canonicality Sweep",
    aliases: {
      filename: [/canonical/i],
      title: [/canonicality/i, /canonical/i],
      body: [/canonicality risk/i, /canonical resolver/i, /canonical write path/i, /source of truth/i],
    },
  },
  {
    key: "migration-safety",
    label: "Schema Migration Safety Audit",
    aliases: {
      filename: [/migration/i, /schema-compatibility/i],
      title: [/migration safety/i, /schema compatibility/i],
      body: [/migration-safety/i, /schema cache/i, /migration guidance/i, /partially-migrated/i],
    },
  },
  {
    key: "resolver-drift",
    label: "Shared Resolver Drift Check",
    aliases: {
      filename: [/resolver/i],
      title: [/resolver/i],
      body: [/shared resolver/i, /resolver path/i, /read model resolves canonical/i],
    },
  },
  {
    key: "shared-rpc-architecture",
    label: "Shared RPC Architecture Audit",
    aliases: {
      filename: [/shared-rpc/i, /rpc-architecture/i, /rpc/i],
      title: [/shared rpc/i, /rpc architecture/i],
      body: [/canonical rpc \/ transaction boundaries/i, /rpc-backed/i, /shared rpc/i],
    },
  },
  {
    key: "acid-transactionality",
    label: "ACID / Transactionality Audit",
    aliases: {
      filename: [/acid/i, /transaction/i, /workflow-simulation/i],
      title: [/acid/i, /transaction/i, /workflow simulation/i],
      body: [/acid/i, /atomic/i, /transaction-backed/i, /transaction boundary/i],
    },
  },
  {
    key: "idempotency-duplicate-submission",
    label: "Idempotency & Duplicate Submission Audit",
    aliases: {
      filename: [/idempot/i, /duplicate/i],
      title: [/idempot/i, /duplicate/i],
      body: [/idempotency/i, /duplicate/i, /replay-safe/i, /replay safety/i],
    },
  },
  {
    key: "query-performance",
    label: "Query Performance Audit",
    aliases: {
      filename: [/query-performance/i, /performance/i],
      title: [/query performance/i, /performance audit/i],
      body: [/table scan/i, /n\+1/i, /pagination/i, /query performance/i],
    },
  },
  {
    key: "workflow-simulation",
    label: "Workflow Lifecycle Simulation Audit",
    aliases: {
      filename: [/workflow-simulation/i],
      title: [/workflow simulation audit/i],
      body: [/lifecycle handoff table/i, /executive summary/i, /workflow health/i],
    },
  },
  {
    key: "referential-integrity",
    label: "Referential Integrity & Cascade Audit",
    aliases: {
      filename: [/referential-integrity/i, /cascade-audit/i],
      title: [/referential integrity/i, /cascade audit/i],
      body: [/orphan records/i, /missing lifecycle cascades/i, /missing constraints/i],
    },
  },
  {
    key: "schema-compatibility",
    label: "Schema Compatibility Audit",
    aliases: {
      filename: [/schema-compatibility/i, /schema-audit-data/i],
      title: [/schema compatibility audit/i, /schema audit data/i],
      body: [/runtime references/i, /migration-defined schema/i, /mockDependencies/i],
    },
  },
  {
    key: "production-readiness",
    label: "Production Readiness Audit",
    aliases: {
      filename: [/production-readiness/i],
      title: [/production readiness/i, /system map/i],
      body: [/pre-refactor map/i, /full-system inventory/i, /production hardening/i],
    },
  },
];

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

function normalizeSlashes(value: string) {
  return value.replace(/\\/g, "/");
}

function extractMarkdownTitle(text: string): string | null {
  const firstHeading = text.match(/^#\s+(.+)$/m);
  if (firstHeading) {
    return firstHeading[1].trim();
  }

  return null;
}

function extractJsonSummary(text: string): string | null {
  const mockDependenciesMatch = text.match(/"mockDependencies"\s*:\s*\[/);
  if (mockDependenciesMatch) {
    return "Machine-readable schema compatibility inventory";
  }

  return null;
}

function extractDateFromText(text: string): string | null {
  const patterns = [
    /Generated:\s*(\d{4}-\d{2}-\d{2})/i,
    /Generated:\s*(\d{4}-\d{2}-\d{2})T/i,
    /Date:\s*(\d{4}-\d{2}-\d{2})/i,
    /\((\d{4}-\d{2}-\d{2})\)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function getMatchScore(strength: MatchStrength) {
  switch (strength) {
    case "filename":
      return 3;
    case "title":
      return 2;
    case "body":
      return 1;
    default:
      return 0;
  }
}

function detectMatches(fileName: string, title: string | null, text: string): CategoryMatch[] {
  const matches: CategoryMatch[] = [];

  for (const category of categories) {
    let matchedStrength: MatchStrength | null = null;

    if (category.aliases.filename.some((pattern) => pattern.test(fileName))) {
      matchedStrength = "filename";
    } else if (title && category.aliases.title.some((pattern) => pattern.test(title))) {
      matchedStrength = "title";
    } else if (category.aliases.body.some((pattern) => pattern.test(text))) {
      matchedStrength = "body";
    }

    if (!matchedStrength) {
      continue;
    }

    matches.push({
      key: category.key,
      strength: matchedStrength,
      score: getMatchScore(matchedStrength),
    });
  }

  return matches;
}

function compareDatesDescending(left: string | null, right: string | null) {
  if (left && right) {
    return right.localeCompare(left);
  }
  if (left) {
    return -1;
  }
  if (right) {
    return 1;
  }
  return 0;
}

function compareArtifacts(left: AuditArtifact, right: AuditArtifact) {
  const dateComparison = compareDatesDescending(left.parsedDate, right.parsedDate);
  if (dateComparison !== 0) {
    return dateComparison;
  }

  const extensionPriority = extensionRank(left.extension) - extensionRank(right.extension);
  if (extensionPriority !== 0) {
    return extensionPriority;
  }

  const penaltyComparison = penaltyRank(left.fileName) - penaltyRank(right.fileName);
  if (penaltyComparison !== 0) {
    return penaltyComparison;
  }

  return left.relativePath.localeCompare(right.relativePath);
}

function extensionRank(extension: string) {
  if (extension === ".md" || extension === ".markdown" || extension === ".mdx") {
    return 0;
  }
  if (extension === ".json") {
    return 1;
  }
  return 2;
}

function penaltyRank(fileName: string) {
  if (/skill-smoke/i.test(fileName)) {
    return 2;
  }
  if (/current/i.test(fileName)) {
    return 1;
  }
  return 0;
}

function safeRead(fullPath: string) {
  return readFileSync(fullPath, "utf8");
}

function buildArtifacts(): AuditArtifact[] {
  if (!existsSync(auditsDir)) {
    throw new Error(`Audit directory not found: ${auditsDir}`);
  }

  const files = walk(auditsDir)
    .filter((fullPath) => supportedExtensions.has(path.extname(fullPath).toLowerCase()))
    .sort();

  return files.map((fullPath) => {
    const relativePath = normalizeSlashes(path.relative(repoRoot, fullPath));
    const fileName = path.basename(fullPath);
    const extension = path.extname(fullPath).toLowerCase();
    const text = safeRead(fullPath);
    const title = extension === ".json" ? "Schema audit data companion" : extractMarkdownTitle(text);
    const summaryLine = extension === ".json" ? extractJsonSummary(text) : null;
    const parsedDate = fileName.match(/(20\d{2}-\d{2}-\d{2})/)?.[1] ?? extractDateFromText(text);
    const matches = /^fix-prompt-generator-\d{4}-\d{2}-\d{2}\.md$/i.test(fileName)
      ? []
      : detectMatches(fileName, title, text);

    return {
      absolutePath: fullPath,
      relativePath,
      fileName,
      extension,
      title,
      summaryLine,
      text,
      parsedDate: parsedDate ?? null,
      parsedDateLabel: parsedDate ?? "undated",
      matches,
      ignoredReason: /^fix-prompt-generator-\d{4}-\d{2}-\d{2}\.md$/i.test(fileName) ? "generated output artifact" : undefined,
    };
  });
}

function buildCategoryIndex(artifacts: AuditArtifact[]) {
  return Object.fromEntries(
    categories.map((category) => {
      const matches = artifacts
        .filter((artifact) => artifact.matches.some((match) => match.key === category.key))
        .sort((left, right) => {
          const leftMatch = left.matches.find((match) => match.key === category.key)!;
          const rightMatch = right.matches.find((match) => match.key === category.key)!;

          if (leftMatch.score !== rightMatch.score) {
            return rightMatch.score - leftMatch.score;
          }

          return compareArtifacts(left, right);
        });

      return [category.key, matches];
    }),
  ) as Record<CategoryKey, AuditArtifact[]>;
}

function formatCategoryMatch(artifact: AuditArtifact, categoryKey: CategoryKey) {
  const match = artifact.matches.find((entry) => entry.key === categoryKey);
  if (!match) {
    return "";
  }

  return `${artifact.relativePath} (${artifact.parsedDateLabel}, matched by ${match.strength})`;
}

function buildReport(artifacts: AuditArtifact[]) {
  const categoryIndex = buildCategoryIndex(artifacts);
  const sourceArtifacts = artifacts.filter((artifact) => !artifact.ignoredReason);
  const unmatchedArtifacts = sourceArtifacts.filter((artifact) => artifact.matches.length === 0);
  const matchedCategoryCount = categories.filter((category) => categoryIndex[category.key].length > 0).length;

  const lines: string[] = [];

  lines.push("# Fix Prompt Generator Report");
  lines.push(`Generated: ${generatedDate}`);
  lines.push("");
  lines.push("## 1. Normalized Audit Source Inventory");
  lines.push(`- Scanned directory: \`docs/audits\``);
  lines.push(`- Source artifacts scanned: ${sourceArtifacts.length}`);
  lines.push(`- Requested categories matched: ${matchedCategoryCount}/${categories.length}`);
  lines.push("");

  for (const artifact of sourceArtifacts.sort(compareArtifacts)) {
    const matchedLabels =
      artifact.matches.length > 0
        ? artifact.matches
            .map((match) => categories.find((category) => category.key === match.key)?.label ?? match.key)
            .join("; ")
        : "No requested category match";
    lines.push(`- \`${artifact.relativePath}\``);
    lines.push(`  - Date: ${artifact.parsedDateLabel}`);
    lines.push(`  - Title: ${artifact.title ?? "n/a"}`);
    lines.push(`  - Categories: ${matchedLabels}`);
  }

  lines.push("");
  lines.push("## 2. Best Source Per Requested Category");
  lines.push("");

  for (const category of categories) {
    const matches = categoryIndex[category.key];
    if (matches.length === 0) {
      lines.push(`- ${category.label}: no matching artifact found in \`docs/audits\`.`);
      continue;
    }

    const [primary, ...supporting] = matches;
    lines.push(`- ${category.label}: \`${formatCategoryMatch(primary, category.key)}\``);
    if (supporting.length > 0) {
      lines.push(
        `  - Supporting matches: ${supporting
          .slice(0, 4)
          .map((artifact) => `\`${formatCategoryMatch(artifact, category.key)}\``)
          .join(", ")}`,
      );
    }
  }

  lines.push("");
  lines.push("## 3. Unmatched Requested Categories");
  lines.push("");

  const unmatchedCategories = categories.filter((category) => categoryIndex[category.key].length === 0);
  if (unmatchedCategories.length === 0) {
    lines.push("- None.");
  } else {
    for (const category of unmatchedCategories) {
      lines.push(`- ${category.label}`);
    }
  }

  lines.push("");
  lines.push("## 4. Scanned Artifacts Not Matched To Requested Categories");
  lines.push("");

  if (unmatchedArtifacts.length === 0) {
    lines.push("- None.");
  } else {
    for (const artifact of unmatchedArtifacts.sort(compareArtifacts)) {
      lines.push(`- \`${artifact.relativePath}\` (${artifact.parsedDateLabel})`);
    }
  }

  lines.push("");
  lines.push("## 5. Discovery Notes");
  lines.push("");
  lines.push("- Equivalent audit files are matched by filename, heading, and body keywords instead of exact filenames only.");
  lines.push("- The newest matching artifact is selected per category, with markdown preferred over machine-readable companions when dates tie.");
  lines.push("- Prior fix prompt output files are excluded from source discovery so the generator does not treat its own reports as audit inputs.");
  lines.push("- Machine-readable companions such as `supabase-schema-audit-data.json` remain valid source artifacts when they are the only supporting evidence for a category.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function main() {
  const artifacts = buildArtifacts();
  const report = buildReport(artifacts);
  writeFileSync(outputPath, report, "utf8");
  process.stdout.write(`Generated ${normalizeSlashes(path.relative(repoRoot, outputPath))}\n`);
}

main();
