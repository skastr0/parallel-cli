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

const manifest = JSON.parse(readFileSync("dist/npm/publish-manifest.json", "utf8")) as PublishManifest;
const localOverride = process.env.PARALLEL_CLI_ALLOW_LOCAL_NPM_PUBLISH === manifest.version;

if (process.env.GITHUB_ACTIONS !== "true" && !localOverride) {
  console.error(
    [
      "Refusing to publish from a local shell.",
      "Use the protected GitHub Actions release workflow, or set",
      `PARALLEL_CLI_ALLOW_LOCAL_NPM_PUBLISH=${manifest.version} only after explicit approval for this exact version.`,
    ].join("\n"),
  );
  process.exit(1);
}

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

for (const item of manifest.packages) {
  const exact = `${item.name}@${manifest.version}`;
  const existing = await run(["npm", "view", exact, "version", "--prefer-online"]);

  if (existing.exitCode === 0 && existing.stdout.trim() === manifest.version) {
    console.log(`Skipping ${exact}; already published.`);
    continue;
  }

  const packagePath = `./${item.path}`;
  console.log(`Publishing ${exact} from ${packagePath}...`);
  const published = await run(["npm", "publish", packagePath, "--access", "public"]);

  if (published.exitCode !== 0) {
    console.error(published.stderr || published.stdout);
    process.exit(published.exitCode);
  }

  console.log(published.stdout.trim());
}
