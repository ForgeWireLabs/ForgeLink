// Release preflight (work item 011, PR-014).
//
// Automates the non-signing verifications from docs/release-checklist.md so a
// release is reproducible and a misconfiguration is caught before the build. The
// signing/notarization and update-feed-publish steps remain operator/cert-gated and
// are intentionally NOT checked here — this gate covers everything that can be
// verified without a code-signing certificate.

const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const electronDir = join(__dirname, "..");
const repoRoot = join(electronDir, "..");

function runReleasePreflight() {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

  // Version metadata is in sync (VERSION and package.json drive the dashboard and
  // diagnostics).
  let version = "";
  try {
    version = readFileSync(join(repoRoot, "VERSION"), "utf8").trim();
    const pkg = JSON.parse(readFileSync(join(electronDir, "package.json"), "utf8"));
    add("version sync", Boolean(version) && pkg.version === version, `VERSION=${version || "<missing>"} package.json=${pkg.version}`);
    add("electron-updater dependency", Boolean(pkg.dependencies && pkg.dependencies["electron-updater"]), pkg.dependencies && pkg.dependencies["electron-updater"] ? pkg.dependencies["electron-updater"] : "missing");
  } catch (error) {
    add("version metadata", false, error instanceof Error ? error.message : String(error));
  }

  // Release notes: an [Unreleased] section exists (moved under the version heading
  // at release time per the checklist).
  try {
    const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");
    add("CHANGELOG [Unreleased]", changelog.includes("## [Unreleased]"), "release notes source present");
  } catch (error) {
    add("CHANGELOG", false, error instanceof Error ? error.message : String(error));
  }

  // builder.json sanity: publish provider, asar-unpacked backend, packaged files,
  // and that every referenced icon exists on disk.
  try {
    const builder = JSON.parse(readFileSync(join(electronDir, "builder.json"), "utf8"));
    add("publish provider", Boolean(builder.publish && builder.publish.provider), builder.publish ? builder.publish.provider : "missing");
    add("backend asarUnpack", Array.isArray(builder.asarUnpack) && builder.asarUnpack.some((entry) => entry.includes("backend-dist")), JSON.stringify(builder.asarUnpack || []));
    add("packaged files config", Array.isArray(builder.files) && builder.files.includes("**/*"), "files glob present");
    const iconRefs = [builder.win && builder.win.icon, builder.linux && builder.linux.icon, builder.nsis && builder.nsis.installerIcon, builder.nsis && builder.nsis.uninstallerIcon, builder.nsis && builder.nsis.installerHeaderIcon].filter(Boolean);
    const missingIcons = [...new Set(iconRefs)].filter((ref) => !existsSync(join(electronDir, ref)));
    add("icon assets exist", missingIcons.length === 0, missingIcons.length ? `missing: ${missingIcons.join(", ")}` : `${[...new Set(iconRefs)].length} icon path(s) ok`);
  } catch (error) {
    add("builder.json", false, error instanceof Error ? error.message : String(error));
  }

  // updates.js guard is present (auto-update only in a packaged build, with opt-out).
  try {
    const updates = readFileSync(join(electronDir, "updates.js"), "utf8");
    add("auto-update guard", updates.includes("shouldAutoUpdate") && updates.includes("isPackaged"), "shouldAutoUpdate present");
  } catch (error) {
    add("updates.js", false, error instanceof Error ? error.message : String(error));
  }

  const ok = checks.every((check) => check.ok);
  return { ok, version, checks };
}

module.exports = { runReleasePreflight };

if (require.main === module) {
  const result = runReleasePreflight();
  console.log(`ForgeLink release preflight (PR-014) — version ${result.version || "<unknown>"}\n`);
  for (const check of result.checks) console.log(`  [${check.ok ? "ok" : "FAIL"}] ${check.name}: ${check.detail}`);
  console.log("\nCert-gated steps (not checked here): code-signing/notarization and publishing the latest.yml auto-update feed. See docs/release-checklist.md.");
  console.log(`\n${result.ok ? "Preflight passed." : "Preflight FAILED."}`);
  process.exitCode = result.ok ? 0 : 1;
}
