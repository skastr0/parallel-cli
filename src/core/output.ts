import * as Cause from "effect/Cause"
import { Effect } from "effect"

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

export const toErrorDetails = (error: unknown): ErrorEnvelope["error"] => {
  if (isTaggedError(error)) {
    switch (error._tag) {
      case "ConfigurationError": {
        return {
          type: error._tag,
          message: error.message,
          details: { field: error.field as string },
        }
      }
      case "MissingApiKeyError": {
        return {
          type: error._tag,
          message: `${error.envVar as string} is not configured`,
          details: {
            env_var: error.envVar as string,
            hint: error.hint as string,
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
          },
        }
      }
      case "CommandInputError": {
        return {
          type: error._tag,
          message: error.message,
          details: { field: error.field as string },
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
          },
        }
      }
      case "ApiResponseError": {
        return {
          type: error._tag,
          message: error.message,
          details: {
            method: error.method as string,
            path: error.path as string,
            status: error.status as number,
            body: error.body,
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

export const executeJsonCommand = <A, E, R>(command: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.flatMap((data) => writeSuccessEnvelope(command, data)),
    Effect.catchAll((error) =>
      setExitCode(1).pipe(Effect.zipRight(writeFailureEnvelope(command, error))),
    ),
  )
