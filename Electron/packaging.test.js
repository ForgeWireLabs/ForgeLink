// Installer/packaging tests (PR-013). Static checks on the electron-builder
// manifest so we never ship a packaged module that requires another module the
// installer left out (the class of bug that crashed the first installer when
// attention.js was missing), and never ship test files.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const builder = JSON.parse(fs.readFileSync(path.join(__dirname, "builder.json"), "utf8"));
const files = builder.files || [];
const packagedTopLevelJs = files.filter((f) => /^[^/]+\.js$/.test(f));

function localRequires(source) {
  const out = [];
  const re = /require\(\s*["']\.\/([^"')]+)["']\s*\)/g;
  let m;
  while ((m = re.exec(source))) {
    out.push(m[1].endsWith(".js") ? m[1] : `${m[1]}.js`);
  }
  return out;
}

test("every local module required by a packaged module is itself packaged", () => {
  const missing = [];
  for (const entry of packagedTopLevelJs) {
    const source = fs.readFileSync(path.join(__dirname, entry), "utf8");
    for (const required of localRequires(source)) {
      if (!files.includes(required)) missing.push(`${entry} requires ./${required} which is not in builder.json files`);
    }
  }
  assert.deepEqual(missing, [], missing.join("\n"));
});

test("the package excludes test files", () => {
  assert.equal(files.some((f) => !f.startsWith("!") && /\.test\.js$/.test(f)), false, "a *.test.js file is in the packaged files list");
  assert.ok(files.includes("!backend-dist/**/*.test.js"), "backend-dist test files must be excluded");
});

test("the package ships the renderer bundle, backend, icon, and no source maps", () => {
  assert.ok(files.includes("renderer/app.js"), "renderer bundle must be packaged");
  assert.ok(files.some((f) => f.startsWith("backend-dist/")), "backend-dist must be packaged");
  assert.equal(builder.win && builder.win.icon, "assets/icon.ico");
  assert.equal(files.some((f) => f.endsWith(".map")), false, "source maps must not be packaged");
});

test("if an unpacked build exists, it contains the executable", () => {
  const exe = path.join(__dirname, "dist", "win-unpacked", "ForgeLink.exe");
  if (!fs.existsSync(path.join(__dirname, "dist", "win-unpacked"))) {
    return; // no build present in this environment; the static checks above still ran
  }
  assert.ok(fs.existsSync(exe), "win-unpacked build is missing ForgeLink.exe");
});
