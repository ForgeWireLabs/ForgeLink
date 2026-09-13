import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tauriRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(tauriRoot, "..");
const electronRoot = join(repoRoot, "Electron");
const runtimeRoot = join(tauriRoot, ".runtime");
const backendDist = join(electronRoot, "backend-dist");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const nodeName = process.platform === "win32" ? "node.exe" : "node";

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
  });
}

run(npmCommand, ["run", "backend:build"], electronRoot);

if (!existsSync(join(backendDist, "index.js"))) {
  throw new Error(`Backend build did not produce ${join(backendDist, "index.js")}`);
}

rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(runtimeRoot, { recursive: true });
cpSync(backendDist, join(runtimeRoot, "backend-dist"), { recursive: true });
cpSync(process.execPath, join(runtimeRoot, nodeName));

const packageJsonPath = join(electronRoot, "package.json");
const lockfilePath = join(electronRoot, "package-lock.json");
cpSync(packageJsonPath, join(runtimeRoot, "package.json"));
cpSync(lockfilePath, join(runtimeRoot, "package-lock.json"));
run(
  npmCommand,
  ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
  runtimeRoot,
);
rmSync(join(runtimeRoot, "package.json"), { force: true });
rmSync(join(runtimeRoot, "package-lock.json"), { force: true });
writeFileSync(join(runtimeRoot, ".gitkeep"), "");

const sourcePackage = JSON.parse(readFileSync(packageJsonPath, "utf8"));
writeFileSync(
  join(runtimeRoot, "manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      appVersion: sourcePackage.version,
      runtime: nodeName,
      backendEntry: "backend-dist/index.js",
      nodeModules: "node_modules",
      contract: "authenticated-loopback-health",
    },
    null,
  )}\n`,
);

console.log(`Prepared Tauri backend runtime at ${runtimeRoot}`);
