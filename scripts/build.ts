#!/usr/bin/env bun

import { mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const distDir = "dist";
const binaryName = "parallel";

const targets = [
  { platform: "darwin", arch: "x64", compileTarget: "bun-darwin-x64" },
  { platform: "darwin", arch: "arm64", compileTarget: "bun-darwin-arm64" },
  { platform: "linux", arch: "x64", compileTarget: "bun-linux-x64" },
  { platform: "linux", arch: "arm64", compileTarget: "bun-linux-arm64" },
] as const;

console.log("Cleaning dist directory...");
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

console.log(`\nBuilding ${binaryName} v${version}...\n`);

const failures: string[] = [];

for (const { platform, arch, compileTarget } of targets) {
  const outfile = join(distDir, `${binaryName}-${platform}-${arch}`);
  const targetName = `${platform}-${arch}`;

  console.log(`Building ${targetName}...`);

  try {
    const buildResult = await Bun.build({
      target: "bun",
      compile: {
        target: compileTarget,
        outfile,
      },
      entrypoints: ["src/cli.ts"],
      define: {
        APP_VERSION: `'${version}'`,
      },
      minify: true,
    });

    if (!buildResult.success) {
      failures.push(targetName);
      console.error(`  ✗ Failed to build ${targetName}`);
      for (const log of buildResult.logs) {
        console.error(log);
      }
      continue;
    }

    await Bun.$`chmod +x ${outfile}`;
    console.log(`  ✓ ${outfile}`);
  } catch (error) {
    failures.push(targetName);
    console.error(`  ✗ Error building ${targetName}:`, error);
  }
}

if (failures.length > 0) {
  console.error(`\nBuild failed for: ${failures.join(", ")}`);
  process.exit(1);
}

console.log(`
Build complete! Binaries in ${distDir}/

To install locally:
  bun run install:local
`);
