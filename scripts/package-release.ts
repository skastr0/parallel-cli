#!/usr/bin/env bun

import { createHash } from "crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, join } from "path";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  version?: string;
};

if (!packageJson.version) {
  console.error("package.json is missing a version.");
  process.exit(1);
}

const version = packageJson.version;
const projectName = "parallel-cli";
const binaryName = "parallel";
const distDir = "dist";
const releaseDir = join(distDir, "release");
const targets = [
  { platform: "darwin", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
];

const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

const checksumLines: string[] = [];

for (const { platform, arch } of targets) {
  const sourceBinary = join(distDir, `${binaryName}-${platform}-${arch}`);
  const assetName = `${projectName}-v${version}-${platform}-${arch}`;
  const assetDir = join(releaseDir, assetName);
  const archivePath = join(releaseDir, `${assetName}.tar.gz`);

  if (!existsSync(sourceBinary)) {
    console.error(`Missing binary: ${sourceBinary}`);
    console.error("Run `bun run build` before packaging release assets.");
    process.exit(1);
  }

  const sourceStats = statSync(sourceBinary);
  if (!sourceStats.isFile() || sourceStats.size === 0) {
    console.error(`Invalid binary: ${sourceBinary}`);
    process.exit(1);
  }

  mkdirSync(assetDir, { recursive: true });
  copyFileSync(sourceBinary, join(assetDir, binaryName));
  copyFileSync("LICENSE", join(assetDir, "LICENSE"));
  chmodSync(join(assetDir, binaryName), 0o755);

  writeFileSync(
    join(assetDir, "README.txt"),
    [
      `${projectName} ${version}`,
      "",
      `Install the ${binaryName} executable somewhere on your PATH.`,
      "Verify the archive with SHA256SUMS before installing.",
      "",
    ].join("\n"),
  );

  await Bun.$`tar -czf ${archivePath} -C ${releaseDir} ${assetName}`;
  checksumLines.push(`${sha256(archivePath)}  ${basename(archivePath)}`);
  rmSync(assetDir, { recursive: true, force: true });

  console.log(`Packaged ${archivePath}`);
}

writeFileSync(join(releaseDir, "SHA256SUMS"), `${checksumLines.join("\n")}\n`);
console.log(`Wrote ${join(releaseDir, "SHA256SUMS")}`);
