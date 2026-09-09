import { Args, Command, Options } from "@effect/cli"
import { Clock, Effect, Option } from "effect"

import { type OutputPolicy } from "../core/artifacts"
import { runJsonInputOrBatch } from "../core/batch"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import {
  DeepResearchCheckInput,
  DeepResearchEventsInput,
  DeepResearchInput,
  DeepResearchWaitInput,
  ExtractInput,
  FindAllCancelInput,
  FindAllCheckInput,
  FindAllEnrichInput,
  FindAllEntitySearchInput,
  FindAllEventsInput,
  FindAllExtendInput,
  FindAllStartInput,
  FindAllWaitInput,
  MonitorCreateInput,
  MonitorEventsInput,
  MonitorIdInput,
  MonitorSimulateInput,
  SearchInput,
  type FindAllRun,
  type TaskRun,
  cancelFindAllRun,
  createFindAllRun,
  createMonitor,
  createTaskRun,
  deleteMonitor,
  enrichFindAllRun,
  ensurePositiveInteger,
  entitySearch,
  extendFindAllRun,
  extract,
  getFindAllEvents,
  getFindAllResult,
  getFindAllRun,
  getMonitor,
  getTaskResult,
  getTaskRun,
  getTaskRunEvents,
  isFindAllInProgress,
  isTaskInProgress,
  listMonitorEvents,
  listMonitors,
  search,
  simulateMonitorEvent,
  triggerMonitorRun,
} from "../core/parallel"
import { withIdempotency } from "../core/idempotency"

const inputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, array, @file path, raw JSON string, or - for stdin"),
)

const outputOption = Options.choice("output", ["inline", "artifact", "auto"] as const).pipe(
  Options.withDefault("inline"),
  Options.withDescription("Output policy for large JSON responses"),
)

const concurrencyOption = Options.integer("concurrency").pipe(
  Options.withDefault(5),
  Options.withDescription("Bounded concurrency for JSON array batch inputs"),
)

const idempotencyKeyOption = Options.text("idempotency-key").pipe(
  Options.optional,
  Options.withDescription("Local success-receipt idempotency key for mutation/job submission"),
)

const sleepSeconds = (seconds: number) => Effect.sleep(`${seconds} seconds`)

const optionToUndefined = <A>(option: Option.Option<A>) =>
  Option.match(option, {
    onNone: () => undefined,
    onSome: (value) => value,
  })

const scopedIdempotencyKey = (key: string | undefined, index: number | undefined) =>
  key && index !== undefined ? `${key}:${index}` : key

const unsupportedCapability = (
  command: string,
  action: string,
  reason: string,
  target?: Record<string, string>,
) => ({
  supported: false,
  command,
  action,
  reason,
  ...(target ? { target } : {}),
  next_action: "capabilities",
})

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

const normalizeTaskRun = (
  runId: string,
  run: {
    readonly status: string
    readonly is_active?: boolean
    readonly processor: string
    readonly interaction_id?: string | undefined
    readonly warnings?: unknown
    readonly error?: unknown
  },
) => ({
  completed: false,
  run_id: runId,
  status: run.status,
  is_active: run.is_active,
  processor: run.processor,
  interaction_id: run.interaction_id,
  warnings: run.warnings,
  provider_error: run.error,
  next_action: "deep-research check",
  next_actions: {
    inspect: "deep-research inspect",
    check: "deep-research check",
    wait: "deep-research wait",
    events: "deep-research events",
  },
})

const taskStartData = (run: TaskRun) => ({
  run_id: run.run_id,
  status: run.status,
  processor: run.processor,
  interaction_id: run.interaction_id,
  warnings: run.warnings,
  lifecycle: {
    provider_async: true,
    supported_actions: ["check", "inspect", "wait", "events"],
    unsupported_actions: [{ action: "cancel", reason: "Task Run cancel is not documented." }],
  },
  next_actions: {
    inspect: "deep-research inspect",
    check: "deep-research check",
    wait: "deep-research wait",
    events: "deep-research events",
  },
})

const checkTaskRun = (request: typeof DeepResearchCheckInput.Type) =>
  Effect.gen(function* () {
    const run = yield* getTaskRun(request.run_id)

    if (isTaskInProgress(run)) {
      return normalizeTaskRun(request.run_id, run)
    }

    if (run.status !== "completed") {
      return normalizeTaskRun(request.run_id, run)
    }

    const result = yield* getTaskResult(request.run_id, request.timeout_seconds)
    return normalizeTaskResult(request.run_id, run, result)
  })

const waitForTaskRun = (request: typeof DeepResearchWaitInput.Type) =>
  Effect.gen(function* () {
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
    const startMs = yield* Clock.currentTimeMillis
    const deadline = startMs + maxWaitSeconds * 1000
    let current = yield* getTaskRun(request.run_id)

    while (isTaskInProgress(current)) {
      const now = yield* Clock.currentTimeMillis
      if (now >= deadline) {
        return normalizeTaskRun(request.run_id, current)
      }

      yield* sleepSeconds(pollIntervalSeconds)
      current = yield* getTaskRun(request.run_id)
    }

    if (current.status !== "completed") {
      return normalizeTaskRun(request.run_id, current)
    }

    const result = yield* getTaskResult(request.run_id, request.timeout_seconds)
    return normalizeTaskResult(request.run_id, current, result)
  })

const runDeepResearch = (request: typeof DeepResearchInput.Type) =>
  Effect.gen(function* () {
    const started = yield* createTaskRun(request, "auto")
    return yield* waitForTaskRun({
      run_id: started.run_id,
      max_wait_seconds: request.max_wait_seconds,
      poll_interval_seconds: request.poll_interval_seconds,
    })
  })

const normalizeFindAllRun = (findallId: string, run: FindAllRun) => ({
  completed: false,
  findall_id: findallId,
  status: run.status.status,
  is_active: run.status.is_active,
  progress: {
    generated_candidates: run.status.metrics.generated_candidates_count,
    matched_candidates: run.status.metrics.matched_candidates_count,
  },
  next_action: "findall check",
  next_actions: {
    inspect: "findall inspect",
    check: "findall check",
    wait: "findall wait",
    events: "findall events",
    enrich: "findall enrich",
    extend: "findall extend",
    cancel: "findall cancel",
  },
})

const checkFindAllRun = (request: typeof FindAllCheckInput.Type) =>
  Effect.gen(function* () {
    const run = yield* getFindAllRun(request.findall_id)

    if (isFindAllInProgress(run)) {
      return normalizeFindAllRun(request.findall_id, run)
    }

    if (run.status.status !== "completed") {
      return normalizeFindAllRun(request.findall_id, run)
    }

    const result = yield* getFindAllResult(request.findall_id)
    return {
      completed: true,
      findall_id: request.findall_id,
      status: result.status.status,
      total_matched: result.status.metrics.matched_candidates_count,
      candidates: result.candidates.map((candidate) => ({
        candidate_id: candidate.candidate_id,
        name: candidate.name,
        url: candidate.url,
        description: candidate.description,
        match_status: candidate.match_status,
        match_results: candidate.output,
        basis: candidate.basis,
      })),
    }
  })

const waitForFindAllRun = (request: typeof FindAllWaitInput.Type) =>
  Effect.gen(function* () {
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
    const startMs = yield* Clock.currentTimeMillis
    const deadline = startMs + maxWaitSeconds * 1000
    let current = yield* getFindAllRun(request.findall_id)

    while (isFindAllInProgress(current)) {
      const now = yield* Clock.currentTimeMillis
      if (now >= deadline) {
        return normalizeFindAllRun(request.findall_id, current)
      }

      yield* sleepSeconds(pollIntervalSeconds)
      current = yield* getFindAllRun(request.findall_id)
    }

    if (current.status.status !== "completed") {
      return normalizeFindAllRun(request.findall_id, current)
    }

    return yield* checkFindAllRun({ findall_id: request.findall_id })
  })

const normalizeMonitor = (monitor: {
  readonly monitor_id: string
  readonly type?: string | undefined
  readonly query?: string | undefined
  readonly frequency?: string | undefined
  readonly cadence?: string | undefined
  readonly processor?: string | undefined
  readonly status: string
  readonly webhook?: unknown | undefined
  readonly settings?: { readonly query?: string | undefined } | undefined
}) => ({
  monitor_id: monitor.monitor_id,
  type: monitor.type,
  query: monitor.settings?.query ?? monitor.query,
  frequency: monitor.frequency,
  cadence: monitor.cadence,
  processor: monitor.processor,
  status: monitor.status,
  webhook_configured: Boolean(monitor.webhook),
  lifecycle: {
    provider_async: true,
    supported_actions: ["inspect", "events", "cancel"],
    unsupported_actions: [
      {
        action: "wait",
        reason: "Monitor execution is scheduled or webhook-driven; use events for history.",
      },
      {
        action: "stream",
        reason: "Monitor API exposes webhooks and event history, not an SSE stream.",
      },
    ],
  },
  next_actions: {
    inspect: "monitors inspect",
    events: "monitors events",
    trigger: "monitors trigger",
    cancel: "monitors cancel",
  },
})

const executeWithOutput = <A, E, R>(
  command: string,
  output: OutputPolicy,
  effect: Effect.Effect<A, E, R>,
) => executeJsonCommand(command, effect, { outputPolicy: output })

export const searchCommand = Command.make(
  "search",
  { input: inputArg, output: outputOption, concurrency: concurrencyOption },
  ({ input, output, concurrency }) =>
    executeWithOutput(
      "search",
      output,
      Effect.gen(function* () {
        const resolvedConcurrency = yield* ensurePositiveInteger("concurrency", concurrency, 5)
        return yield* runJsonInputOrBatch(
          input,
          SearchInput,
          (request) =>
            search(request).pipe(
              Effect.map((response) => ({
                search_id: response.search_id,
                session_id: response.session_id,
                results: response.results,
                result_count: response.results.length,
                warnings: response.warnings,
                usage: response.usage,
              })),
            ),
          {
            concurrency: resolvedConcurrency,
            target: (request) => ({ objective: request.objective }),
          },
        )
      }),
    ),
).pipe(Command.withDescription("Run one or more Parallel web searches"))

export const extractCommand = Command.make(
  "extract",
  { input: inputArg, output: outputOption, concurrency: concurrencyOption },
  ({ input, output, concurrency }) =>
    executeWithOutput(
      "extract",
      output,
      Effect.gen(function* () {
        const resolvedConcurrency = yield* ensurePositiveInteger("concurrency", concurrency, 5)
        return yield* runJsonInputOrBatch(
          input,
          ExtractInput,
          (request) =>
            extract(request).pipe(
              Effect.map((response) => ({
                extract_id: response.extract_id,
                session_id: response.session_id,
                results: response.results,
                errors: response.errors,
                result_count: response.results.length,
                error_count: response.errors.length,
                warnings: response.warnings,
                usage: response.usage,
              })),
            ),
          {
            concurrency: resolvedConcurrency,
            target: (request) => ({ urls: request.urls }),
          },
        )
      }),
    ),
).pipe(Command.withDescription("Extract content from one or more URL request payloads"))

const deepResearchStart = Command.make(
  "start",
  {
    input: inputArg,
    output: outputOption,
    concurrency: concurrencyOption,
    idempotencyKey: idempotencyKeyOption,
  },
  ({ input, output, concurrency, idempotencyKey }) =>
    executeWithOutput(
      "deep-research start",
      output,
      Effect.gen(function* () {
        const resolvedConcurrency = yield* ensurePositiveInteger("concurrency", concurrency, 5)
        const baseKey = optionToUndefined(idempotencyKey)
        return yield* runJsonInputOrBatch(
          input,
          DeepResearchInput,
          (request, index) =>
            withIdempotency(
              "deep-research start",
              scopedIdempotencyKey(baseKey, index),
              request,
              createTaskRun(request, "text").pipe(Effect.map(taskStartData)),
            ),
          {
            concurrency: resolvedConcurrency,
            target: (request) => ({
              input: typeof request.input === "string" ? request.input : request.metadata,
            }),
          },
        )
      }),
    ),
).pipe(Command.withDescription("Start one or more Parallel Task API deep research runs"))

const deepResearchInspect = Command.make(
  "inspect",
  { input: inputArg, output: outputOption },
  ({ input, output }) =>
    executeWithOutput(
      "deep-research inspect",
      output,
      loadJsonInput(DeepResearchCheckInput, input).pipe(
        Effect.flatMap((request) => getTaskRun(request.run_id)),
      ),
    ),
).pipe(Command.withDescription("Inspect a Parallel Task API run without fetching results"))

const deepResearchCheck = Command.make(
  "check",
  { input: inputArg, output: outputOption },
  ({ input, output }) =>
    executeWithOutput(
      "deep-research check",
      output,
      loadJsonInput(DeepResearchCheckInput, input).pipe(Effect.flatMap(checkTaskRun)),
    ),
).pipe(Command.withDescription("Check a Parallel Task API run and fetch results when complete"))

const deepResearchWait = Command.make(
  "wait",
  { input: inputArg, output: outputOption },
  ({ input, output }) =>
    executeWithOutput(
      "deep-research wait",
      output,
      loadJsonInput(DeepResearchWaitInput, input).pipe(Effect.flatMap(waitForTaskRun)),
    ),
).pipe(Command.withDescription("Wait for an existing Parallel Task API run"))

const deepResearchEvents = Command.make(
  "events",
  { input: inputArg, output: outputOption },
  ({ input, output }) =>
    executeWithOutput(
      "deep-research events",
      output,
      loadJsonInput(DeepResearchEventsInput, input).pipe(Effect.flatMap(getTaskRunEvents)),
    ),
).pipe(Command.withDescription("Fetch Parallel Task API run SSE events"))

const deepResearchCancel = Command.make(
  "cancel",
  { input: inputArg },
  ({ input }) =>
    executeJsonCommand(
      "deep-research cancel",
      loadJsonInput(DeepResearchCheckInput, input).pipe(
        Effect.map((request) =>
          unsupportedCapability(
            "deep-research cancel",
            "cancel",
            "Parallel Task Run API does not document a task-run cancel endpoint.",
            { run_id: request.run_id },
          ),
        ),
      ),
    ),
).pipe(Command.withDescription("Report Task Run cancel capability status"))

const deepResearchRun = Command.make(
  "run",
  { input: inputArg, output: outputOption, idempotencyKey: idempotencyKeyOption },
  ({ input, output, idempotencyKey }) =>
    executeWithOutput(
      "deep-research run",
      output,
      loadJsonInput(DeepResearchInput, input).pipe(
        Effect.flatMap((request) =>
          withIdempotency(
            "deep-research run",
            optionToUndefined(idempotencyKey),
            request,
            runDeepResearch(request),
          ),
        ),
      ),
    ),
).pipe(Command.withDescription("Start a deep research run and poll until complete or timed out"))

const findAllStart = Command.make(
  "start",
  {
    input: inputArg,
    output: outputOption,
    concurrency: concurrencyOption,
    idempotencyKey: idempotencyKeyOption,
  },
  ({ input, output, concurrency, idempotencyKey }) =>
    executeWithOutput(
      "findall start",
      output,
      Effect.gen(function* () {
        const resolvedConcurrency = yield* ensurePositiveInteger("concurrency", concurrency, 5)
        const baseKey = optionToUndefined(idempotencyKey)
        return yield* runJsonInputOrBatch(
          input,
          FindAllStartInput,
          (request, index) =>
            withIdempotency(
              "findall start",
              scopedIdempotencyKey(baseKey, index),
              request,
              createFindAllRun(request).pipe(
                Effect.map((created) => ({
                  ...created,
                  lifecycle: {
                    provider_async: true,
                    supported_actions: [
                      "check",
                      "inspect",
                      "wait",
                      "events",
                      "enrich",
                      "extend",
                      "cancel",
                    ],
                  },
                  next_actions: {
                    inspect: "findall inspect",
                    check: "findall check",
                    wait: "findall wait",
                    events: "findall events",
                    enrich: "findall enrich",
                    extend: "findall extend",
                    cancel: "findall cancel",
                  },
                })),
              ),
            ),
          {
            concurrency: resolvedConcurrency,
            target: (request) => ({ objective: request.objective }),
          },
        )
      }),
    ),
).pipe(Command.withDescription("Start one or more Parallel FindAll entity discovery runs"))

const findAllInspect = Command.make(
  "inspect",
  { input: inputArg, output: outputOption },
  ({ input, output }) =>
    executeWithOutput(
      "findall inspect",
      output,
      loadJsonInput(FindAllCheckInput, input).pipe(
        Effect.flatMap((request) => getFindAllRun(request.findall_id)),
      ),
    ),
).pipe(Command.withDescription("Inspect a Parallel FindAll run"))

const findAllCheck = Command.make(
  "check",
  { input: inputArg, output: outputOption },
  ({ input, output }) =>
    executeWithOutput(
      "findall check",
      output,
      loadJsonInput(FindAllCheckInput, input).pipe(Effect.flatMap(checkFindAllRun)),
    ),
).pipe(Command.withDescription("Check a Parallel FindAll run and fetch candidates when complete"))

const findAllWait = Command.make(
  "wait",
  { input: inputArg, output: outputOption },
  ({ input, output }) =>
    executeWithOutput(
      "findall wait",
      output,
      loadJsonInput(FindAllWaitInput, input).pipe(Effect.flatMap(waitForFindAllRun)),
    ),
).pipe(Command.withDescription("Wait for an existing Parallel FindAll run"))

const findAllEvents = Command.make(
  "events",
  { input: inputArg, output: outputOption },
  ({ input, output }) =>
    executeWithOutput(
      "findall events",
      output,
      loadJsonInput(FindAllEventsInput, input).pipe(Effect.flatMap(getFindAllEvents)),
    ),
).pipe(Command.withDescription("Fetch Parallel FindAll SSE events"))

const findAllCancel = Command.make(
  "cancel",
  { input: inputArg, idempotencyKey: idempotencyKeyOption },
  ({ input, idempotencyKey }) =>
    executeJsonCommand(
      "findall cancel",
      loadJsonInput(FindAllCancelInput, input).pipe(
        Effect.flatMap((request) =>
          withIdempotency(
            "findall cancel",
            optionToUndefined(idempotencyKey),
            request,
            cancelFindAllRun(request.findall_id),
          ),
        ),
      ),
    ),
).pipe(Command.withDescription("Cancel a Parallel FindAll run"))

const findAllEntitySearch = Command.make(
  "entity-search",
  { input: inputArg, output: outputOption, concurrency: concurrencyOption },
  ({ input, output, concurrency }) =>
    executeWithOutput(
      "findall entity-search",
      output,
      Effect.gen(function* () {
        const resolvedConcurrency = yield* ensurePositiveInteger("concurrency", concurrency, 5)
        return yield* runJsonInputOrBatch(
          input,
          FindAllEntitySearchInput,
          (request) =>
            entitySearch(request).pipe(
              Effect.map((response) => ({
                entity_set_id: response.entity_set_id,
                entities: response.entities,
                entity_count: response.entities.length,
              })),
            ),
          {
            concurrency: resolvedConcurrency,
            target: (request) => ({
              entity_type: request.entity_type,
              objective: request.objective,
            }),
          },
        )
      }),
    ),
).pipe(Command.withDescription("Run a synchronous FindAll entity search for people or companies"))

const findAllEnrich = Command.make(
  "enrich",
  { input: inputArg, output: outputOption, idempotencyKey: idempotencyKeyOption },
  ({ input, output, idempotencyKey }) =>
    executeWithOutput(
      "findall enrich",
      output,
      loadJsonInput(FindAllEnrichInput, input).pipe(
        Effect.flatMap((request) =>
          withIdempotency(
            "findall enrich",
            optionToUndefined(idempotencyKey),
            request,
            enrichFindAllRun(request),
          ),
        ),
      ),
    ),
).pipe(Command.withDescription("Add a Task-powered enrichment to an existing FindAll run"))

const findAllExtend = Command.make(
  "extend",
  { input: inputArg, output: outputOption, idempotencyKey: idempotencyKeyOption },
  ({ input, output, idempotencyKey }) =>
    executeWithOutput(
      "findall extend",
      output,
      loadJsonInput(FindAllExtendInput, input).pipe(
        Effect.flatMap((request) =>
          withIdempotency(
            "findall extend",
            optionToUndefined(idempotencyKey),
            request,
            extendFindAllRun(request),
          ),
        ),
      ),
    ),
).pipe(Command.withDescription("Increase the match limit of an existing FindAll run"))

const monitorCreate = Command.make(
  "create",
  {
    input: inputArg,
    output: outputOption,
    concurrency: concurrencyOption,
    idempotencyKey: idempotencyKeyOption,
  },
  ({ input, output, concurrency, idempotencyKey }) =>
    executeWithOutput(
      "monitors create",
      output,
      Effect.gen(function* () {
        const resolvedConcurrency = yield* ensurePositiveInteger("concurrency", concurrency, 5)
        const baseKey = optionToUndefined(idempotencyKey)
        return yield* runJsonInputOrBatch(
          input,
          MonitorCreateInput,
          (request, index) =>
            withIdempotency(
              "monitors create",
              scopedIdempotencyKey(baseKey, index),
              request,
              createMonitor(request).pipe(Effect.map(normalizeMonitor)),
            ),
          {
            concurrency: resolvedConcurrency,
            target: (request) => ({
              query: request.query,
              task_run_id: request.task_run_id,
              type: request.type,
            }),
          },
        )
      }),
    ),
).pipe(Command.withDescription("Create one or more Parallel monitors"))

const monitorList = Command.make("list", { output: outputOption }, ({ output }) =>
  executeWithOutput("monitors list", output, listMonitors),
).pipe(Command.withDescription("List Parallel monitors"))

const monitorInspect = Command.make(
  "inspect",
  { input: inputArg, output: outputOption },
  ({ input, output }) =>
    executeWithOutput(
      "monitors inspect",
      output,
      loadJsonInput(MonitorIdInput, input).pipe(
        Effect.flatMap((request) => getMonitor(request.monitor_id)),
      ),
    ),
).pipe(Command.withDescription("Inspect a Parallel monitor"))

const monitorEvents = Command.make(
  "events",
  { input: inputArg, output: outputOption },
  ({ input, output }) =>
    executeWithOutput(
      "monitors events",
      output,
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

const monitorCancel = Command.make(
  "cancel",
  { input: inputArg, idempotencyKey: idempotencyKeyOption },
  ({ input, idempotencyKey }) =>
    executeJsonCommand(
      "monitors cancel",
      loadJsonInput(MonitorIdInput, input).pipe(
        Effect.flatMap((request) =>
          withIdempotency(
            "monitors cancel",
            optionToUndefined(idempotencyKey),
            request,
            deleteMonitor(request.monitor_id),
          ),
        ),
      ),
    ),
).pipe(Command.withDescription("Delete a monitor to stop future executions"))

const monitorDelete = Command.make(
  "delete",
  { input: inputArg, idempotencyKey: idempotencyKeyOption },
  ({ input, idempotencyKey }) =>
    executeJsonCommand(
      "monitors delete",
      loadJsonInput(MonitorIdInput, input).pipe(
        Effect.flatMap((request) =>
          withIdempotency(
            "monitors delete",
            optionToUndefined(idempotencyKey),
            request,
            deleteMonitor(request.monitor_id),
          ),
        ),
      ),
    ),
).pipe(Command.withDescription("Alias for monitors cancel"))

const monitorTrigger = Command.make(
  "trigger",
  { input: inputArg, idempotencyKey: idempotencyKeyOption },
  ({ input, idempotencyKey }) =>
    executeJsonCommand(
      "monitors trigger",
      loadJsonInput(MonitorIdInput, input).pipe(
        Effect.flatMap((request) =>
          withIdempotency(
            "monitors trigger",
            optionToUndefined(idempotencyKey),
            request,
            triggerMonitorRun(request.monitor_id),
          ),
        ),
      ),
    ),
).pipe(Command.withDescription("Enqueue a real off-schedule monitor run"))

const monitorSimulate = Command.make(
  "simulate",
  { input: inputArg },
  ({ input }) =>
    executeJsonCommand(
      "monitors simulate",
      loadJsonInput(MonitorSimulateInput, input).pipe(Effect.flatMap(simulateMonitorEvent)),
    ),
).pipe(Command.withDescription("Alias for monitors trigger; V1 removed synthetic simulate_event"))

const monitorWait = Command.make(
  "wait",
  { input: inputArg },
  ({ input }) =>
    executeJsonCommand(
      "monitors wait",
      loadJsonInput(MonitorIdInput, input).pipe(
        Effect.map((request) =>
          unsupportedCapability(
            "monitors wait",
            "wait",
            "Monitor execution is scheduled or webhook-driven; use monitors events for history/backfill.",
            { monitor_id: request.monitor_id },
          ),
        ),
      ),
    ),
).pipe(Command.withDescription("Report monitor wait capability status"))

export const deepResearchCommand = Command.make("deep-research").pipe(
  Command.withDescription("Parallel Task API deep research commands"),
  Command.withSubcommands([
    deepResearchRun,
    deepResearchStart,
    deepResearchInspect,
    deepResearchCheck,
    deepResearchWait,
    deepResearchEvents,
    deepResearchCancel,
  ]),
)

export const findAllCommand = Command.make("findall").pipe(
  Command.withDescription("Parallel FindAll entity discovery commands"),
  Command.withSubcommands([
    findAllStart,
    findAllEntitySearch,
    findAllInspect,
    findAllCheck,
    findAllWait,
    findAllEvents,
    findAllEnrich,
    findAllExtend,
    findAllCancel,
  ]),
)

export const monitorsCommand = Command.make("monitors").pipe(
  Command.withDescription("Parallel monitor commands"),
  Command.withSubcommands([
    monitorCreate,
    monitorList,
    monitorInspect,
    monitorEvents,
    monitorTrigger,
    monitorWait,
    monitorCancel,
    monitorDelete,
    monitorSimulate,
  ]),
)
