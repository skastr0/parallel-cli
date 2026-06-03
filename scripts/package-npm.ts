#!/usr/bin/env bun

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
import { dirname, join } from "path";

type PackageJson = {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  repository?: unknown;
  homepage?: string;
  bugs?: unknown;
  keywords?: string[];
};

type Target = {
  platform: "darwin" | "linux";
  arch: "x64" | "arm64";
  os: "darwin" | "linux";
  cpu: "x64" | "arm64";
};

type PublishPackage = {
  role: "platform" | "main";
  name: string;
  path: string;
  platform?: Target["platform"];
  arch?: Target["arch"];
};

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;

if (!packageJson.name) {
  console.error("package.json is missing a name.");
  process.exit(1);
}

if (!packageJson.version) {
  console.error("package.json is missing a version.");
  process.exit(1);
}

if (!packageJson.license) {
  console.error("package.json is missing a license.");
  process.exit(1);
}

const packageName = packageJson.name;
const version = packageJson.version;
const commandName = "parallel";
const distDir = "dist";
const npmDir = join(distDir, "npm");
const mainPackageDir = join(npmDir, "parallel-cli");
const binaryName = "parallel";

const targets: readonly Target[] = [
  { platform: "darwin", arch: "x64", os: "darwin", cpu: "x64" },
  { platform: "darwin", arch: "arm64", os: "darwin", cpu: "arm64" },
  { platform: "linux", arch: "x64", os: "linux", cpu: "x64" },
  { platform: "linux", arch: "arm64", os: "linux", cpu: "arm64" },
];

const scopedPlatformName = (rootName: string, platform: Target["platform"], arch: Target["arch"]) => {
  if (!rootName.startsWith("@")) {
    return `${rootName}-${platform}-${arch}`;
  }

  const slashIndex = rootName.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(`Invalid scoped package name: ${rootName}`);
  }

  return `${rootName.slice(0, slashIndex + 1)}${rootName.slice(slashIndex + 1)}-${platform}-${arch}`;
};

const platformPackageDir = (target: Target) =>
  join(npmDir, `parallel-cli-${target.platform}-${target.arch}`);

const writeJson = (path: string, value: unknown) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const copyRequired = (source: string, target: string) => {
  if (!existsSync(source)) {
    console.error(`Missing required file: ${source}`);
    process.exit(1);
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
};

const assertBinary = (path: string) => {
  if (!existsSync(path)) {
    console.error(`Missing binary: ${path}`);
    console.error("Run `bun run build` before packaging npm artifacts.");
    process.exit(1);
  }

  const stats = statSync(path);
  if (!stats.isFile() || stats.size === 0) {
    console.error(`Invalid binary: ${path}`);
    process.exit(1);
  }
};

const launcher = (rootName: string) => {
  const platformPackages = Object.fromEntries(
    targets.map((target) => [
      `${target.os}-${target.cpu}`,
      scopedPlatformName(rootName, target.platform, target.arch),
    ]),
  );

  return `#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { dirname, join } = require("node:path");

const platformPackages = ${JSON.stringify(platformPackages, null, 2)};
const platformKey = process.platform + "-" + process.arch;
const packageName = platformPackages[platformKey];

if (!packageName) {
  console.error("parallel: unsupported platform " + platformKey);
  process.exit(1);
}

let binaryPath;
try {
  const packageJsonPath = require.resolve(packageName + "/package.json", {
    paths: [__dirname, process.cwd()],
  });
  binaryPath = join(dirname(packageJsonPath), "bin", "parallel");
} catch {
  console.error("parallel: missing optional platform package " + packageName);
  console.error("parallel: reinstall ${rootName} with optional dependencies enabled.");
  process.exit(1);
}

if (!existsSync(binaryPath)) {
  console.error("parallel: platform package did not contain bin/parallel.");
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });

if (result.error) {
  console.error("parallel: failed to start binary: " + result.error.message);
  process.exit(1);
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(result.status === null ? 1 : result.status);
`;
};

rmSync(npmDir, { recursive: true, force: true });
mkdirSync(npmDir, { recursive: true });

const optionalDependencies: Record<string, string> = {};
const publishPackages: PublishPackage[] = [];

for (const target of targets) {
  const sourceBinary = join(distDir, `${binaryName}-${target.platform}-${target.arch}`);
  assertBinary(sourceBinary);

  const packagePath = platformPackageDir(target);
  const platformPackageName = scopedPlatformName(packageName, target.platform, target.arch);
  optionalDependencies[platformPackageName] = version;

  mkdirSync(join(packagePath, "bin"), { recursive: true });
  copyFileSync(sourceBinary, join(packagePath, "bin", binaryName));
  chmodSync(join(packagePath, "bin", binaryName), 0o755);
  copyRequired("LICENSE", join(packagePath, "LICENSE"));

  writeFileSync(
    join(packagePath, "README.md"),
    [
      `# ${platformPackageName}`,
      "",
      `Platform binary package for \`${packageName}\` on ${target.platform}/${target.arch}.`,
      "",
      "This package is installed as an optional dependency by the main CLI package.",
      "Install the main package instead:",
      "",
      "```bash",
      `npm install -g ${packageName}`,
      "```",
      "",
    ].join("\n"),
  );

  writeJson(join(packagePath, "package.json"), {
    name: platformPackageName,
    version,
    description: `${packageJson.description ?? "parallel-cli"} binary for ${target.platform}/${target.arch}.`,
    license: packageJson.license,
    repository: packageJson.repository,
    homepage: packageJson.homepage,
    bugs: packageJson.bugs,
    os: [target.os],
    cpu: [target.cpu],
    files: ["bin/parallel", "README.md", "LICENSE"],
    publishConfig: {
      access: "public",
    },
  });

  publishPackages.push({
    role: "platform",
    name: platformPackageName,
    path: packagePath,
    platform: target.platform,
    arch: target.arch,
  });
}

mkdirSync(join(mainPackageDir, "bin"), { recursive: true });
copyRequired("README.md", join(mainPackageDir, "README.md"));
copyRequired("LICENSE", join(mainPackageDir, "LICENSE"));
copyRequired("CHANGELOG.md", join(mainPackageDir, "CHANGELOG.md"));
writeFileSync(join(mainPackageDir, "bin", "parallel.js"), launcher(packageName));
chmodSync(join(mainPackageDir, "bin", "parallel.js"), 0o755);

writeJson(join(mainPackageDir, "package.json"), {
  name: packageName,
  version,
  description: packageJson.description,
  keywords: packageJson.keywords,
  license: packageJson.license,
  repository: packageJson.repository,
  homepage: packageJson.homepage,
  bugs: packageJson.bugs,
  type: "commonjs",
  bin: {
    [commandName]: "bin/parallel.js",
  },
  files: ["bin/parallel.js", "README.md", "CHANGELOG.md", "LICENSE"],
  optionalDependencies,
  engines: {
    node: ">=18",
  },
  publishConfig: {
    access: "public",
  },
});

publishPackages.push({
  role: "main",
  name: packageName,
  path: mainPackageDir,
});

writeJson(join(npmDir, "publish-manifest.json"), {
  schema: "parallel-cli/npm-publish-manifest/v1",
  version,
  command: commandName,
  packages: publishPackages,
});

console.log(`Prepared npm packages in ${npmDir}:`);
for (const item of publishPackages) {
  console.log(`  ${item.name} -> ${item.path}`);
}
