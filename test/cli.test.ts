import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createServer } from "node:http"

import { MissingApiKeyError } from "../src/core/errors"
import { toErrorDetails } from "../src/core/output"
import { expectJson, runCli } from "./helpers/cli"

interface RecordedRequest {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: unknown
}

const withMockServer = <A>(
  handler: (request: RecordedRequest) => { readonly status?: number; readonly body: unknown },
  run: (baseUrl: string, requests: ReadonlyArray<RecordedRequest>) => Effect.Effect<A>,
) =>
  Effect.async<A>((resume) => {
    const requests: RecordedRequest[] = []
    const server = createServer((request, response) => {
      let body = ""
      request.on("data", (chunk) => {
        body += chunk
      })
      request.on("end", () => {
        const recorded = {
          method: request.method ?? "GET",
          url: request.url ?? "/",
          headers: request.headers,
          body: body.trim().length > 0 ? JSON.parse(body) : undefined,
        } satisfies RecordedRequest
        requests.push(recorded)

        const result = handler(recorded)
        response.statusCode = result.status ?? 200
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify(result.body))
      })
    })

    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        resume(Effect.die("mock server did not bind to a TCP port"))
        return
      }

      run(`http://127.0.0.1:${address.port}`, requests).pipe(
        Effect.ensuring(Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())))),
        Effect.matchEffect({
          onFailure: (error) => Effect.sync(() => resume(Effect.fail(error))),
          onSuccess: (value) => Effect.sync(() => resume(Effect.succeed(value))),
        }),
        Effect.runFork,
      )
    })
  })

describe("parallel CLI", () => {
  it.effect("auth status reports missing API key without failing", () =>
    Effect.gen(function* () {
      const result = yield* runCli(["auth", "status"], {
        PARALLEL_API_KEY: undefined,
        PARALLEL_API_BASE_URL: undefined,
      })

      const payload = expectJson<{
        ok: boolean
        command: string
        data: { configured: boolean; authenticated: boolean; api_base_url: string }
      }>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(result.stderr.trim()).toBe("")
      expect(payload.ok).toBe(true)
      expect(payload.command).toBe("auth status")
      expect(payload.data.configured).toBe(false)
      expect(payload.data.authenticated).toBe(false)
      expect(payload.data.api_base_url).toBe("https://api.parallel.ai")
    }),
  )

  it.effect("search posts JSON and returns a deterministic envelope", () =>
    withMockServer(
      (request) => {
        expect(request.method).toBe("POST")
        expect(request.url).toBe("/v1beta/search")
        expect(request.headers["x-api-key"]).toBe("test-key")
        expect(request.headers["parallel-beta"]).toBe("search-extract-2025-10-10")
        expect(request.body).toEqual({
          objective: "find docs",
          mode: "agentic",
          max_results: 3,
        })

        return {
          body: {
            search_id: "search_1",
            results: [{ url: "https://example.com", title: "Example", excerpts: ["A"] }],
          },
        }
      },
      (baseUrl) =>
        Effect.gen(function* () {
          const result = yield* runCli(
            ["search", '{"objective":"find docs","mode":"agentic","max_results":3}'],
            {
              PARALLEL_API_KEY: "test-key",
              PARALLEL_API_BASE_URL: baseUrl,
            },
          )
          const payload = expectJson<{
            ok: boolean
            command: string
            data: { search_id: string; result_count: number }
          }>(result.stdout)

          expect(result.exitCode).toBe(0)
          expect(result.stderr.trim()).toBe("")
          expect(payload.command).toBe("search")
          expect(payload.data.search_id).toBe("search_1")
          expect(payload.data.result_count).toBe(1)
        }),
    ),
  )

  it.effect("deep-research check reports in-progress tasks as structured data", () =>
    withMockServer(
      (request) => {
        expect(request.method).toBe("GET")
        expect(request.url).toBe("/v1/tasks/runs/run_1")
        return {
          body: {
            run_id: "run_1",
            status: "running",
            is_active: true,
            processor: "base",
            created_at: "2026-04-24T00:00:00.000Z",
            modified_at: "2026-04-24T00:00:01.000Z",
          },
        }
      },
      (baseUrl) =>
        Effect.gen(function* () {
          const result = yield* runCli(["deep-research", "check", '{"run_id":"run_1"}'], {
            PARALLEL_API_KEY: "test-key",
            PARALLEL_API_BASE_URL: baseUrl,
          })
          const payload = expectJson<{
            ok: boolean
            command: string
            data: { completed: boolean; status: string; next_action: string }
          }>(result.stdout)

          expect(result.exitCode).toBe(0)
          expect(payload.command).toBe("deep-research check")
          expect(payload.data.completed).toBe(false)
          expect(payload.data.status).toBe("running")
          expect(payload.data.next_action).toBe("deep-research check")
        }),
    ),
  )

  it.effect("findall check fetches result after completed status", () =>
    withMockServer(
      (request) => {
        if (request.url === "/v1beta/findall/runs/fa_1") {
          return {
            body: {
              findall_id: "fa_1",
              status: {
                status: "completed",
                is_active: false,
                metrics: {
                  generated_candidates_count: 2,
                  matched_candidates_count: 1,
                },
              },
              generator: "core",
              created_at: "2026-04-24T00:00:00.000Z",
              modified_at: "2026-04-24T00:00:01.000Z",
            },
          }
        }

        expect(request.url).toBe("/v1beta/findall/runs/fa_1/result")
        return {
          body: {
            findall_id: "fa_1",
            status: {
              status: "completed",
              is_active: false,
              metrics: {
                generated_candidates_count: 2,
                matched_candidates_count: 1,
              },
            },
            candidates: [
              {
                candidate_id: "cand_1",
                name: "Acme",
                url: "https://acme.example",
                description: "Example company",
                match_status: "matched",
                output: { market: { value: "AI", type: "match_condition", is_matched: true } },
                basis: [],
              },
            ],
          },
        }
      },
      (baseUrl, requests) =>
        Effect.gen(function* () {
          const result = yield* runCli(["findall", "check", '{"findall_id":"fa_1"}'], {
            PARALLEL_API_KEY: "test-key",
            PARALLEL_API_BASE_URL: baseUrl,
          })
          const payload = expectJson<{
            ok: boolean
            data: { completed: boolean; total_matched: number; candidates: unknown[] }
          }>(result.stdout)

          expect(result.exitCode).toBe(0)
          expect(payload.data.completed).toBe(true)
          expect(payload.data.total_matched).toBe(1)
          expect(payload.data.candidates.length).toBe(1)
          expect(requests.map((request) => request.url)).toEqual([
            "/v1beta/findall/runs/fa_1",
            "/v1beta/findall/runs/fa_1/result",
          ])
        }),
    ),
  )

  it.effect("returns structured error for missing API key", () =>
    Effect.gen(function* () {
      const result = yield* runCli(["extract", '{"urls":["https://example.com"]}'], {
        PARALLEL_API_KEY: undefined,
      })

      const payload = expectJson<{
        ok: boolean
        command: string
        error: { type: string; details: { env_var: string } }
      }>(result.stderr)

      expect(result.exitCode).toBe(1)
      expect(result.stdout.trim()).toBe("")
      expect(payload.ok).toBe(false)
      expect(payload.command).toBe("extract")
      expect(payload.error.type).toBe("MissingApiKeyError")
      expect(payload.error.details.env_var).toBe("PARALLEL_API_KEY")
    }),
  )
})

describe("toErrorDetails", () => {
  it.effect("formats MissingApiKeyError with Parallel env var", () =>
    Effect.gen(function* () {
      const error = new MissingApiKeyError({
        envVar: "PARALLEL_API_KEY",
        hint: "Set your API key",
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("MissingApiKeyError")
      expect(details.message).toBe("PARALLEL_API_KEY is not configured")
      expect(details.details).toEqual({
        env_var: "PARALLEL_API_KEY",
        hint: "Set your API key",
      })
    }),
  )
})
