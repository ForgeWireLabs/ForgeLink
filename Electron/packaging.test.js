// Installer/packaging tests (PR-013/PR-014). The builder.json files config is an
// "include everything, then exclude non-runtime" allowlist so production
// node_modules (electron-updater) are bundled. These tests guard that required
// runtime modules are never excluded and that a real build ships the right
// contents (no source, no tests) with electron-updater present.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const builder = JSON.parse(fs.readFileSync(path.join(__dirname, "builder.json"), "utf8"));
const files = builder.files || [];

function localRequires(source) {
  const out = [];
  const re = /require\(\s*["']\.\/([^"')]+)["']\s*\)/g;
  let m;
  while ((m = re.exec(source))) out.push(m[1].endsWith(".js") ? m[1] : `${m[1]}.js`);
  return out;
}

// Minimal matcher for the negation patterns this project uses.
function excludedBy(rel, files) {
  return files.some((p) => {
    if (!p.startsWith("!")) return false;
    const pat = p.slice(1);
    if (pat === rel) return true;
    if (pat.startsWith("**/*.")) return rel.endsWith(pat.slice(3)); // **/*.ts, **/*.test.js
    if (pat.endsWith("/**")) { const dir = pat.slice(0, -3); return rel === dir || rel.startsWith(`${dir}/`); }
    if (pat.startsWith("**/")) return rel.split("/").pop() === pat.slice(3) || rel.endsWith(`/${pat.slice(3)}`);
    return false;
  });
}

test("files starts from **/* so production node_modules are bundled, and excludes non-runtime", () => {
  assert.ok(files.includes("**/*"), "files must include **/* (otherwise prod node_modules are filtered out of the asar)");
  assert.ok(files.includes("!**/*.test.js"), "test files must be excluded");
  assert.ok(files.includes("!**/*.map"), "source maps must be excluded");
});

test("no required runtime module is excluded by a negation pattern", () => {
  const required = new Set(["main.js", "preload.js", "onboarding.js", "attention.js", "tunnel.js", "lifecycle.js", "updates.js"]);
  for (const m of [...required]) {
    for (const r of localRequires(fs.readFileSync(path.join(__dirname, m), "utf8"))) required.add(r);
  }
  const bad = [...required].filter((m) => excludedBy(m, files));
  assert.deepEqual(bad, [], `these required modules would be excluded: ${bad.join(", ")}`);
});

test("win icon is configured", () => {
  assert.equal(builder.win && builder.win.icon, "assets/icon.ico");
});

test("backend utility process is unpacked for packaged launches", () => {
  assert.ok(
    (builder.asarUnpack || []).includes("backend-dist/**"),
    "backend-dist must be unpacked because utilityProcess.fork cannot launch the backend entry from app.asar"
  );
  const mainSource = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  assert.match(mainSource, /app\.asar\.unpacked/);
});

test("if a build exists, the asar bundles electron-updater and app modules with no source or tests", () => {
  const asarPath = path.join(__dirname, "dist", "win-unpacked", "resources", "app.asar");
  if (!fs.existsSync(asarPath)) return; // no build in this environment
  let asar;
  try { asar = require("@electron/asar"); } catch { return; } // tool not resolvable here
  const entries = asar.listPackage(asarPath).map((e) => e.replace(/\\/g, "/"));
  assert.ok(entries.some((e) => e.includes("node_modules/electron-updater/package.json")), "electron-updater must be bundled");
  assert.ok(entries.some((e) => e === "/main.js" || e.endsWith("/main.js")), "main.js must be bundled");
  assert.ok(
    fs.existsSync(path.join(__dirname, "dist", "win-unpacked", "resources", "app.asar.unpacked", "backend-dist", "index.js")),
    "backend utility process entry must exist outside the asar"
  );
  assert.equal(entries.some((e) => e.endsWith(".test.js")), false, "no test files in the asar");
  assert.equal(entries.some((e) => e.includes("/backend/src/")), false, "no backend source in the asar");
});
