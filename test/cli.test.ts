import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { join, relative } from "node:path"
import { tmpdir } from "node:os"

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
  handler: (request: RecordedRequest) => {
    readonly status?: number
    readonly body?: unknown
    readonly rawBody?: string
    readonly contentType?: string
  },
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
        response.setHeader("content-type", result.contentType ?? "application/json")
        response.end(result.rawBody ?? JSON.stringify(result.body))
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
        expect(request.url).toBe("/v1/search")
        expect(request.headers["x-api-key"]).toBe("test-key")
        expect(request.headers["parallel-beta"]).toBeUndefined()
        expect(request.body).toEqual({
          objective: "find docs",
          search_queries: ["find docs"],
          mode: "advanced",
          advanced_settings: { max_results: 3 },
        })

        return {
          body: {
            search_id: "search_1",
            session_id: "session_1",
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
            data: { search_id: string; session_id: string; result_count: number }
          }>(result.stdout)

          expect(result.exitCode).toBe(0)
          expect(result.stderr.trim()).toBe("")
          expect(payload.command).toBe("search")
          expect(payload.data.search_id).toBe("search_1")
          expect(payload.data.session_id).toBe("session_1")
          expect(payload.data.result_count).toBe(1)
        }),
    ),
  )

  it.effect("search accepts @file and stdin input modes", () =>
    withMockServer(
      (request) => ({
        body: {
          search_id: request.body && typeof request.body === "object" && "objective" in request.body
            ? `search_${request.body.objective}`
            : "search_unknown",
          session_id: "session_input",
          results: [],
        },
      }),
      (baseUrl, requests) =>
        Effect.gen(function* () {
          const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "parallel-cli-input-")))
          const filePath = join(dir, "search.json")
          yield* Effect.promise(() => writeFile(filePath, '{"objective":"file"}\n', "utf8"))

          const fileResult = yield* runCli(["search", `@${filePath}`], {
            PARALLEL_API_KEY: "test-key",
            PARALLEL_API_BASE_URL: baseUrl,
          })
          const stdinResult = yield* runCli(["search", "-"], {
            PARALLEL_API_KEY: "test-key",
            PARALLEL_API_BASE_URL: baseUrl,
          }, { stdinText: '{"objective":"stdin"}' })

          expect(fileResult.exitCode).toBe(0)
          expect(stdinResult.exitCode).toBe(0)
          expect(requests.map((request) => request.body)).toEqual([
            { objective: "file", search_queries: ["file"], mode: "fast" },
            { objective: "stdin", search_queries: ["stdin"], mode: "fast" },
          ])
        }),
    ),
  )

  it.effect("search array input returns ordered batch partial failures", () =>
    withMockServer(
      (request) => ({
        body: {
          search_id: `search_${(request.body as { objective: string }).objective}`,
          session_id: "session_batch",
          results: [],
        },
      }),
      (baseUrl, requests) =>
        Effect.gen(function* () {
          const result = yield* runCli(
            [
              "search",
              "--concurrency",
              "2",
              '[{"objective":"first"},{"bad":true},{"objective":"third"}]',
            ],
            {
              PARALLEL_API_KEY: "test-key",
              PARALLEL_API_BASE_URL: baseUrl,
            },
          )
          const payload = expectJson<{
            ok: boolean
            data: {
              outcome: string
              total: number
              success_count: number
              error_count: number
              concurrency: number
              results: ReadonlyArray<{ index: number; ok: boolean }>
            }
          }>(result.stdout)

          expect(result.exitCode).toBe(1)
          expect(result.stderr.trim()).toBe("")
          expect(payload.ok).toBe(true)
          expect(payload.data.outcome).toBe("partial_failure")
          expect(payload.data.total).toBe(3)
          expect(payload.data.success_count).toBe(2)
          expect(payload.data.error_count).toBe(1)
          expect(payload.data.concurrency).toBe(2)
          expect(payload.data.results.map((item) => [item.index, item.ok])).toEqual([
            [0, true],
            [1, false],
            [2, true],
          ])
          expect(requests.map((request) => (request.body as { objective: string }).objective)).toEqual([
            "first",
            "third",
          ])
        }),
    ),
  )

  it.effect("extract posts v1 payload with advanced_settings", () =>
    withMockServer(
      (request) => {
        expect(request.method).toBe("POST")
        expect(request.url).toBe("/v1/extract")
        expect(request.headers["parallel-beta"]).toBeUndefined()
        expect(request.body).toEqual({
          urls: ["https://parallel.ai"],
          objective: "Extract product names",
          session_id: "session_extract",
          client_model: "grok-4",
          max_chars_total: 20000,
          advanced_settings: {
            excerpt_settings: { max_chars_per_result: 4000 },
            full_content: true,
          },
        })

        return {
          body: {
            extract_id: "extract_1",
            session_id: "session_extract",
            results: [{
              url: "https://parallel.ai",
              title: "Parallel",
              excerpts: ["API"],
              full_content: "# Parallel",
            }],
            errors: [],
          },
        }
      },
      (baseUrl) =>
        Effect.gen(function* () {
          const result = yield* runCli(
            [
              "extract",
              JSON.stringify({
                urls: ["https://parallel.ai"],
                objective: "Extract product names",
                session_id: "session_extract",
                client_model: "grok-4",
                max_chars_total: 20000,
                excerpts: { max_chars_per_result: 4000 },
                full_content: true,
              }),
            ],
            {
              PARALLEL_API_KEY: "test-key",
              PARALLEL_API_BASE_URL: baseUrl,
            },
          )
          const payload = expectJson<{
            data: { extract_id: string; session_id: string; result_count: number }
          }>(result.stdout)

          expect(result.exitCode).toBe(0)
          expect(payload.data.extract_id).toBe("extract_1")
          expect(payload.data.session_id).toBe("session_extract")
          expect(payload.data.result_count).toBe(1)
        }),
    ),
  )

  it.effect("extract rejects excerpts false because v1 always returns excerpts", () =>
    Effect.gen(function* () {
      const result = yield* runCli(
        ["extract", '{"urls":["https://example.com"],"excerpts":false}'],
        { PARALLEL_API_KEY: "test-key", PARALLEL_API_BASE_URL: "http://127.0.0.1:9" },
      )
      const payload = expectJson<{ error: { type: string; details: { field?: string } } }>(
        result.stderr,
      )

      expect(result.exitCode).toBe(1)
      expect(payload.error.type).toBe("CommandInputError")
      expect(payload.error.details.field).toBe("excerpts")
    }),
  )

  it.effect("findall entity-search posts the beta entity-search path", () =>
    withMockServer(
      (request) => {
        expect(request.method).toBe("POST")
        expect(request.url).toBe("/v1beta/findall/entity-search")
        expect(request.headers["parallel-beta"]).toBeUndefined()
        expect(request.body).toEqual({
          entity_type: "companies",
          objective: "AI startups in San Francisco",
          match_limit: 25,
        })

        return {
          body: {
            entity_set_id: "entity_set_1",
            entities: [
              {
                name: "Figure AI",
                url: "https://www.figure.ai",
                description: "Humanoid robots",
              },
            ],
          },
        }
      },
      (baseUrl) =>
        Effect.gen(function* () {
          const result = yield* runCli(
            [
              "findall",
              "entity-search",
              '{"entity_type":"companies","objective":"AI startups in San Francisco","match_limit":25}',
            ],
            {
              PARALLEL_API_KEY: "test-key",
              PARALLEL_API_BASE_URL: baseUrl,
            },
          )
          const payload = expectJson<{
            command: string
            data: { entity_set_id: string; entity_count: number }
          }>(result.stdout)

          expect(result.exitCode).toBe(0)
          expect(payload.command).toBe("findall entity-search")
          expect(payload.data.entity_set_id).toBe("entity_set_1")
          expect(payload.data.entity_count).toBe(1)
        }),
    ),
  )

  it.effect("findall entity-search rejects match_limit below 5", () =>
    Effect.gen(function* () {
      const result = yield* runCli(
        [
          "findall",
          "entity-search",
          '{"entity_type":"people","objective":"AI researchers","match_limit":2}',
        ],
        { PARALLEL_API_KEY: "test-key", PARALLEL_API_BASE_URL: "http://127.0.0.1:9" },
      )
      const payload = expectJson<{ error: { type: string; details: { field?: string } } }>(
        result.stderr,
      )

      expect(result.exitCode).toBe(1)
      expect(payload.error.type).toBe("CommandInputError")
      expect(payload.error.details.field).toBe("match_limit")
    }),
  )

  it.effect("findall start ingests, creates a flattened v1 run, then applies enrichments", () =>
    withMockServer(
      (request) => {
        if (request.url === "/v1beta/findall/ingest") {
          expect(request.body).toEqual({ objective: "Find AI companies that raised Series A in 2024" })
          expect(request.headers["parallel-beta"]).toBeUndefined()
          return {
            body: {
              objective: "Find AI companies that raised Series A in 2024",
              entity_type: "companies",
              match_conditions: [
                { name: "series_a_2024", description: "Raised Series A in 2024" },
              ],
              enrichments: [
                {
                  processor: "core",
                  output_schema: {
                    json_schema: {
                      type: "object",
                      properties: { ceo_name: { type: "string" } },
                    },
                  },
                },
              ],
              generator: "core",
            },
          }
        }

        if (request.url === "/v1beta/findall/runs") {
          expect(request.body).toEqual({
            objective: "Find AI companies that raised Series A in 2024",
            entity_type: "companies",
            match_conditions: [
              { name: "series_a_2024", description: "Raised Series A in 2024" },
            ],
            generator: "core",
            match_limit: 10,
          })
          expect((request.body as { enrichments?: unknown }).enrichments).toBeUndefined()
          return { body: { findall_id: "fa_start" } }
        }

        expect(request.method).toBe("POST")
        expect(request.url).toBe("/v1beta/findall/runs/fa_start/enrich")
        expect(request.body).toEqual({
          processor: "core",
          output_schema: {
            type: "json",
            json_schema: {
              type: "object",
              properties: { ceo_name: { type: "string" } },
            },
          },
        })
        return {
          body: {
            objective: "Find AI companies that raised Series A in 2024",
            entity_type: "companies",
            match_conditions: [
              { name: "series_a_2024", description: "Raised Series A in 2024" },
            ],
            generator: "core",
            match_limit: 10,
          },
        }
      },
      (baseUrl, requests) =>
        Effect.gen(function* () {
          const result = yield* runCli(
            ["findall", "start", '{"objective":"Find AI companies that raised Series A in 2024"}'],
            {
              PARALLEL_API_KEY: "test-key",
              PARALLEL_API_BASE_URL: baseUrl,
            },
          )
          const payload = expectJson<{
            data: { findall_id: string; entity_type: string; generator: string }
          }>(result.stdout)

          expect(result.exitCode).toBe(0)
          expect(payload.data.findall_id).toBe("fa_start")
          expect(payload.data.entity_type).toBe("companies")
          expect(payload.data.generator).toBe("core")
          expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
            "POST /v1beta/findall/ingest",
            "POST /v1beta/findall/runs",
            "POST /v1beta/findall/runs/fa_start/enrich",
          ])
        }),
    ),
  )

  it.effect("findall start rejects string exclude_list values", () =>
    Effect.gen(function* () {
      const result = yield* runCli(
        [
          "findall",
          "start",
          '{"objective":"Find AI companies","exclude_list":["Example Corp"]}',
        ],
        { PARALLEL_API_KEY: "test-key", PARALLEL_API_BASE_URL: "http://127.0.0.1:9" },
      )
      const payload = expectJson<{ error: { type: string } }>(result.stderr)

      expect(result.exitCode).toBe(1)
      expect(payload.error.type).toBe("JsonInputError")
    }),
  )

  it.effect("monitors create posts the v1 event_stream payload", () =>
    withMockServer(
      (request) => {
        expect(request.method).toBe("POST")
        expect(request.url).toBe("/v1/monitors")
        expect(request.body).toEqual({
          type: "event_stream",
          frequency: "1d",
          processor: "lite",
          settings: { query: "Notable news about Parallel Web Systems" },
        })

        return {
          body: {
            type: "event_stream",
            monitor_id: "mon_created",
            status: "active",
            frequency: "1d",
            processor: "lite",
            created_at: "2026-04-24T00:00:00.000Z",
            settings: { query: "Notable news about Parallel Web Systems" },
          },
        }
      },
      (baseUrl) =>
        Effect.gen(function* () {
          const result = yield* runCli(
            [
              "monitors",
              "create",
              '{"query":"Notable news about Parallel Web Systems","cadence":"daily"}',
            ],
            {
              PARALLEL_API_KEY: "test-key",
              PARALLEL_API_BASE_URL: baseUrl,
            },
          )
          const payload = expectJson<{
            data: { monitor_id: string; type?: string; query?: string }
          }>(result.stdout)

          expect(result.exitCode).toBe(0)
          expect(payload.data.monitor_id).toBe("mon_created")
          expect(payload.data.type).toBe("event_stream")
          expect(payload.data.query).toBe("Notable news about Parallel Web Systems")
        }),
    ),
  )

  it.effect("monitors events rejects lookback_period removed in v1", () =>
    Effect.gen(function* () {
      const result = yield* runCli(
        ["monitors", "events", '{"monitor_id":"mon_1","lookback_period":"7d"}'],
        { PARALLEL_API_KEY: "test-key", PARALLEL_API_BASE_URL: "http://127.0.0.1:9" },
      )
      const payload = expectJson<{ error: { type: string; details: { field?: string } } }>(
        result.stderr,
      )

      expect(result.exitCode).toBe(1)
      expect(payload.error.type).toBe("CommandInputError")
      expect(payload.error.details.field).toBe("lookback_period")
    }),
  )

  it.effect("monitors trigger posts the v1 trigger endpoint", () =>
    withMockServer(
      (request) => {
        expect(request.method).toBe("POST")
        expect(request.url).toBe("/v1/monitors/mon_1/trigger")
        return { status: 204, rawBody: "" }
      },
      (baseUrl) =>
        Effect.gen(function* () {
          const result = yield* runCli(["monitors", "trigger", '{"monitor_id":"mon_1"}'], {
            PARALLEL_API_KEY: "test-key",
            PARALLEL_API_BASE_URL: baseUrl,
          })
          const payload = expectJson<{ data: { monitor_id: string; triggered: boolean } }>(
            result.stdout,
          )

          expect(result.exitCode).toBe(0)
          expect(payload.data.monitor_id).toBe("mon_1")
          expect(payload.data.triggered).toBe(true)
        }),
    ),
  )

  it.effect("artifact output writes compact summary and JSON artifact", () =>
    withMockServer(
      () => ({
        body: {
          search_id: "search_artifact",
          session_id: "session_artifact",
          results: [{ url: "https://example.com", title: "Example", excerpts: ["A".repeat(128)] }],
        },
      }),
      (baseUrl) =>
        Effect.gen(function* () {
          const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "parallel-cli-artifacts-")))
          const result = yield* runCli(
            ["search", "--output", "artifact", '{"objective":"artifact"}'],
            {
              PARALLEL_API_KEY: "test-key",
              PARALLEL_API_BASE_URL: baseUrl,
              PARALLEL_CLI_ARTIFACT_DIR: dir,
            },
          )
          const payload = expectJson<{
            data: {
              kind: string
              artifact: { absolute_path: string; size_bytes: number }
            }
          }>(result.stdout)
          const artifactText = yield* Effect.promise(() =>
            readFile(payload.data.artifact.absolute_path, "utf8"),
          )

          expect(result.exitCode).toBe(0)
          expect(payload.data.kind).toBe("summary+artifact")
          expect(payload.data.artifact.size_bytes).toBeGreaterThan(0)
          expect(JSON.parse(artifactText).search_id).toBe("search_artifact")
        }),
    ),
  )

  it.effect("artifact output defaults to PARALLEL_CLI_HOME outside the project tree", () =>
    withMockServer(
      () => ({
        body: {
          search_id: "search_home_artifact",
          session_id: "session_home",
          results: [{ url: "https://example.com", title: "Example", excerpts: ["A"] }],
        },
      }),
      (baseUrl) =>
        Effect.gen(function* () {
          const cliHome = yield* Effect.promise(() =>
            mkdtemp(join(tmpdir(), "parallel-cli-home-")),
          )
          const result = yield* runCli(
            ["search", "--output", "artifact", '{"objective":"artifact-home"}'],
            {
              PARALLEL_API_KEY: "test-key",
              PARALLEL_API_BASE_URL: baseUrl,
              PARALLEL_CLI_HOME: cliHome,
              PARALLEL_CLI_ARTIFACT_DIR: undefined,
            },
          )
          const payload = expectJson<{
            data: {
              artifact: { absolute_path: string; relative_path: string }
            }
          }>(result.stdout)

          expect(result.exitCode).toBe(0)
          expect(payload.data.artifact.absolute_path.startsWith(join(cliHome, "artifacts"))).toBe(true)
          expect(payload.data.artifact.relative_path).toBe(
            relative(join(cliHome, "artifacts"), payload.data.artifact.absolute_path),
          )
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

  it.effect("deep-research events parses provider SSE frames", () =>
    withMockServer(
      (request) => {
        expect(request.method).toBe("GET")
        expect(request.url).toBe("/v1/tasks/runs/run_1/events")
        expect(request.headers["parallel-beta"]).toBe("events-sse-2025-07-24")
        return {
          contentType: "text/event-stream",
          rawBody:
            'event: message\ndata: {"type":"task_run.progress_msg.plan","message":"Planning","timestamp":"2026-04-24T00:00:00.000Z"}\n\n',
        }
      },
      (baseUrl) =>
        Effect.gen(function* () {
          const result = yield* runCli(["deep-research", "events", '{"run_id":"run_1"}'], {
            PARALLEL_API_KEY: "test-key",
            PARALLEL_API_BASE_URL: baseUrl,
          })
          const payload = expectJson<{
            data: { run_id: string; event_count: number; events: ReadonlyArray<{ type: string }> }
          }>(result.stdout)

          expect(result.exitCode).toBe(0)
          expect(payload.data.run_id).toBe("run_1")
          expect(payload.data.event_count).toBe(1)
          expect(payload.data.events[0]?.type).toBe("task_run.progress_msg.plan")
        }),
    ),
  )

  it.effect("deep-research start replays local idempotency receipts", () =>
    withMockServer(
      () => ({
        body: {
          run_id: "run_idem",
          status: "queued",
          is_active: true,
          processor: "base",
          interaction_id: "int_1",
          created_at: "2026-04-24T00:00:00.000Z",
          modified_at: "2026-04-24T00:00:01.000Z",
        },
      }),
      (baseUrl, requests) =>
        Effect.gen(function* () {
          const stateDir = yield* Effect.promise(() =>
            mkdtemp(join(tmpdir(), "parallel-cli-state-")),
          )
          const env = {
            PARALLEL_API_KEY: "test-key",
            PARALLEL_API_BASE_URL: baseUrl,
            PARALLEL_CLI_STATE_DIR: stateDir,
          }
          const args = [
            "deep-research",
            "start",
            "--idempotency-key",
            "idem-1",
            '{"input":"research"}',
          ]
          const first = yield* runCli(args, env)
          const second = yield* runCli(args, env)
          const firstPayload = expectJson<{ data: { idempotency: { status: string } } }>(
            first.stdout,
          )
          const secondPayload = expectJson<{ data: { idempotency: { status: string } } }>(
            second.stdout,
          )

          expect(first.exitCode).toBe(0)
          expect(second.exitCode).toBe(0)
          expect(requests.length).toBe(1)
          expect(firstPayload.data.idempotency.status).toBe("stored")
          expect(secondPayload.data.idempotency.status).toBe("replayed")
        }),
    ),
  )

  it.effect("idempotency receipts default to PARALLEL_CLI_HOME state", () =>
    withMockServer(
      () => ({
        body: {
          run_id: "run_home_idem",
          status: "queued",
          is_active: true,
          processor: "base",
          interaction_id: "int_1",
          created_at: "2026-04-24T00:00:00.000Z",
          modified_at: "2026-04-24T00:00:01.000Z",
        },
      }),
      (baseUrl) =>
        Effect.gen(function* () {
          const cliHome = yield* Effect.promise(() =>
            mkdtemp(join(tmpdir(), "parallel-cli-home-")),
          )
          const result = yield* runCli(
            [
              "deep-research",
              "start",
              "--idempotency-key",
              "idem-home",
              '{"input":"research"}',
            ],
            {
              PARALLEL_API_KEY: "test-key",
              PARALLEL_API_BASE_URL: baseUrl,
              PARALLEL_CLI_HOME: cliHome,
              PARALLEL_CLI_STATE_DIR: undefined,
            },
          )
          const receiptRoot = join(cliHome, "state", "idempotency")

          expect(result.exitCode).toBe(0)
          const receiptEntries = yield* Effect.promise(() => readdir(receiptRoot))
          expect(receiptEntries.length).toBe(1)
          expect(receiptEntries[0]?.endsWith(".json")).toBe(true)
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

  it.effect("findall cancel calls the provider cancel endpoint", () =>
    withMockServer(
      (request) => {
        expect(request.method).toBe("POST")
        expect(request.url).toBe("/v1beta/findall/runs/fa_1/cancel")
        expect(request.headers["parallel-beta"]).toBeUndefined()
        return { rawBody: "" }
      },
      (baseUrl) =>
        Effect.gen(function* () {
          const result = yield* runCli(["findall", "cancel", '{"findall_id":"fa_1"}'], {
            PARALLEL_API_KEY: "test-key",
            PARALLEL_API_BASE_URL: baseUrl,
          })
          const payload = expectJson<{ data: { findall_id: string; cancelled: boolean } }>(
            result.stdout,
          )

          expect(result.exitCode).toBe(0)
          expect(payload.data.findall_id).toBe("fa_1")
          expect(payload.data.cancelled).toBe(true)
        }),
    ),
  )

  it.effect("monitors events supports artifact output", () =>
    withMockServer(
      (request) => {
        expect(request.method).toBe("GET")
        expect(request.url).toBe("/v1/monitors/mon_1/events?limit=20")
        return {
          body: {
            events: [{ event_type: "completion", timestamp: "2026-04-24T00:00:00Z" }],
          },
        }
      },
      (baseUrl) =>
        Effect.gen(function* () {
          const dir = yield* Effect.promise(() =>
            mkdtemp(join(tmpdir(), "parallel-cli-monitor-artifacts-")),
          )
          const result = yield* runCli(
            [
              "monitors",
              "events",
              "--output",
              "artifact",
              '{"monitor_id":"mon_1","limit":20}',
            ],
            {
              PARALLEL_API_KEY: "test-key",
              PARALLEL_API_BASE_URL: baseUrl,
              PARALLEL_CLI_ARTIFACT_DIR: dir,
            },
          )
          const payload = expectJson<{ data: { kind: string; artifact: { absolute_path: string } } }>(
            result.stdout,
          )
          const artifact = JSON.parse(
            yield* Effect.promise(() => readFile(payload.data.artifact.absolute_path, "utf8")),
          )

          expect(result.exitCode).toBe(0)
          expect(payload.data.kind).toBe("summary+artifact")
          expect(artifact.monitor_id).toBe("mon_1")
          expect(artifact.event_count).toBe(1)
        }),
    ),
  )

  it.effect("monitors list accepts provider array responses", () =>
    withMockServer(
      (request) => {
        expect(request.method).toBe("GET")
        expect(request.url).toBe("/v1/monitors")
        return {
          body: {
            monitors: [
              {
                type: "event_stream",
                monitor_id: "mon_1",
                status: "active",
                frequency: "1d",
                processor: "lite",
                created_at: "2026-04-24T00:00:00.000Z",
                settings: { query: "news" },
              },
            ],
          },
        }
      },
      (baseUrl) =>
        Effect.gen(function* () {
          const result = yield* runCli(["monitors", "list"], {
            PARALLEL_API_KEY: "test-key",
            PARALLEL_API_BASE_URL: baseUrl,
          })
          const payload = expectJson<{
            data: { monitor_count: number; monitors: ReadonlyArray<{ monitor_id: string }> }
          }>(result.stdout)

          expect(result.exitCode).toBe(0)
          expect(payload.data.monitor_count).toBe(1)
          expect(payload.data.monitors[0]?.monitor_id).toBe("mon_1")
        }),
    ),
  )

  it.effect("discovery and doctor commands return machine-readable envelopes", () =>
    Effect.gen(function* () {
      const capabilities = yield* runCli(["capabilities"], {
        PARALLEL_API_KEY: undefined,
      })
      const schemaList = yield* runCli(["schema", "list"], {
        PARALLEL_API_KEY: undefined,
      })
      const schemaShow = yield* runCli(["schema", "show", "parallel.search.input/v1"], {
        PARALLEL_API_KEY: undefined,
      })
      const examples = yield* runCli(["examples", "show", "search"], {
        PARALLEL_API_KEY: undefined,
      })
      const cliHome = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "parallel-cli-home-")),
      )
      const doctor = yield* runCli(["doctor"], {
        PARALLEL_API_KEY: undefined,
        PARALLEL_CLI_HOME: cliHome,
        PARALLEL_CLI_ARTIFACT_DIR: undefined,
        PARALLEL_CLI_STATE_DIR: undefined,
      })

      expect(capabilities.exitCode).toBe(0)
      expect(schemaList.exitCode).toBe(0)
      expect(schemaShow.exitCode).toBe(0)
      expect(examples.exitCode).toBe(0)
      expect(doctor.exitCode).toBe(0)

      const capabilityCommands = expectJson<{
        data: {
          commands: ReadonlyArray<{
            command: string
            supported_actions: ReadonlyArray<string>
          }>
        }
      }>(capabilities.stdout).data.commands
      expect(capabilityCommands.some((command) => command.command === "deep-research start")).toBe(true)
      expect(capabilityCommands.find((command) => command.command === "monitors trigger")?.supported_actions)
        .toEqual(["trigger"])
      expect(capabilityCommands.find((command) => command.command === "monitors simulate")?.supported_actions)
        .toEqual(["trigger"])
      expect(expectJson<{ data: { schemas: ReadonlyArray<{ schema_id: string }> } }>(
        schemaList.stdout,
      ).data.schemas.some((schema) => schema.schema_id === "parallel.search.input/v1")).toBe(true)
      expect(expectJson<{ data: { command: string; json_schema: unknown } }>(
        schemaShow.stdout,
      ).data.command).toBe("search")
      expect(expectJson<{ data: { examples: ReadonlyArray<unknown> } }>(
        examples.stdout,
      ).data.examples.length).toBeGreaterThan(0)
      const doctorPayload = expectJson<{ data: { checks: ReadonlyArray<{ name: string; details: { path?: string } }> } }>(
        doctor.stdout,
      )
      expect(doctorPayload.data.checks.some((check) => check.name === "api_key")).toBe(true)
      expect(doctorPayload.data.checks.find((check) => check.name === "cli_home")?.details.path).toBe(cliHome)
      expect(doctorPayload.data.checks.find((check) => check.name === "artifact_dir")?.details.path).toBe(join(cliHome, "artifacts"))
      expect(doctorPayload.data.checks.find((check) => check.name === "state_dir")?.details.path).toBe(join(cliHome, "state"))
    }),
  )

  it.effect("provider API errors include recovery metadata and redact secrets", () =>
    withMockServer(
      () => ({
        status: 429,
        body: {
          error: {
            message: "rate limited",
            api_key: "secret-key",
          },
        },
      }),
      (baseUrl) =>
        Effect.gen(function* () {
          const result = yield* runCli(["search", '{"objective":"docs"}'], {
            PARALLEL_API_KEY: "test-key",
            PARALLEL_API_BASE_URL: baseUrl,
          })
          const payload = expectJson<{
            error: {
              details: {
                retryable: boolean
                provider_request: { method: string; path: string; status: number }
                body: { error: { api_key: string } }
              }
            }
          }>(result.stderr)

          expect(result.exitCode).toBe(1)
          expect(payload.error.details.retryable).toBe(true)
          expect(payload.error.details.provider_request).toEqual({
            method: "POST",
            path: "/v1/search",
            status: 429,
          })
          expect(payload.error.details.body.error.api_key).toBe("[REDACTED]")
        }),
    ),
  )

  it.effect("help output is available without provider credentials", () =>
    Effect.gen(function* () {
      const rootHelp = yield* runCli(["--help"], { PARALLEL_API_KEY: undefined })
      const searchHelp = yield* runCli(["search", "--help"], { PARALLEL_API_KEY: undefined })

      expect(rootHelp.exitCode).toBe(0)
      expect(searchHelp.exitCode).toBe(0)
      expect(rootHelp.stdout).toContain("COMMANDS")
      expect(searchHelp.stdout).toContain("--output")
    }),
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
      expect(details.details).toEqual(expect.objectContaining({
        env_var: "PARALLEL_API_KEY",
        hint: "Set your API key",
        retryable: false,
      }))
    }),
  )
})
