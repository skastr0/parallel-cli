import * as Cause from "effect/Cause"
import { Effect } from "effect"

import { applyOutputPolicy, type OutputPolicy } from "./artifacts"
import { ARTIFACT_DIR_ENV, CLI_HOME_ENV } from "./runtime-paths"

interface SuccessEnvelope {
  readonly ok: true
  readonly command: string
  readonly data: unknown
}

export interface ErrorEnvelope {
  readonly ok: false
  readonly command?: string
  readonly error: {
    readonly type: string
    readonly message: string
    readonly details?: unknown
  }
}

const writeLine = (stream: NodeJS.WriteStream, text: string) =>
  Effect.sync(() => {
    stream.write(`${text}\n`)
  })

export const setExitCode = (exitCode: number) =>
  Effect.sync(() => {
    process.exitCode = exitCode
  })

const isTaggedError = (
  error: unknown,
): error is Error & { _tag: string; message: string; [key: string]: unknown } =>
  error instanceof Error &&
  "_tag" in error &&
  typeof (error as Record<string, unknown>)._tag === "string"

const retryableHttpStatus = (status: number) =>
  status === 408 || status === 409 || status === 425 || status === 429 || status >= 500

const redactSecrets = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactSecrets)
  }

  if (!value || typeof value !== "object") {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => {
      const normalized = key.toLowerCase()
      const shouldRedact =
        normalized.includes("api_key") ||
        normalized.includes("x-api-key") ||
        normalized.includes("authorization") ||
        normalized.includes("password") ||
        normalized.includes("secret") ||
        normalized === "token" ||
        normalized.endsWith("_token")

      return [key, shouldRedact ? "[REDACTED]" : redactSecrets(nested)]
    }),
  )
}

export const toErrorDetails = (error: unknown): ErrorEnvelope["error"] => {
  if (isTaggedError(error)) {
    switch (error._tag) {
      case "ConfigurationError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            field: error.field as string,
            hint: "Set a valid configuration value and rerun the command.",
            retryable: false,
          },
        }
      }
      case "MissingApiKeyError": {
        return {
          type: error._tag,
          message: `${error.envVar as string} is not configured`,
          details: {
            env_var: error.envVar as string,
            hint: error.hint as string,
            next_step: `Export ${error.envVar as string} and rerun the command.`,
            retryable: false,
          },
        }
      }
      case "JsonInputError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            source: error.source as string,
            reason: error.reason as string,
            hint: "Provide a JSON object, JSON array, @file path, or - for stdin.",
            retryable: false,
          },
        }
      }
      case "CommandInputError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            field: error.field as string,
            hint: "Fix the command input and rerun the command.",
            retryable: false,
          },
        }
      }
      case "IdempotencyConflictError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            key: error.key as string,
            command: error.command as string,
            hint: "Use the same payload for this idempotency key, or choose a new key.",
            retryable: false,
          },
        }
      }
      case "ArtifactWriteError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            path: error.path as string,
            hint: `Check artifact directory permissions or set ${ARTIFACT_DIR_ENV} / ${CLI_HOME_ENV}.`,
            retryable: true,
          },
        }
      }
      case "ApiRequestError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            method: error.method as string,
            path: error.path as string,
            reason: error.reason as string,
            provider_request: {
              method: error.method as string,
              path: error.path as string,
            },
            hint: "Retry after checking network connectivity and the configured API base URL.",
            retryable: true,
          },
        }
      }
      case "ApiResponseError": {
        const status = error.status as number
        return {
          type: error._tag,
          message: error.message,
          details: {
            method: error.method as string,
            path: error.path as string,
            status,
            provider_request: {
              method: error.method as string,
              path: error.path as string,
              status,
            },
            body: redactSecrets(error.body),
            hint: retryableHttpStatus(status)
              ? "Retry with backoff or lower concurrency if the provider is rate limiting."
              : "Check the request payload, credentials, billing, or provider resource id.",
            retryable: retryableHttpStatus(status),
          },
        }
      }
      case "ApiDecodeError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            method: error.method as string,
            path: error.path as string,
            provider_request: {
              method: error.method as string,
              path: error.path as string,
            },
            hint: "The provider response did not match the CLI schema; upgrade the CLI or report the response shape.",
            retryable: false,
          },
        }
      }
    }
  }

  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      message: error.message,
    }
  }

  return {
    type: "Error",
    message: String(error),
  }
}

export const renderSuccessEnvelope = (command: string, data: unknown) =>
  JSON.stringify(
    {
      ok: true,
      command,
      data,
    } satisfies SuccessEnvelope,
    null,
    2,
  )

export const renderFailureEnvelope = (command: string | undefined, error: unknown) =>
  JSON.stringify(
    {
      ok: false,
      ...(command ? { command } : {}),
      error: toErrorDetails(error),
    } satisfies ErrorEnvelope,
    null,
    2,
  )

export const writeSuccessEnvelope = (command: string, data: unknown) =>
  writeLine(process.stdout, renderSuccessEnvelope(command, data))

export const writeFailureEnvelope = (command: string | undefined, error: unknown) =>
  writeLine(process.stderr, renderFailureEnvelope(command, error))

export const writeCauseEnvelope = (command: string | undefined, cause: Cause.Cause<unknown>) =>
  writeLine(
    process.stderr,
    JSON.stringify(
      {
        ok: false,
        ...(command ? { command } : {}),
        error: {
          type: "UnexpectedError",
          message: Cause.pretty(cause),
        },
      } satisfies ErrorEnvelope,
      null,
      2,
    ),
  )

export const executeJsonCommand = <A, E, R>(
  command: string,
  effect: Effect.Effect<A, E, R>,
  options?: {
    readonly outputPolicy?: OutputPolicy
  },
) =>
  effect.pipe(
    Effect.flatMap((data) =>
      applyOutputPolicy(command, data, options?.outputPolicy ?? "inline"),
    ),
    Effect.flatMap((data) => writeSuccessEnvelope(command, data)),
    Effect.catchAll((error) =>
      setExitCode(1).pipe(Effect.zipRight(writeFailureEnvelope(command, error))),
    ),
  )
