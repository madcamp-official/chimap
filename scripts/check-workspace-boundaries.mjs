import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

const root = process.cwd();
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const ignoredDirectories = new Set([
  ".git",
  ".expo",
  "android",
  "coverage",
  "dist",
  "ios",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const workspacePackageOwners = new Map([
  ["@chimap/api", "apps/api"],
  ["@chimap/web", "apps/web"],
  ["@chimap/mobile", "apps/mobile"],
  ["@chimap/alert-relay", "apps/alert-relay"],
  ["@chimap/contracts", "packages/contracts"],
  ["@chimap/app-core", "packages/app-core"],
  ["@chimap/design-tokens", "packages/design-tokens"],
]);
const allowedWorkspaceImports = new Map([
  ["apps/api", new Set(["@chimap/contracts"])],
  ["apps/web", new Set(["@chimap/contracts", "@chimap/app-core", "@chimap/design-tokens"])],
  ["apps/mobile", new Set(["@chimap/contracts", "@chimap/app-core", "@chimap/design-tokens"])],
  ["apps/alert-relay", new Set()],
  ["packages/app-core", new Set(["@chimap/contracts"])],
  ["packages/contracts", new Set()],
  ["packages/design-tokens", new Set()],
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await sourceFiles(path)));
    } else if (sourceExtensions.has(extname(entry.name))) {
      results.push(path);
    }
  }
  return results;
}

function workspaceOwner(path) {
  const local = relative(root, path).split(sep);
  return local[0] === "apps" || local[0] === "packages"
    ? `${local[0]}/${local[1]}`
    : null;
}

const importPattern = /(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/gu;
const violations = [];

function workspacePackage(specifier) {
  for (const packageName of workspacePackageOwners.keys()) {
    if (specifier === packageName || specifier.startsWith(`${packageName}/`)) {
      return packageName;
    }
  }
  return null;
}

for (const area of ["apps", "packages"]) {
  for (const file of await sourceFiles(resolve(root, area))) {
    const sourceOwner = workspaceOwner(file);
    const localFile = relative(root, file);
    if (
      /\.(?:ios|android)\.[cm]?[jt]sx?$/u.test(localFile) &&
      !localFile.startsWith(`apps${sep}mobile${sep}src${sep}platform${sep}`)
    ) {
      violations.push(`${localFile} places a platform implementation outside apps/mobile/src/platform`);
    }
    const contents = await readFile(file, "utf8");
    for (const match of contents.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier === undefined) {
        continue;
      }
      if (!specifier.startsWith(".")) {
        const packageName = workspacePackage(specifier);
        const targetOwner =
          packageName === null ? undefined : workspacePackageOwners.get(packageName);
        const allowed = sourceOwner === null ? undefined : allowedWorkspaceImports.get(sourceOwner);
        if (
          targetOwner !== undefined &&
          targetOwner !== sourceOwner &&
          (packageName === null || allowed?.has(packageName) !== true)
        ) {
          violations.push(
            `${localFile} imports ${specifier} across the ${sourceOwner} -> ${targetOwner} boundary`,
          );
        }
        continue;
      }
      const targetOwner = workspaceOwner(resolve(file, "..", specifier));
      if (sourceOwner !== null && targetOwner !== null && sourceOwner !== targetOwner) {
        violations.push(
          `${localFile} imports ${specifier} across the ${sourceOwner} -> ${targetOwner} boundary`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Workspace boundary violations:\n" + violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Workspace boundaries are isolated.");
}
