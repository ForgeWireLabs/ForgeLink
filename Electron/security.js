// Secret scanner (PR-011). Scans git-tracked files for committed secrets and
// exits non-zero if any are found, so credentials never reach history (INV-4).
// `scanText` is pure and unit-tested; the CLI scans the whole repo via git.

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const RULES = [
  { id: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "slack-token", re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: "twilio-auth-token", re: /TWILIO_AUTH_TOKEN\s*[:=]\s*['"]?[0-9a-f]{32}['"]?/i },
  { id: "generic-secret-assignment", re: /(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\s*[:=]\s*['"][A-Za-z0-9/_+=.-]{24,}['"]/i }
];

// Paths excluded from scanning: build output, deps, binaries, lockfiles, and
// test/fixture files (which legitimately contain fake secrets), plus the scanner.
const EXCLUDE = /(^|\/)(node_modules|dist|backend-dist|\.git)\/|\.map$|package-lock\.json|\.(png|ico|svg|jpg|jpeg|gif|woff2?|ttf|asar|exe|blockmap)$|(^|\/)security\.(js|test\.js)$|\.test\.(js|ts|tsx)$|(^|\/)tests?\//i;

function scanText(name, content) {
  const findings = [];
  content.split(/\r?\n/).forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.re.test(line)) findings.push({ file: name.replace(/\\/g, "/"), line: index + 1, rule: rule.id });
    }
  });
  return findings;
}

// Scan the given repo-relative paths under root (applies EXCLUDE, skips binary).
function scanFiles(root, relPaths) {
  const findings = [];
  for (const rel of relPaths) {
    const norm = rel.replace(/\\/g, "/");
    if (EXCLUDE.test(norm)) continue;
    let buffer;
    try { buffer = fs.readFileSync(path.join(root, rel)); } catch { continue; }
    if (buffer.includes(0)) continue; // binary file (contains a zero byte)
    findings.push(...scanText(norm, buffer.toString("utf8")));
  }
  return findings;
}

function listTracked(root) {
  return execSync("git ls-files", { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
}

function main() {
  const root = path.resolve(__dirname, "..");
  const findings = scanFiles(root, listTracked(root));
  if (findings.length) {
    console.error("Secret scan found " + findings.length + " potential secret(s):");
    for (const f of findings) console.error("  " + f.file + ":" + f.line + " [" + f.rule + "]");
    process.exit(1);
  }
  console.log("Secret scan: clean.");
}

if (require.main === module) main();

module.exports = { scanText, scanFiles, listTracked, RULES };
