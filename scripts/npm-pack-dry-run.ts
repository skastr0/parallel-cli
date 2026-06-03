#!/usr/bin/env bun

import { readFileSync } from "fs";

type PublishManifest = {
  schema: "parallel-cli/npm-publish-manifest/v1";
  version: string;
  packages: ReadonlyArray<{
    role: "platform" | "main";
    name: string;
    path: string;
  }>;
};

type PackFile = {
  path: string;
  size: number;
};

type PackResult = {
  name: string;
  version: string;
  filename: string;
  files: PackFile[];
};

const manifest = JSON.parse(readFileSync("dist/npm/publish-manifest.json", "utf8")) as PublishManifest;

const readStream = async (stream: ReadableStream<Uint8Array> | null) =>
  stream ? await new Response(stream).text() : "";

const run = async (args: string[]) => {
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
};

const summaries: Array<{
  name: string;
  version: string;
  filename: string;
  file_count: number;
  files: string[];
}> = [];

for (const item of manifest.packages) {
  const packagePath = `./${item.path}`;
  const result = await run(["npm", "pack", "--dry-run", "--json", packagePath]);

  if (result.exitCode !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.exitCode);
  }

  let packed: PackResult[];
  try {
    packed = JSON.parse(result.stdout) as PackResult[];
  } catch {
    console.error(`Failed to parse npm pack output for ${item.name}.`);
    console.error(result.stdout);
    process.exit(1);
  }

  const pack = packed[0];
  if (!pack) {
    console.error(`npm pack returned no package for ${item.name}.`);
    process.exit(1);
  }

  summaries.push({
    name: pack.name,
    version: pack.version,
    filename: pack.filename,
    file_count: pack.files.length,
    files: pack.files.map((file) => file.path).sort(),
  });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      schema: "parallel-cli/npm-pack-dry-run/v1",
      version: manifest.version,
      packages: summaries,
    },
    null,
    2,
  ),
);
