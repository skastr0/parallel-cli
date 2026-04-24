import { Effect, Schema } from "effect"
import { mkdir, stat, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { isAbsolute, join, relative } from "node:path"

import { ArtifactWriteError } from "./errors"

export const OutputPolicy = Schema.Literal("inline", "artifact", "auto")
export type OutputPolicy = typeof OutputPolicy.Type

const DEFAULT_ARTIFACT_THRESHOLD_BYTES = 16 * 1024

export interface ArtifactRecord {
  readonly key: string
  readonly label: string
  readonly kind: "json"
  readonly absolute_path: string
  readonly relative_path: string
  readonly size_bytes: number
  readonly created_at: string
}

const sanitizeSegment = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "artifact"

export const getArtifactDir = () =>
  Bun.env.PARALLEL_CLI_ARTIFACT_DIR ?? join(process.cwd(), ".parallel-cli", "artifacts")

const resolvePath = (path: string) => (isAbsolute(path) ? path : join(process.cwd(), path))

export const writeJsonArtifact = (command: string, data: unknown) =>
  Effect.gen(function* () {
    const createdAt = new Date().toISOString()
    const commandSegment = sanitizeSegment(command)
    const text = `${JSON.stringify(data, null, 2)}\n`
    const digest = createHash("sha256").update(text).digest("hex").slice(0, 12)
    const dir = resolvePath(join(getArtifactDir(), commandSegment))
    const fileName = `${createdAt.replace(/[:.]/g, "-")}-${digest}.json`
    const absolutePath = join(dir, fileName)

    yield* Effect.tryPromise({
      try: () => mkdir(dir, { recursive: true }),
      catch: (cause) =>
        new ArtifactWriteError({
          path: dir,
          message: cause instanceof Error ? cause.message : "Failed to create artifact directory",
        }),
    })

    yield* Effect.tryPromise({
      try: () => writeFile(absolutePath, text, "utf8"),
      catch: (cause) =>
        new ArtifactWriteError({
          path: absolutePath,
          message: cause instanceof Error ? cause.message : "Failed to write artifact",
        }),
    })

    const fileStat = yield* Effect.tryPromise({
      try: () => stat(absolutePath),
      catch: (cause) =>
        new ArtifactWriteError({
          path: absolutePath,
          message: cause instanceof Error ? cause.message : "Failed to stat artifact",
        }),
    })

    return {
      key: `${commandSegment}.${digest}`,
      label: `${command} JSON artifact`,
      kind: "json",
      absolute_path: absolutePath,
      relative_path: relative(process.cwd(), absolutePath),
      size_bytes: fileStat.size,
      created_at: createdAt,
    } satisfies ArtifactRecord
  })

export const applyOutputPolicy = (
  command: string,
  data: unknown,
  policy: OutputPolicy,
  thresholdBytes = DEFAULT_ARTIFACT_THRESHOLD_BYTES,
) =>
  Effect.gen(function* () {
    const json = JSON.stringify(data, null, 2)
    const sizeBytes = Buffer.byteLength(json, "utf8")
    const shouldWriteArtifact =
      policy === "artifact" || (policy === "auto" && sizeBytes > thresholdBytes)

    if (!shouldWriteArtifact) {
      return data
    }

    const artifact = yield* writeJsonArtifact(command, data)
    return {
      kind: "summary+artifact",
      summary: `Wrote ${sizeBytes} bytes of ${command} output to an artifact.`,
      artifact,
    }
  })
