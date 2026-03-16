const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const TARGET_DIRS = [
  "lib/services",
  "lib/email/templates",
  "lib/supabase",
  "types"
];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function detectReasons(file, text) {
  const reasons = [];
  if (text.includes("pdf-lib") || text.includes("PDFDocument")) {
    reasons.push("pdf/document helper import");
  }
  if (text.includes("ENROLLMENT_PACKET_LEGAL_TEXT") || /`[^`]{350,}`/.test(text)) {
    reasons.push("giant string literal");
  }
  if (/(schema|mapping|config|constants)/i.test(file) && text.includes("export const")) {
    reasons.push("large static mapping/schema payload");
  }
  if ((text.match(/^import\s/mg) || []).length >= 10 && file.includes(`${path.sep}services${path.sep}`)) {
    reasons.push("multi-concern service module");
  }
  return reasons.length > 0 ? reasons : ["general module size"];
}

const results = TARGET_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)))
  .map((fullPath) => {
    const text = fs.readFileSync(fullPath, "utf8");
    const relativePath = path.relative(ROOT, fullPath).replaceAll("\\", "/");
    return {
      file: relativePath,
      bytes: Buffer.byteLength(text),
      lines: text.split(/\r?\n/).length,
      reasons: detectReasons(relativePath, text)
    };
  })
  .sort((left, right) => right.bytes - left.bytes)
  .slice(0, 30);

console.log("Top source-size offenders");
for (const result of results) {
  console.log(
    `${String(result.bytes).padStart(7)} bytes  ${result.file}  [${result.reasons.join(", ")}]`
  );
}
