import { Effect, Schema } from "effect"

import { requestJson } from "./api"
import { CommandInputError } from "./errors"

export const BETA_HEADER = "parallel-beta"
export const SEARCH_EXTRACT_BETA = "search-extract-2025-10-10"
export const FINDALL_BETA = "findall-2025-09-15"

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
  max_wait_seconds: Schema.optional(Schema.Number),
  poll_interval_seconds: Schema.optional(Schema.Number),
})

export const DeepResearchCheckInput = Schema.Struct({
  run_id: Schema.String,
  timeout_seconds: Schema.optional(Schema.Number),
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

export const MonitorCreateInput = Schema.Struct({
  query: Schema.String,
  cadence: Schema.Literal("hourly", "daily", "weekly"),
  webhook_url: Schema.optional(Schema.String),
  metadata: Schema.optional(StringRecord),
})

export const MonitorEventsInput = Schema.Struct({
  monitor_id: Schema.String,
  lookback: Schema.optional(Schema.String),
  event_group_id: Schema.optional(Schema.String),
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
  errors: Schema.Array(Schema.Struct({
    url: Schema.String,
    error: Schema.String,
  })),
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
  status: Schema.Literal("active", "paused", "cancelled"),
  cadence: Schema.Literal("hourly", "daily", "weekly"),
  metadata: Schema.optional(StringRecord),
  webhook: Schema.optional(Schema.Struct({
    url: Schema.String,
    event_types: Schema.Array(Schema.String),
  })),
  created_at: Schema.String,
  last_run_at: Schema.optional(Schema.String),
})

const MonitorEvent = Schema.Struct({
  type: Schema.Literal("event", "change"),
  event_group_id: Schema.optional(Schema.String),
  output: Schema.String,
  event_date: Schema.String,
  source_urls: Schema.Array(Schema.String),
})

const MonitorEventsResponse = Schema.Struct({
  events: Schema.Array(MonitorEvent),
  has_more: Schema.Boolean,
  next_cursor: Schema.optional(Schema.String),
})

const EventGroupResponse = Schema.Struct({
  events: Schema.Array(MonitorEvent),
})

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

export const createMonitor = (input: typeof MonitorCreateInput.Type) =>
  requestJson({
    method: "POST",
    path: "/v1alpha/monitors",
    body: {
      query: input.query,
      cadence: input.cadence,
      ...(input.webhook_url
        ? { webhook: { url: input.webhook_url, event_types: ["monitor.event.detected"] } }
        : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
    responseSchema: Monitor,
  })

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
        ...(input.lookback ? { query: { lookback: input.lookback } } : {}),
        responseSchema: MonitorEventsResponse,
      })
