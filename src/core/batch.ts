import { Effect, Either, Schema } from "effect"

import { JsonInputError } from "./errors"
import { loadJsonInput } from "./json"
import { setExitCode, toErrorDetails } from "./output"

export type BatchOutcome = "succeeded" | "partial_failure" | "failed"

export type BatchItemResult<A> =
  | {
      readonly index: number
      readonly ok: true
      readonly target?: unknown
      readonly data: A
    }
  | {
      readonly index: number
      readonly ok: false
      readonly target?: unknown
      readonly error: ReturnType<typeof toErrorDetails>
    }

export interface BatchResult<A> {
  readonly outcome: BatchOutcome
  readonly total: number
  readonly success_count: number
  readonly error_count: number
  readonly concurrency: number
  readonly results: ReadonlyArray<BatchItemResult<A>>
}

const decodeBatchItem = <A, I, R>(schema: Schema.Schema<A, I, R>, value: unknown, index: number) =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError(
      (error) =>
        new JsonInputError({
          source: `items[${index}]`,
          reason: "InvalidJson",
          message: error.message,
        }),
    ),
  )

const batchOutcome = (successCount: number, errorCount: number): BatchOutcome => {
  if (errorCount === 0) {
    return "succeeded"
  }

  if (successCount === 0) {
    return "failed"
  }

  return "partial_failure"
}

export const runJsonInputOrBatch = <A, I, R, B, E, R2>(
  input: string,
  schema: Schema.Schema<A, I, R>,
  handler: (value: A, index?: number) => Effect.Effect<B, E, R2>,
  options: {
    readonly concurrency: number
    readonly target?: (value: A, index: number) => unknown
  },
) =>
  Effect.gen(function* () {
    const value = yield* loadJsonInput(Schema.Unknown, input)

    if (!Array.isArray(value)) {
      const decoded = yield* Schema.decodeUnknown(schema)(value).pipe(
        Effect.mapError(
          (error) =>
            new JsonInputError({
              source: "input",
              reason: "InvalidJson",
              message: error.message,
            }),
        ),
      )

      return yield* handler(decoded)
    }

    const results = yield* Effect.forEach(
      value.map((item, index) => ({ item, index })),
      ({ item, index }) =>
        Effect.gen(function* () {
          const decoded = yield* Effect.either(decodeBatchItem(schema, item, index))

          if (Either.isLeft(decoded)) {
            return {
              index,
              ok: false,
              error: toErrorDetails(decoded.left),
            } satisfies BatchItemResult<B>
          }

          const target = options.target?.(decoded.right, index)
          const itemResult = yield* Effect.either(handler(decoded.right, index))

          if (Either.isLeft(itemResult)) {
            return {
              index,
              ok: false,
              ...(target === undefined ? {} : { target }),
              error: toErrorDetails(itemResult.left),
            } satisfies BatchItemResult<B>
          }

          return {
            index,
            ok: true,
            ...(target === undefined ? {} : { target }),
            data: itemResult.right,
          } satisfies BatchItemResult<B>
        }),
      { concurrency: options.concurrency },
    )

    const successCount = results.filter((result) => result.ok).length
    const errorCount = results.length - successCount

    if (errorCount > 0) {
      yield* setExitCode(1)
    }

    return {
      outcome: batchOutcome(successCount, errorCount),
      total: results.length,
      success_count: successCount,
      error_count: errorCount,
      concurrency: options.concurrency,
      results,
    } satisfies BatchResult<B>
  })
