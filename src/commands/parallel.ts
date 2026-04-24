import { Args, Command } from "@effect/cli"
import { Clock, Effect } from "effect"

import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import {
  DeepResearchCheckInput,
  DeepResearchInput,
  ExtractInput,
  FindAllCheckInput,
  FindAllStartInput,
  MonitorCreateInput,
  MonitorEventsInput,
  SearchInput,
  createFindAllRun,
  createMonitor,
  createTaskRun,
  ensurePositiveInteger,
  extract,
  getFindAllResult,
  getFindAllRun,
  getTaskResult,
  getTaskRun,
  isFindAllInProgress,
  isTaskInProgress,
  listMonitorEvents,
  search,
} from "../core/parallel"

const inputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

const sleepSeconds = (seconds: number) => Effect.sleep(`${seconds} seconds`)

const normalizeTaskResult = (
  runId: string,
  run: {
    readonly status: string
    readonly processor: string
    readonly interaction_id?: string | undefined
    readonly warnings?: unknown
  },
  result: {
    readonly run?: {
      readonly status?: string
      readonly processor?: string
      readonly interaction_id?: string | undefined
      readonly warnings?: unknown
    }
    readonly output?: {
      readonly content?: unknown
      readonly type?: string
      readonly output_schema?: unknown
      readonly basis?: unknown
    }
  },
) => ({
  completed: true,
  run_id: runId,
  status: result.run?.status ?? run.status,
  processor: result.run?.processor ?? run.processor,
  interaction_id: result.run?.interaction_id ?? run.interaction_id,
  output: result.output?.content,
  output_type: result.output?.type,
  output_schema: result.output?.output_schema,
  basis: result.output?.basis,
  warnings: result.run?.warnings ?? run.warnings,
})

const deepResearchStart = Command.make("start", { input: inputArg }, ({ input }) =>
  executeJsonCommand(
    "deep-research start",
    loadJsonInput(DeepResearchInput, input).pipe(
      Effect.flatMap((request) => createTaskRun(request, "text")),
      Effect.map((run) => ({
        run_id: run.run_id,
        status: run.status,
        processor: run.processor,
        interaction_id: run.interaction_id,
        warnings: run.warnings,
        next_action: "deep-research check",
      })),
    ),
  ),
).pipe(Command.withDescription("Start a Parallel Task API deep research run"))

const deepResearchCheck = Command.make("check", { input: inputArg }, ({ input }) =>
  executeJsonCommand(
    "deep-research check",
    Effect.gen(function* () {
      const request = yield* loadJsonInput(DeepResearchCheckInput, input)
      const run = yield* getTaskRun(request.run_id)

      if (isTaskInProgress(run)) {
        return {
          completed: false,
          run_id: request.run_id,
          status: run.status,
          is_active: run.is_active,
          processor: run.processor,
          interaction_id: run.interaction_id,
          warnings: run.warnings,
          next_action: "deep-research check",
        }
      }

      if (run.status !== "completed") {
        return {
          completed: false,
          run_id: request.run_id,
          status: run.status,
          processor: run.processor,
          interaction_id: run.interaction_id,
          warnings: run.warnings,
          provider_error: run.error,
        }
      }

      const result = yield* getTaskResult(request.run_id, request.timeout_seconds)
      return normalizeTaskResult(request.run_id, run, result)
    }),
  ),
).pipe(Command.withDescription("Check a Parallel Task API run and fetch results when complete"))

const deepResearchRun = Command.make("run", { input: inputArg }, ({ input }) =>
  executeJsonCommand(
    "deep-research run",
    Effect.gen(function* () {
      const request = yield* loadJsonInput(DeepResearchInput, input)
      const maxWaitSeconds = yield* ensurePositiveInteger(
        "max_wait_seconds",
        request.max_wait_seconds,
        120,
      )
      const pollIntervalSeconds = yield* ensurePositiveInteger(
        "poll_interval_seconds",
        request.poll_interval_seconds,
        5,
      )
      const started = yield* createTaskRun(request, "auto")
      const startMs = yield* Clock.currentTimeMillis
      const deadline = startMs + maxWaitSeconds * 1000
      let current = started

      while (isTaskInProgress(current)) {
        const now = yield* Clock.currentTimeMillis
        if (now >= deadline) {
          return {
            completed: false,
            run_id: started.run_id,
            status: current.status,
            is_active: current.is_active,
            processor: current.processor,
            interaction_id: current.interaction_id,
            warnings: current.warnings,
            next_action: "deep-research check",
          }
        }

        yield* sleepSeconds(pollIntervalSeconds)
        current = yield* getTaskRun(started.run_id)
      }

      if (current.status !== "completed") {
        return {
          completed: false,
          run_id: started.run_id,
          status: current.status,
          processor: current.processor,
          interaction_id: current.interaction_id,
          warnings: current.warnings,
          provider_error: current.error,
        }
      }

      const result = yield* getTaskResult(started.run_id)
      return normalizeTaskResult(started.run_id, current, result)
    }),
  ),
).pipe(Command.withDescription("Start a deep research run and poll until complete or timed out"))

const findAllStart = Command.make("start", { input: inputArg }, ({ input }) =>
  executeJsonCommand(
    "findall start",
    loadJsonInput(FindAllStartInput, input).pipe(
      Effect.flatMap(createFindAllRun),
      Effect.map((created) => ({
        ...created,
        next_action: "findall check",
      })),
    ),
  ),
).pipe(Command.withDescription("Start a Parallel FindAll entity discovery run"))

const findAllCheck = Command.make("check", { input: inputArg }, ({ input }) =>
  executeJsonCommand(
    "findall check",
    Effect.gen(function* () {
      const request = yield* loadJsonInput(FindAllCheckInput, input)
      const run = yield* getFindAllRun(request.findall_id)

      if (isFindAllInProgress(run)) {
        return {
          completed: false,
          findall_id: request.findall_id,
          status: run.status.status,
          is_active: run.status.is_active,
          progress: {
            generated_candidates: run.status.metrics.generated_candidates_count,
            matched_candidates: run.status.metrics.matched_candidates_count,
          },
          next_action: "findall check",
        }
      }

      if (run.status.status !== "completed") {
        return {
          completed: false,
          findall_id: request.findall_id,
          status: run.status.status,
          progress: {
            generated_candidates: run.status.metrics.generated_candidates_count,
            matched_candidates: run.status.metrics.matched_candidates_count,
          },
        }
      }

      const result = yield* getFindAllResult(request.findall_id)
      return {
        completed: true,
        findall_id: request.findall_id,
        status: result.status.status,
        total_matched: result.status.metrics.matched_candidates_count,
        candidates: result.candidates.map((candidate) => ({
          name: candidate.name,
          url: candidate.url,
          description: candidate.description,
          match_status: candidate.match_status,
          match_results: candidate.output,
          basis: candidate.basis,
        })),
      }
    }),
  ),
).pipe(Command.withDescription("Check a Parallel FindAll run and fetch candidates when complete"))

const monitorCreate = Command.make("create", { input: inputArg }, ({ input }) =>
  executeJsonCommand(
    "monitors create",
    loadJsonInput(MonitorCreateInput, input).pipe(
      Effect.flatMap(createMonitor),
      Effect.map((monitor) => ({
        monitor_id: monitor.monitor_id,
        query: monitor.query,
        cadence: monitor.cadence,
        status: monitor.status,
        webhook_configured: Boolean(monitor.webhook),
        next_action: "monitors events",
      })),
    ),
  ),
).pipe(Command.withDescription("Create a Parallel monitor"))

const monitorEvents = Command.make("events", { input: inputArg }, ({ input }) =>
  executeJsonCommand(
    "monitors events",
    loadJsonInput(MonitorEventsInput, input).pipe(
      Effect.flatMap((request) =>
        listMonitorEvents(request).pipe(
          Effect.map((response) => ({
            monitor_id: request.monitor_id,
            event_group_id: request.event_group_id,
            event_count: response.events.length,
            events: response.events,
            ...("has_more" in response ? { has_more: response.has_more } : {}),
            ...("next_cursor" in response && response.next_cursor
              ? { next_cursor: response.next_cursor }
              : {}),
          })),
        ),
      ),
    ),
  ),
).pipe(Command.withDescription("List Parallel monitor events or fetch one event group"))

export const searchCommand = Command.make("search", { input: inputArg }, ({ input }) =>
  executeJsonCommand(
    "search",
    loadJsonInput(SearchInput, input).pipe(
      Effect.flatMap(search),
      Effect.map((response) => ({
        search_id: response.search_id,
        results: response.results,
        result_count: response.results.length,
        warnings: response.warnings,
        usage: response.usage,
      })),
    ),
  ),
).pipe(Command.withDescription("Run a Parallel web search"))

export const extractCommand = Command.make("extract", { input: inputArg }, ({ input }) =>
  executeJsonCommand(
    "extract",
    loadJsonInput(ExtractInput, input).pipe(
      Effect.flatMap(extract),
      Effect.map((response) => ({
        extract_id: response.extract_id,
        results: response.results,
        errors: response.errors,
        result_count: response.results.length,
        error_count: response.errors.length,
        warnings: response.warnings,
        usage: response.usage,
      })),
    ),
  ),
).pipe(Command.withDescription("Extract content from public URLs with Parallel"))

export const deepResearchCommand = Command.make("deep-research").pipe(
  Command.withDescription("Parallel Task API deep research commands"),
  Command.withSubcommands([deepResearchRun, deepResearchStart, deepResearchCheck]),
)

export const findAllCommand = Command.make("findall").pipe(
  Command.withDescription("Parallel FindAll entity discovery commands"),
  Command.withSubcommands([findAllStart, findAllCheck]),
)

export const monitorsCommand = Command.make("monitors").pipe(
  Command.withDescription("Parallel monitor commands"),
  Command.withSubcommands([monitorCreate, monitorEvents]),
)
