import { Effect } from "effect"

import {
  API_BASE_URL_ENV,
  API_KEY_ENV,
  API_KEY_HINT,
  DEFAULT_API_BASE_URL,
} from "./constants"
import { ConfigurationError, MissingApiKeyError } from "./errors"

export interface AppConfig {
  readonly apiBaseUrl: string
  readonly apiKey?: string
}

const normalizeBaseUrl = (rawValue: string): Effect.Effect<string, ConfigurationError> =>
  Effect.gen(function* () {
    const trimmed = rawValue.trim()

    if (trimmed.length === 0) {
      return yield* Effect.fail(
        new ConfigurationError({
          field: API_BASE_URL_ENV,
          message: "Base URL cannot be empty",
        }),
      )
    }

    const url = yield* Effect.try({
      try: () => new URL(trimmed),
      catch: () =>
        new ConfigurationError({
          field: API_BASE_URL_ENV,
          message: "Invalid API base URL",
        }),
    })

    return url.toString().replace(/\/+$/, "")
  })

export const loadAppConfig = Effect.fn("loadAppConfig")(function* () {
  const apiBaseUrl = yield* normalizeBaseUrl(
    Bun.env[API_BASE_URL_ENV] ?? DEFAULT_API_BASE_URL,
  )

  const apiKey = Bun.env[API_KEY_ENV]?.trim()

  return {
    apiBaseUrl,
    ...(apiKey && apiKey.length > 0 ? { apiKey } : {}),
  } satisfies AppConfig
})

export const requireApiKey = Effect.fn("requireApiKey")(function* () {
  const config = yield* loadAppConfig()

  if (!config.apiKey) {
    return yield* Effect.fail(
      new MissingApiKeyError({
        envVar: API_KEY_ENV,
        hint: API_KEY_HINT,
      }),
    )
  }

  return config.apiKey
})
