import { Effect } from "effect"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"

import { IdempotencyConflictError, JsonInputError } from "./errors"

interface IdempotencyReceipt {
  readonly key: string
  readonly command: string
  readonly input_hash: string
  readonly created_at: string
  readonly response: unknown
}

const getStateDir = () =>
  Bun.env.PARALLEL_CLI_STATE_DIR ??
  join(Bun.env.HOME ?? process.cwd(), ".parallel-cli", "state")

const resolvePath = (path: string) => (isAbsolute(path) ? path : join(process.cwd(), path))

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`
  }

  return JSON.stringify(value)
}

const hashText = (text: string) => createHash("sha256").update(text).digest("hex")

const receiptPath = (key: string) => {
  const digest = hashText(key)
  return resolvePath(join(getStateDir(), "idempotency", `${digest}.json`))
}

const readReceipt = (key: string) =>
  Effect.tryPromise({
    try: async () => {
      try {
        const text = await readFile(receiptPath(key), "utf8")
        return JSON.parse(text) as IdempotencyReceipt
      } catch (cause) {
        if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") {
          return undefined
        }
        throw cause
      }
    },
    catch: (cause) =>
      new JsonInputError({
        source: receiptPath(key),
        reason: "ReadFailed",
        message: cause instanceof Error ? cause.message : "Failed to read idempotency receipt",
      }),
  })

const writeReceipt = (receipt: IdempotencyReceipt) =>
  Effect.tryPromise({
    try: async () => {
      const path = receiptPath(receipt.key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8")
    },
    catch: (cause) =>
      new JsonInputError({
        source: receiptPath(receipt.key),
        reason: "WriteFailed",
        message: cause instanceof Error ? cause.message : "Failed to write idempotency receipt",
      }),
  })

const attachIdempotency = (data: unknown, status: "stored" | "replayed", key: string) => {
  const idempotency = {
    key,
    status,
    scope: "local_success_receipt",
    retry_behavior:
      "Repeating the same command and payload with this key replays the stored success response on this machine.",
  }

  if (data && typeof data === "object" && !Array.isArray(data)) {
    return {
      ...data,
      idempotency,
    }
  }

  return {
    result: data,
    idempotency,
  }
}

export const withIdempotency = <A, E, R>(
  command: string,
  key: string | undefined,
  input: unknown,
  submit: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    if (!key) {
      return yield* submit
    }

    const inputHash = hashText(stableJson(input))
    const existing = yield* readReceipt(key)

    if (existing) {
      if (existing.command === command && existing.input_hash === inputHash) {
        return attachIdempotency(existing.response, "replayed", key)
      }

      return yield* new IdempotencyConflictError({
        key,
        command,
        message:
          "idempotency key already has a receipt for a different command or payload",
      })
    }

    const response = yield* submit
    yield* writeReceipt({
      key,
      command,
      input_hash: inputHash,
      created_at: new Date().toISOString(),
      response,
    })

    return attachIdempotency(response, "stored", key)
  })

export const idempotencyStateDir = getStateDir
