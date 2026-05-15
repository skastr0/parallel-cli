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

  it.effect("search accepts @file and stdin input modes", () =>
    withMockServer(
      (request) => ({
        body: {
          search_id: request.body && typeof request.body === "object" && "objective" in request.body
            ? `search_${request.body.objective}`
            : "search_unknown",
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
            { objective: "file", mode: "one-shot", max_results: 10 },
            { objective: "stdin", mode: "one-shot", max_results: 10 },
          ])
        }),
    ),
  )

  it.effect("search array input returns ordered batch partial failures", () =>
    withMockServer(
      (request) => ({
        body: {
          search_id: `search_${(request.body as { objective: string }).objective}`,
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

  it.effect("artifact output writes compact summary and JSON artifact", () =>
    withMockServer(
      () => ({
        body: {
          search_id: "search_artifact",
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
        expect(request.headers["parallel-beta"]).toBe("findall-2025-09-15")
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
        expect(request.url).toBe("/v1alpha/monitors/mon_1/events?lookback_period=7d")
        return {
          body: {
            events: [{ type: "completion", monitor_ts: "completed_2026-04-24T00:00:00Z" }],
            has_more: false,
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
              '{"monitor_id":"mon_1","lookback_period":"7d"}',
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
        expect(request.url).toBe("/v1alpha/monitors")
        return {
          body: [
            {
              monitor_id: "mon_1",
              query: "news",
              status: "active",
              frequency: "1d",
              created_at: "2026-04-24T00:00:00.000Z",
            },
          ],
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

      expect(expectJson<{ data: { commands: ReadonlyArray<{ command: string }> } }>(
        capabilities.stdout,
      ).data.commands.some((command) => command.command === "deep-research start")).toBe(true)
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
            path: "/v1beta/search",
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
