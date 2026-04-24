#!/usr/bin/env bun

import { cpSync, mkdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const packageJson = JSON.parse(await Bun.file("package.json").text());
const version = packageJson.version;
const binaryName = "parallel-cli";
const distDir = "dist";

const platform = process.platform;
const arch = process.arch === "arm64" ? "arm64" : "x64";

const sourceBinary = join(distDir, `${binaryName}-${platform}-${arch}`);

const targetDir = process.env.INSTALL_DIR ?? join(homedir(), ".local", "bin");
const targetBinary = join(targetDir, binaryName);

try {
  statSync(sourceBinary);
} catch {
  console.error(`Binary not found: ${sourceBinary}`);
  console.error("Run `bun run build` first.");
  process.exit(1);
}

try {
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceBinary, targetBinary, { force: true });
  console.log(`Installed ${binaryName} v${version} to ${targetBinary}`);
} catch (error) {
  console.error(`Failed to install: ${error}`);
  process.exit(1);
}
