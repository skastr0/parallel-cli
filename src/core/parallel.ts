import { Effect, Schema } from "effect"

import { requestJson, requestText } from "./api"
import { CommandInputError } from "./errors"
import { decodeUnknownJsonText } from "./json"
import { parseServerSentEvents } from "./sse"

export const BETA_HEADER = "parallel-beta"
export const SEARCH_EXTRACT_BETA = "search-extract-2025-10-10"
export const FINDALL_BETA = "findall-2025-09-15"
export const TASK_EVENTS_BETA = "events-sse-2025-07-24"

const JsonRecord = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const StringRecord = Schema.Record({ key: Schema.String, value: Schema.String })
const OptionalStringArray = Schema.optional(Schema.Array(Schema.String))

const Warning = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
})

const UsageItem = Schema.Struct({
  name: Schema.String,
  count: Schema.Number,
})

export const SearchInput = Schema.Struct({
  objective: Schema.String,
  search_queries: OptionalStringArray,
  mode: Schema.optional(Schema.Literal("one-shot", "agentic")),
  max_results: Schema.optional(Schema.Number),
  allowed_domains: OptionalStringArray,
  disallowed_domains: OptionalStringArray,
})

export const ExtractInput = Schema.Struct({
  urls: Schema.Array(Schema.String),
  objective: Schema.optional(Schema.String),
  excerpts: Schema.optional(Schema.Union(Schema.Boolean, Schema.Struct({
    max_chars_per_result: Schema.optional(Schema.Number),
  }))),
  full_content: Schema.optional(Schema.Boolean),
})

export const TaskSchemaSpec = Schema.Union(
  Schema.String,
  Schema.Struct({
    type: Schema.Literal("auto"),
  }),
  Schema.Struct({
    type: Schema.Literal("text"),
    description: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("json"),
    json_schema: Schema.optional(JsonRecord),
  }),
)

export const TaskInputSchemaSpec = Schema.Union(
  Schema.String,
  Schema.Struct({
    type: Schema.Literal("text"),
    description: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("json"),
    json_schema: JsonRecord,
  }),
)

export const DeepResearchInput = Schema.Struct({
  input: Schema.Union(Schema.String, JsonRecord),
  processor: Schema.optional(Schema.String),
  output_schema: Schema.optional(TaskSchemaSpec),
  input_schema: Schema.optional(TaskInputSchemaSpec),
  metadata: Schema.optional(JsonRecord),
  allowed_domains: OptionalStringArray,
  disallowed_domains: OptionalStringArray,
  previous_interaction_id: Schema.optional(Schema.String),
  enable_events: Schema.optional(Schema.Boolean),
  webhook_url: Schema.optional(Schema.String),
  max_wait_seconds: Schema.optional(Schema.Number),
  poll_interval_seconds: Schema.optional(Schema.Number),
})

export const DeepResearchCheckInput = Schema.Struct({
  run_id: Schema.String,
  timeout_seconds: Schema.optional(Schema.Number),
})

export const DeepResearchWaitInput = Schema.Struct({
  run_id: Schema.String,
  max_wait_seconds: Schema.optional(Schema.Number),
  poll_interval_seconds: Schema.optional(Schema.Number),
  timeout_seconds: Schema.optional(Schema.Number),
})

export const DeepResearchEventsInput = Schema.Struct({
  run_id: Schema.String,
  timeout_seconds: Schema.optional(Schema.Number),
  last_event_id: Schema.optional(Schema.String),
})

const MatchCondition = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
})

export const FindAllStartInput = Schema.Struct({
  objective: Schema.String,
  entity_type: Schema.optional(Schema.String),
  match_conditions: Schema.optional(Schema.Array(MatchCondition)),
  generator: Schema.optional(Schema.Literal("preview", "base", "core", "pro")),
  match_limit: Schema.optional(Schema.Number),
  exclude_list: OptionalStringArray,
  enrichments: Schema.optional(Schema.Array(Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    processor: Schema.optional(Schema.String),
  }))),
})

export const FindAllCheckInput = Schema.Struct({
  findall_id: Schema.String,
})

export const FindAllWaitInput = Schema.Struct({
  findall_id: Schema.String,
  max_wait_seconds: Schema.optional(Schema.Number),
  poll_interval_seconds: Schema.optional(Schema.Number),
})

export const FindAllEventsInput = Schema.Struct({
  findall_id: Schema.String,
  timeout_seconds: Schema.optional(Schema.Number),
  last_event_id: Schema.optional(Schema.String),
})

export const FindAllCancelInput = Schema.Struct({
  findall_id: Schema.String,
})

export const MonitorCreateInput = Schema.Struct({
  query: Schema.String,
  cadence: Schema.Literal("hourly", "daily", "weekly", "every_two_weeks"),
  webhook_url: Schema.optional(Schema.String),
  metadata: Schema.optional(StringRecord),
})

export const MonitorEventsInput = Schema.Struct({
  monitor_id: Schema.String,
  lookback: Schema.optional(Schema.String),
  lookback_period: Schema.optional(Schema.String),
  event_group_id: Schema.optional(Schema.String),
})

export const MonitorIdInput = Schema.Struct({
  monitor_id: Schema.String,
})

export const MonitorSimulateInput = Schema.Struct({
  monitor_id: Schema.String,
  event_type: Schema.optional(Schema.Literal(
    "monitor.event.detected",
    "monitor.execution.completed",
    "monitor.execution.failed",
  )),
})

const SearchResponse = Schema.Struct({
  search_id: Schema.String,
  results: Schema.Array(Schema.Struct({
    url: Schema.String,
    title: Schema.String,
    publish_date: Schema.optional(Schema.String),
    author: Schema.optional(Schema.String),
    excerpts: Schema.Array(Schema.String),
  })),
  warnings: Schema.optional(Schema.Array(Warning)),
  usage: Schema.optional(Schema.Array(UsageItem)),
})

const ExtractResponse = Schema.Struct({
  extract_id: Schema.String,
  results: Schema.Array(Schema.Struct({
    url: Schema.String,
    title: Schema.String,
    publish_date: Schema.optional(Schema.String),
    excerpts: Schema.optional(Schema.Array(Schema.String)),
    full_content: Schema.optional(Schema.NullOr(Schema.String)),
  })),
  errors: Schema.Array(JsonRecord),
  warnings: Schema.optional(Schema.Array(Warning)),
  usage: Schema.optional(Schema.Array(UsageItem)),
})

export const TaskRun = Schema.Struct({
  run_id: Schema.String,
  status: Schema.Literal(
    "queued",
    "action_required",
    "running",
    "completed",
    "failed",
    "cancelling",
    "cancelled",
  ),
  is_active: Schema.Boolean,
  processor: Schema.String,
  interaction_id: Schema.optional(Schema.String),
  metadata: Schema.optional(JsonRecord),
  created_at: Schema.String,
  modified_at: Schema.String,
  warnings: Schema.optional(Schema.Array(Warning)),
  error: Schema.optional(Schema.Struct({
    code: Schema.String,
    message: Schema.String,
  })),
})

export type TaskRun = typeof TaskRun.Type

const BasisItem = Schema.Struct({
  field: Schema.String,
  reasoning: Schema.String,
  confidence: Schema.Literal("high", "medium", "low"),
  citations: Schema.Array(Schema.Struct({
    url: Schema.String,
    title: Schema.String,
    excerpts: Schema.Array(Schema.String),
  })),
})

const TaskRunResult = Schema.Struct({
  run: TaskRun,
  output: Schema.Struct({
    content: Schema.Unknown,
    type: Schema.Literal("text", "json"),
    output_schema: Schema.optional(Schema.NullishOr(Schema.Unknown)),
    basis: Schema.optional(Schema.Array(BasisItem)),
  }),
})

const FindAllIngestResponse = Schema.Struct({
  objective: Schema.String,
  entity_type: Schema.String,
  match_conditions: Schema.Array(MatchCondition),
})

const FindAllRun = Schema.Struct({
  findall_id: Schema.String,
  status: Schema.Struct({
    status: Schema.Literal("queued", "running", "completed", "failed", "cancelled"),
    is_active: Schema.Boolean,
    metrics: Schema.Struct({
      generated_candidates_count: Schema.Number,
      matched_candidates_count: Schema.Number,
    }),
  }),
  generator: Schema.String,
  metadata: Schema.optional(StringRecord),
  created_at: Schema.String,
  modified_at: Schema.String,
})

export type FindAllRun = typeof FindAllRun.Type

const FindAllRunResult = Schema.Struct({
  findall_id: Schema.String,
  status: FindAllRun.fields.status,
  candidates: Schema.Array(Schema.Struct({
    candidate_id: Schema.String,
    name: Schema.String,
    url: Schema.String,
    description: Schema.String,
    match_status: Schema.Literal("matched", "unmatched", "generated"),
    output: JsonRecord,
    basis: Schema.Array(BasisItem),
  })),
})

const Monitor = Schema.Struct({
  monitor_id: Schema.String,
  query: Schema.String,
  status: Schema.String,
  frequency: Schema.optional(Schema.String),
  cadence: Schema.optional(Schema.String),
  metadata: Schema.optional(StringRecord),
  webhook: Schema.optional(Schema.Struct({
    url: Schema.String,
    event_types: Schema.Array(Schema.String),
  })),
  created_at: Schema.String,
  last_run_at: Schema.optional(Schema.String),
})

const MonitorEvent = JsonRecord

const MonitorEventsResponse = Schema.Struct({
  events: Schema.Array(MonitorEvent),
  has_more: Schema.Boolean,
  next_cursor: Schema.optional(Schema.String),
})

const EventGroupResponse = Schema.Struct({
  events: Schema.Array(MonitorEvent),
})

const MonitorsResponse = Schema.Array(Monitor)

export const ensurePositiveInteger = (field: string, value: number | undefined, fallback: number) =>
  Effect.gen(function* () {
    const resolved = value ?? fallback

    if (!Number.isInteger(resolved) || resolved <= 0) {
      return yield* new CommandInputError({
        field,
        message: `${field} must be a positive integer`,
      })
    }

    return resolved
  })

export const isTaskInProgress = (run: Pick<TaskRun, "status" | "is_active">) =>
  run.is_active || run.status === "queued" || run.status === "running"

export const isFindAllInProgress = (run: FindAllRun) =>
  run.status.is_active || run.status.status === "queued" || run.status.status === "running"

export const search = (input: typeof SearchInput.Type) =>
  requestJson({
    method: "POST",
    path: "/v1beta/search",
    headers: { [BETA_HEADER]: SEARCH_EXTRACT_BETA },
    body: {
      objective: input.objective,
      ...(input.search_queries ? { search_queries: input.search_queries } : {}),
      mode: input.mode ?? "one-shot",
      max_results: input.max_results ?? 10,
      ...(input.allowed_domains || input.disallowed_domains
        ? {
            source_policy: {
              ...(input.allowed_domains ? { allowed_domains: input.allowed_domains } : {}),
              ...(input.disallowed_domains ? { disallowed_domains: input.disallowed_domains } : {}),
            },
          }
        : {}),
    },
    responseSchema: SearchResponse,
  })

export const extract = (input: typeof ExtractInput.Type) =>
  requestJson({
    method: "POST",
    path: "/v1beta/extract",
    headers: { [BETA_HEADER]: SEARCH_EXTRACT_BETA },
    body: {
      urls: input.urls,
      ...(input.objective ? { objective: input.objective } : {}),
      excerpts: input.excerpts ?? true,
      full_content: input.full_content ?? false,
    },
    responseSchema: ExtractResponse,
  })

export const createTaskRun = (input: typeof DeepResearchInput.Type, defaultOutput: "auto" | "text") =>
  requestJson({
    method: "POST",
    path: "/v1/tasks/runs",
    ...(input.enable_events ? { headers: { [BETA_HEADER]: TASK_EVENTS_BETA } } : {}),
    body: {
      input: input.input,
      processor: input.processor?.trim() || "base",
      task_spec: {
        output_schema: input.output_schema ?? { type: defaultOutput },
        ...(input.input_schema ? { input_schema: input.input_schema } : {}),
      },
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.allowed_domains || input.disallowed_domains
        ? {
            source_policy: {
              ...(input.allowed_domains ? { include_domains: input.allowed_domains } : {}),
              ...(input.disallowed_domains ? { exclude_domains: input.disallowed_domains } : {}),
            },
          }
        : {}),
      ...(input.previous_interaction_id
        ? { previous_interaction_id: input.previous_interaction_id }
        : {}),
      ...(input.enable_events === undefined ? {} : { enable_events: input.enable_events }),
      ...(input.webhook_url ? { webhook: { url: input.webhook_url } } : {}),
    },
    responseSchema: TaskRun,
  })

export const getTaskRun = (runId: string) =>
  requestJson({
    method: "GET",
    path: `/v1/tasks/runs/${encodeURIComponent(runId)}`,
    responseSchema: TaskRun,
  })

export const getTaskResult = (runId: string, timeoutSeconds?: number) =>
  requestJson({
    method: "GET",
    path: `/v1/tasks/runs/${encodeURIComponent(runId)}/result`,
    ...(timeoutSeconds === undefined ? {} : { query: { timeout: String(timeoutSeconds) } }),
    responseSchema: TaskRunResult,
  })

export const getTaskRunEvents = (input: typeof DeepResearchEventsInput.Type) =>
  requestText({
    method: "GET",
    path: `/v1/tasks/runs/${encodeURIComponent(input.run_id)}/events`,
    headers: { [BETA_HEADER]: TASK_EVENTS_BETA },
    query: {
      ...(input.timeout_seconds === undefined ? {} : { timeout: String(input.timeout_seconds) }),
      ...(input.last_event_id ? { last_event_id: input.last_event_id } : {}),
    },
  }).pipe(
    Effect.map((text) => ({
      run_id: input.run_id,
      event_count: parseServerSentEvents(text).length,
      events: parseServerSentEvents(text),
    })),
  )

export const ingestFindAll = (objective: string) =>
  requestJson({
    method: "POST",
    path: "/v1beta/findall/ingest",
    headers: { [BETA_HEADER]: FINDALL_BETA },
    body: { objective },
    responseSchema: FindAllIngestResponse,
  })

export const createFindAllRun = (input: typeof FindAllStartInput.Type) =>
  Effect.gen(function* () {
    const inferred =
      input.match_conditions && input.match_conditions.length > 0
        ? undefined
        : yield* ingestFindAll(input.objective)

    const entityType = input.entity_type ?? inferred?.entity_type ?? "entities"
    const matchConditions = input.match_conditions ?? inferred?.match_conditions

    if (!matchConditions || matchConditions.length === 0) {
      return yield* new CommandInputError({
        field: "match_conditions",
        message: "match_conditions are required when ingest does not infer them",
      })
    }

    const created = yield* requestJson({
      method: "POST",
      path: "/v1beta/findall/runs",
      headers: { [BETA_HEADER]: FINDALL_BETA },
      body: {
        objective: input.objective,
        entity_type: entityType,
        match_conditions: matchConditions,
        generator: input.generator ?? "core",
        match_limit: input.match_limit ?? 10,
        ...(input.exclude_list ? { exclude_list: input.exclude_list } : {}),
        ...(input.enrichments ? { enrichments: input.enrichments } : {}),
      },
      responseSchema: Schema.Struct({ findall_id: Schema.String }),
    })

    return {
      ...created,
      entity_type: entityType,
      match_conditions: matchConditions,
      generator: input.generator ?? "core",
    }
  })

export const getFindAllRun = (findallId: string) =>
  requestJson({
    method: "GET",
    path: `/v1beta/findall/runs/${encodeURIComponent(findallId)}`,
    headers: { [BETA_HEADER]: FINDALL_BETA },
    responseSchema: FindAllRun,
  })

export const getFindAllResult = (findallId: string) =>
  requestJson({
    method: "GET",
    path: `/v1beta/findall/runs/${encodeURIComponent(findallId)}/result`,
    headers: { [BETA_HEADER]: FINDALL_BETA },
    responseSchema: FindAllRunResult,
  })

export const getFindAllEvents = (input: typeof FindAllEventsInput.Type) =>
  requestText({
    method: "GET",
    path: `/v1beta/findall/runs/${encodeURIComponent(input.findall_id)}/events`,
    headers: { [BETA_HEADER]: FINDALL_BETA },
    query: {
      ...(input.timeout_seconds === undefined ? {} : { timeout: String(input.timeout_seconds) }),
      ...(input.last_event_id ? { last_event_id: input.last_event_id } : {}),
    },
  }).pipe(
    Effect.map((text) => ({
      findall_id: input.findall_id,
      event_count: parseServerSentEvents(text).length,
      events: parseServerSentEvents(text),
    })),
  )

export const cancelFindAllRun = (findallId: string) =>
  requestText({
    method: "POST",
    path: `/v1beta/findall/runs/${encodeURIComponent(findallId)}/cancel`,
    headers: { [BETA_HEADER]: FINDALL_BETA },
  }).pipe(
    Effect.flatMap((text) =>
      text.trim().length === 0
        ? Effect.succeed<unknown>({})
        : decodeUnknownJsonText(text, "findall-cancel-response"),
    ),
    Effect.map((response) => ({
      findall_id: findallId,
      cancelled: true,
      response,
    })),
  )

const cadenceToFrequency = (cadence: typeof MonitorCreateInput.Type["cadence"]) => {
  switch (cadence) {
    case "hourly":
      return "1h"
    case "daily":
      return "1d"
    case "weekly":
      return "1w"
    case "every_two_weeks":
      return "2w"
  }
}

export const createMonitor = (input: typeof MonitorCreateInput.Type) =>
  requestJson({
    method: "POST",
    path: "/v1alpha/monitors",
    body: {
      query: input.query,
      frequency: cadenceToFrequency(input.cadence),
      ...(input.webhook_url
        ? { webhook: { url: input.webhook_url, event_types: ["monitor.event.detected"] } }
        : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
    responseSchema: Monitor,
  })

export const listMonitors = requestJson({
  method: "GET",
  path: "/v1alpha/monitors",
  responseSchema: MonitorsResponse,
}).pipe(
  Effect.map((monitors) => ({
    monitor_count: monitors.length,
    monitors,
  })),
)

export const getMonitor = (monitorId: string) =>
  requestJson({
    method: "GET",
    path: `/v1alpha/monitors/${encodeURIComponent(monitorId)}`,
    responseSchema: Monitor,
  })

export const deleteMonitor = (monitorId: string) =>
  requestJson({
    method: "DELETE",
    path: `/v1alpha/monitors/${encodeURIComponent(monitorId)}`,
    responseSchema: Monitor,
  }).pipe(
    Effect.map((monitor) => ({
      monitor_id: monitorId,
      cancelled: true,
      monitor,
    })),
  )

export const simulateMonitorEvent = (input: typeof MonitorSimulateInput.Type) =>
  requestText({
    method: "POST",
    path: `/v1alpha/monitors/${encodeURIComponent(input.monitor_id)}/simulate_event`,
    ...(input.event_type ? { query: { event_type: input.event_type } } : {}),
  }).pipe(
    Effect.map(() => ({
      monitor_id: input.monitor_id,
      simulated: true,
      event_type: input.event_type ?? "monitor.event.detected",
    })),
  )

export const listMonitorEvents = (input: typeof MonitorEventsInput.Type) =>
  input.event_group_id
    ? requestJson({
        method: "GET",
        path: `/v1alpha/monitors/${encodeURIComponent(input.monitor_id)}/event_groups/${encodeURIComponent(input.event_group_id)}`,
        responseSchema: EventGroupResponse,
      })
    : requestJson({
        method: "GET",
        path: `/v1alpha/monitors/${encodeURIComponent(input.monitor_id)}/events`,
        ...(input.lookback || input.lookback_period
          ? { query: { lookback_period: input.lookback_period ?? input.lookback } }
          : {}),
        responseSchema: MonitorEventsResponse,
      })
