import { Effect, Schema } from "effect"

import { requestJson, requestText } from "./api"
import { CommandInputError } from "./errors"
import { decodeUnknownJsonText } from "./json"
import { parseServerSentEvents } from "./sse"

export const BETA_HEADER = "parallel-beta"
export const TASK_EVENTS_BETA = "events-sse-2025-07-24"

const JsonRecord = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const StringRecord = Schema.Record({ key: Schema.String, value: Schema.String })
const OptionalStringArray = Schema.optional(Schema.Array(Schema.String))

const Warning = Schema.Struct({
  type: Schema.optional(Schema.String),
  message: Schema.String,
  detail: Schema.optional(Schema.NullishOr(JsonRecord)),
})

const UsageItem = Schema.Struct({
  name: Schema.String,
  count: Schema.Number,
})

const FetchPolicy = Schema.Struct({
  max_age_seconds: Schema.optional(Schema.Number),
  timeout_seconds: Schema.optional(Schema.Number),
  disable_cache_fallback: Schema.optional(Schema.Boolean),
})

const ExcerptSettings = Schema.Struct({
  max_chars_per_result: Schema.optional(Schema.Number),
})

const SourcePolicy = Schema.Struct({
  include_domains: OptionalStringArray,
  exclude_domains: OptionalStringArray,
  after_date: Schema.optional(Schema.String),
})

const AdvancedSearchSettings = Schema.Struct({
  source_policy: Schema.optional(SourcePolicy),
  fetch_policy: Schema.optional(FetchPolicy),
  excerpt_settings: Schema.optional(ExcerptSettings),
  location: Schema.optional(Schema.String),
  max_results: Schema.optional(Schema.Number),
})

const AdvancedExtractSettings = Schema.Struct({
  fetch_policy: Schema.optional(FetchPolicy),
  excerpt_settings: Schema.optional(ExcerptSettings),
  full_content: Schema.optional(Schema.Union(
    Schema.Boolean,
    Schema.Struct({
      max_chars_per_result: Schema.optional(Schema.Number),
    }),
  )),
})

export const SearchMode = Schema.Literal(
  "turbo",
  "fast",
  "basic",
  "advanced",
  "one-shot",
  "agentic",
)

export const SearchInput = Schema.Struct({
  objective: Schema.optional(Schema.String),
  search_queries: OptionalStringArray,
  mode: Schema.optional(SearchMode),
  max_results: Schema.optional(Schema.Number),
  max_chars_total: Schema.optional(Schema.Number),
  session_id: Schema.optional(Schema.String),
  client_model: Schema.optional(Schema.String),
  allowed_domains: OptionalStringArray,
  disallowed_domains: OptionalStringArray,
  include_domains: OptionalStringArray,
  exclude_domains: OptionalStringArray,
  after_date: Schema.optional(Schema.String),
  location: Schema.optional(Schema.String),
  fetch_policy: Schema.optional(FetchPolicy),
  excerpt_settings: Schema.optional(ExcerptSettings),
  source_policy: Schema.optional(SourcePolicy),
  advanced_settings: Schema.optional(AdvancedSearchSettings),
})

export const ExtractInput = Schema.Struct({
  urls: Schema.Array(Schema.String),
  objective: Schema.optional(Schema.String),
  search_queries: OptionalStringArray,
  max_chars_total: Schema.optional(Schema.Number),
  session_id: Schema.optional(Schema.String),
  client_model: Schema.optional(Schema.String),
  excerpts: Schema.optional(Schema.Union(Schema.Boolean, ExcerptSettings)),
  full_content: Schema.optional(Schema.Union(
    Schema.Boolean,
    Schema.Struct({
      max_chars_per_result: Schema.optional(Schema.Number),
    }),
  )),
  fetch_policy: Schema.optional(FetchPolicy),
  excerpt_settings: Schema.optional(ExcerptSettings),
  advanced_settings: Schema.optional(AdvancedExtractSettings),
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
  location: Schema.optional(Schema.String),
  memory_scope_key: Schema.optional(Schema.String),
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

const ExcludeCandidate = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
})

const JsonOutputSchema = Schema.Struct({
  type: Schema.Literal("json"),
  json_schema: JsonRecord,
})

const FindAllEnrichmentV1 = Schema.Struct({
  processor: Schema.optional(Schema.String),
  output_schema: JsonOutputSchema,
})

const FindAllEnrichmentLegacy = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  processor: Schema.optional(Schema.String),
})

const FindAllEnrichment = Schema.Union(FindAllEnrichmentV1, FindAllEnrichmentLegacy)

export const FindAllStartInput = Schema.Struct({
  objective: Schema.String,
  entity_type: Schema.optional(Schema.String),
  match_conditions: Schema.optional(Schema.Array(MatchCondition)),
  generator: Schema.optional(Schema.Literal("preview", "base", "core", "pro")),
  match_limit: Schema.optional(Schema.Number),
  exclude_list: Schema.optional(Schema.Array(ExcludeCandidate)),
  enrichments: Schema.optional(Schema.Array(FindAllEnrichment)),
  metadata: Schema.optional(JsonRecord),
  webhook_url: Schema.optional(Schema.String),
  memory_scope_key: Schema.optional(Schema.String),
})

export const FindAllEntitySearchInput = Schema.Struct({
  entity_type: Schema.Literal("people", "companies"),
  objective: Schema.String,
  match_limit: Schema.optional(Schema.Number),
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

export const FindAllEnrichInput = Schema.Struct({
  findall_id: Schema.String,
  processor: Schema.optional(Schema.String),
  output_schema: JsonOutputSchema,
})

export const FindAllExtendInput = Schema.Struct({
  findall_id: Schema.String,
  additional_match_limit: Schema.Number,
})

export const MonitorCreateInput = Schema.Struct({
  type: Schema.optional(Schema.Literal("event_stream", "snapshot")),
  query: Schema.optional(Schema.String),
  cadence: Schema.optional(Schema.Literal("hourly", "daily", "weekly", "every_two_weeks")),
  frequency: Schema.optional(Schema.String),
  processor: Schema.optional(Schema.Literal("lite", "base")),
  webhook_url: Schema.optional(Schema.String),
  metadata: Schema.optional(StringRecord),
  task_run_id: Schema.optional(Schema.String),
  output_schema: Schema.optional(JsonOutputSchema),
  include_backfill: Schema.optional(Schema.Boolean),
  location: Schema.optional(Schema.String),
  include_domains: OptionalStringArray,
  exclude_domains: OptionalStringArray,
  after_date: Schema.optional(Schema.String),
  memory_scope_key: Schema.optional(Schema.String),
})

export const MonitorEventsInput = Schema.Struct({
  monitor_id: Schema.String,
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  include_completions: Schema.optional(Schema.Boolean),
  event_group_id: Schema.optional(Schema.String),
  lookback: Schema.optional(Schema.String),
  lookback_period: Schema.optional(Schema.String),
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
    title: Schema.optional(Schema.NullOr(Schema.String)),
    publish_date: Schema.optional(Schema.NullOr(Schema.String)),
    excerpts: Schema.Array(Schema.String),
  })),
  warnings: Schema.optional(Schema.NullOr(Schema.Array(Warning))),
  usage: Schema.optional(Schema.NullOr(Schema.Array(UsageItem))),
  session_id: Schema.String,
})

const ExtractResponse = Schema.Struct({
  extract_id: Schema.String,
  results: Schema.Array(Schema.Struct({
    url: Schema.String,
    title: Schema.optional(Schema.NullOr(Schema.String)),
    publish_date: Schema.optional(Schema.NullOr(Schema.String)),
    excerpts: Schema.Array(Schema.String),
    full_content: Schema.optional(Schema.NullOr(Schema.String)),
  })),
  errors: Schema.Array(Schema.Struct({
    url: Schema.String,
    error_type: Schema.optional(Schema.String),
    http_status_code: Schema.optional(Schema.NullOr(Schema.Number)),
    content: Schema.optional(Schema.NullOr(Schema.String)),
  })),
  warnings: Schema.optional(Schema.NullOr(Schema.Array(Warning))),
  usage: Schema.optional(Schema.NullOr(Schema.Array(UsageItem))),
  session_id: Schema.String,
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
  metadata: Schema.optional(Schema.NullOr(JsonRecord)),
  created_at: Schema.optional(Schema.NullOr(Schema.String)),
  modified_at: Schema.optional(Schema.NullOr(Schema.String)),
  warnings: Schema.optional(Schema.NullOr(Schema.Array(Warning))),
  error: Schema.optional(Schema.NullOr(Schema.Struct({
    ref_id: Schema.optional(Schema.String),
    code: Schema.optional(Schema.String),
    message: Schema.String,
    detail: Schema.optional(Schema.NullOr(JsonRecord)),
  }))),
})

export type TaskRun = typeof TaskRun.Type

const BasisItem = Schema.Struct({
  field: Schema.String,
  reasoning: Schema.String,
  confidence: Schema.optional(Schema.NullOr(Schema.String)),
  citations: Schema.optional(Schema.Array(Schema.Struct({
    url: Schema.String,
    title: Schema.optional(Schema.NullOr(Schema.String)),
    excerpts: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  }))),
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
  enrichments: Schema.optional(Schema.NullOr(Schema.Array(FindAllEnrichmentV1))),
  generator: Schema.optional(Schema.Literal("preview", "base", "core", "pro")),
  match_limit: Schema.optional(Schema.NullOr(Schema.Number)),
})

const FindAllRun = Schema.Struct({
  findall_id: Schema.String,
  status: Schema.Struct({
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
    metrics: Schema.Struct({
      generated_candidates_count: Schema.Number,
      matched_candidates_count: Schema.Number,
    }),
    termination_reason: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  generator: Schema.String,
  metadata: Schema.optional(Schema.NullOr(JsonRecord)),
  created_at: Schema.optional(Schema.NullOr(Schema.String)),
  modified_at: Schema.optional(Schema.NullOr(Schema.String)),
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

const FindAllSchemaResponse = Schema.Struct({
  objective: Schema.String,
  entity_type: Schema.String,
  match_conditions: Schema.Array(MatchCondition),
  enrichments: Schema.optional(Schema.NullOr(Schema.Array(FindAllEnrichmentV1))),
  generator: Schema.optional(Schema.Literal("preview", "base", "core", "pro")),
  match_limit: Schema.optional(Schema.NullOr(Schema.Number)),
})

const EntitySearchResponse = Schema.Struct({
  entity_set_id: Schema.String,
  entities: Schema.Array(Schema.Struct({
    name: Schema.String,
    url: Schema.String,
    description: Schema.String,
  })),
})

const MonitorSettings = Schema.Struct({
  query: Schema.optional(Schema.String),
  task_run_id: Schema.optional(Schema.String),
  output_schema: Schema.optional(Schema.NullOr(JsonRecord)),
  include_backfill: Schema.optional(Schema.NullOr(Schema.Boolean)),
  advanced_settings: Schema.optional(Schema.NullOr(JsonRecord)),
})

const Monitor = Schema.Struct({
  monitor_id: Schema.String,
  type: Schema.optional(Schema.Literal("event_stream", "snapshot")),
  query: Schema.optional(Schema.String),
  status: Schema.String,
  frequency: Schema.optional(Schema.String),
  cadence: Schema.optional(Schema.String),
  processor: Schema.optional(Schema.Literal("lite", "base")),
  metadata: Schema.optional(Schema.NullOr(StringRecord)),
  webhook: Schema.optional(Schema.NullOr(Schema.Struct({
    url: Schema.String,
    event_types: Schema.optional(Schema.Array(Schema.String)),
  }))),
  created_at: Schema.String,
  last_run_at: Schema.optional(Schema.NullOr(Schema.String)),
  settings: Schema.optional(MonitorSettings),
  output: Schema.optional(Schema.NullOr(JsonRecord)),
})

const MonitorEvent = JsonRecord

const MonitorEventsResponse = Schema.Struct({
  events: Schema.Array(MonitorEvent),
  has_more: Schema.optional(Schema.Boolean),
  next_cursor: Schema.optional(Schema.NullOr(Schema.String)),
  warnings: Schema.optional(Schema.NullOr(Schema.Array(Warning))),
})

const MonitorsResponse = Schema.Struct({
  monitors: Schema.Array(Monitor),
  next_cursor: Schema.optional(Schema.NullOr(Schema.String)),
})

const SEARCH_MODE_ALIASES = {
  "one-shot": "basic",
  agentic: "advanced",
} as const

const omitUndefined = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined))

const compactObject = (value: Record<string, unknown> | undefined) => {
  if (!value) {
    return undefined
  }

  const compact = omitUndefined(value)
  return Object.keys(compact).length > 0 ? compact : undefined
}

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

const ensureMatchLimit = (field: string, value: number | undefined, fallback: number) =>
  Effect.gen(function* () {
    const resolved = value ?? fallback

    if (!Number.isInteger(resolved) || resolved < 5 || resolved > 1000) {
      return yield* new CommandInputError({
        field,
        message: `${field} must be an integer between 5 and 1000`,
      })
    }

    return resolved
  })

export const isTaskInProgress = (run: Pick<TaskRun, "status" | "is_active">) =>
  run.is_active || run.status === "queued" || run.status === "running"

export const isFindAllInProgress = (run: FindAllRun) =>
  run.status.is_active || run.status.status === "queued" || run.status.status === "running"

const resolveSearchQueries = (input: typeof SearchInput.Type) =>
  Effect.gen(function* () {
    const provided = (input.search_queries ?? [])
      .map((query) => query.trim())
      .filter((query) => query.length > 0)
    const objective = input.objective?.trim()

    if (provided.length > 0) {
      return provided
    }

    if (objective && objective.length > 0) {
      return [objective]
    }

    return yield* new CommandInputError({
      field: "search_queries",
      message: "search_queries requires at least one non-empty query, or provide objective to derive one",
    })
  })

const resolveSearchMode = (mode: typeof SearchInput.Type["mode"]) => {
  if (!mode) {
    return "fast"
  }

  return mode in SEARCH_MODE_ALIASES
    ? SEARCH_MODE_ALIASES[mode as keyof typeof SEARCH_MODE_ALIASES]
    : mode
}

const resolveSourcePolicy = (input: {
  readonly source_policy?: typeof SourcePolicy.Type | undefined
  readonly advanced_settings?: { readonly source_policy?: typeof SourcePolicy.Type | undefined } | undefined
  readonly allowed_domains?: ReadonlyArray<string> | undefined
  readonly disallowed_domains?: ReadonlyArray<string> | undefined
  readonly include_domains?: ReadonlyArray<string> | undefined
  readonly exclude_domains?: ReadonlyArray<string> | undefined
  readonly after_date?: string | undefined
}) => {
  const base = input.advanced_settings?.source_policy ?? input.source_policy
  return compactObject({
    include_domains: base?.include_domains ?? input.include_domains ?? input.allowed_domains,
    exclude_domains: base?.exclude_domains ?? input.exclude_domains ?? input.disallowed_domains,
    after_date: base?.after_date ?? input.after_date,
  })
}

export const search = (input: typeof SearchInput.Type) =>
  Effect.gen(function* () {
    const searchQueries = yield* resolveSearchQueries(input)
    const sourcePolicy = resolveSourcePolicy(input)
    const advancedSettings = compactObject({
      source_policy: sourcePolicy,
      fetch_policy: compactObject(input.fetch_policy ?? input.advanced_settings?.fetch_policy),
      excerpt_settings: compactObject(input.excerpt_settings ?? input.advanced_settings?.excerpt_settings),
      location: input.location ?? input.advanced_settings?.location,
      max_results: input.max_results ?? input.advanced_settings?.max_results,
    })

    return yield* requestJson({
      method: "POST",
      path: "/v1/search",
      body: omitUndefined({
        objective: input.objective,
        search_queries: searchQueries,
        mode: resolveSearchMode(input.mode),
        max_chars_total: input.max_chars_total,
        session_id: input.session_id,
        client_model: input.client_model,
        advanced_settings: advancedSettings,
      }),
      responseSchema: SearchResponse,
    })
  })

export const extract = (input: typeof ExtractInput.Type) =>
  Effect.gen(function* () {
    if (input.urls.length === 0) {
      return yield* new CommandInputError({
        field: "urls",
        message: "urls must contain at least one URL",
      })
    }

    if (input.urls.length > 20) {
      return yield* new CommandInputError({
        field: "urls",
        message: "urls accepts at most 20 URLs per v1 extract request",
      })
    }

    if (input.objective && input.objective.length > 5000) {
      return yield* new CommandInputError({
        field: "objective",
        message: "objective must be at most 5000 characters",
      })
    }

    if (input.excerpts === false) {
      return yield* new CommandInputError({
        field: "excerpts",
        message: "v1 extract always returns excerpts; omit excerpts or pass excerpt size settings",
      })
    }

    const excerptSettings = compactObject(
      input.excerpt_settings
        ?? input.advanced_settings?.excerpt_settings
        ?? (input.excerpts && input.excerpts !== true ? input.excerpts : undefined),
    )
    const fullContent = input.full_content ?? input.advanced_settings?.full_content
    const advancedSettings = compactObject({
      fetch_policy: compactObject(input.fetch_policy ?? input.advanced_settings?.fetch_policy),
      excerpt_settings: excerptSettings,
      full_content: fullContent === false ? undefined : fullContent,
    })

    return yield* requestJson({
      method: "POST",
      path: "/v1/extract",
      body: omitUndefined({
        urls: input.urls,
        objective: input.objective,
        search_queries: input.search_queries,
        max_chars_total: input.max_chars_total,
        session_id: input.session_id,
        client_model: input.client_model,
        advanced_settings: advancedSettings,
      }),
      responseSchema: ExtractResponse,
    })
  })

export const createTaskRun = (input: typeof DeepResearchInput.Type, defaultOutput: "auto" | "text") =>
  requestJson({
    method: "POST",
    path: "/v1/tasks/runs",
    ...(input.enable_events ? { headers: { [BETA_HEADER]: TASK_EVENTS_BETA } } : {}),
    body: omitUndefined({
      input: input.input,
      processor: input.processor?.trim() || "base",
      task_spec: {
        output_schema: input.output_schema ?? { type: defaultOutput },
        ...(input.input_schema ? { input_schema: input.input_schema } : {}),
      },
      metadata: input.metadata,
      source_policy: compactObject({
        include_domains: input.allowed_domains,
        exclude_domains: input.disallowed_domains,
      }),
      advanced_settings: compactObject({
        location: input.location,
      }),
      memory_scope_key: input.memory_scope_key,
      previous_interaction_id: input.previous_interaction_id,
      enable_events: input.enable_events,
      webhook: input.webhook_url ? { url: input.webhook_url } : undefined,
    }),
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
    body: { objective },
    responseSchema: FindAllIngestResponse,
  })

const toEnrichmentPayload = (
  enrichment: typeof FindAllEnrichment.Type,
): {
  readonly processor: string
  readonly output_schema: typeof JsonOutputSchema.Type
} => {
  if ("output_schema" in enrichment) {
    return {
      processor: enrichment.processor ?? "core",
      output_schema: enrichment.output_schema,
    }
  }

  return {
    processor: enrichment.processor ?? "core",
    output_schema: {
      type: "json",
      json_schema: {
        type: "object",
        properties: {
          [enrichment.name]: {
            type: "string",
            description: enrichment.description,
          },
        },
        required: [enrichment.name],
        additionalProperties: false,
      },
    },
  }
}

export const enrichFindAllRun = (input: typeof FindAllEnrichInput.Type) =>
  requestJson({
    method: "POST",
    path: `/v1beta/findall/runs/${encodeURIComponent(input.findall_id)}/enrich`,
    body: omitUndefined({
      processor: input.processor ?? "core",
      output_schema: input.output_schema,
    }),
    responseSchema: FindAllSchemaResponse,
  }).pipe(
    Effect.map((schema) => ({
      findall_id: input.findall_id,
      schema,
    })),
  )

export const extendFindAllRun = (input: typeof FindAllExtendInput.Type) =>
  Effect.gen(function* () {
    if (!Number.isInteger(input.additional_match_limit) || input.additional_match_limit <= 0) {
      return yield* new CommandInputError({
        field: "additional_match_limit",
        message: "additional_match_limit must be an integer greater than 0",
      })
    }

    const schema = yield* requestJson({
      method: "POST",
      path: `/v1beta/findall/runs/${encodeURIComponent(input.findall_id)}/extend`,
      body: { additional_match_limit: input.additional_match_limit },
      responseSchema: FindAllSchemaResponse,
    })

    return {
      findall_id: input.findall_id,
      schema,
    }
  })

export const entitySearch = (input: typeof FindAllEntitySearchInput.Type) =>
  Effect.gen(function* () {
    const matchLimit = yield* ensureMatchLimit("match_limit", input.match_limit, 100)

    return yield* requestJson({
      method: "POST",
      path: "/v1beta/findall/entity-search",
      body: {
        entity_type: input.entity_type,
        objective: input.objective,
        match_limit: matchLimit,
      },
      responseSchema: EntitySearchResponse,
    })
  })

export const createFindAllRun = (input: typeof FindAllStartInput.Type) =>
  Effect.gen(function* () {
    const inferred =
      input.match_conditions && input.match_conditions.length > 0
        ? undefined
        : yield* ingestFindAll(input.objective)

    const entityType = input.entity_type ?? inferred?.entity_type ?? "entities"
    const matchConditions = input.match_conditions ?? inferred?.match_conditions
    const matchLimit = yield* ensureMatchLimit("match_limit", input.match_limit, 10)

    if (!matchConditions || matchConditions.length === 0) {
      return yield* new CommandInputError({
        field: "match_conditions",
        message: "match_conditions are required when ingest does not infer them",
      })
    }

    const created = yield* requestJson({
      method: "POST",
      path: "/v1beta/findall/runs",
      body: omitUndefined({
        objective: input.objective,
        entity_type: entityType,
        match_conditions: matchConditions,
        generator: input.generator ?? inferred?.generator ?? "core",
        match_limit: matchLimit,
        exclude_list: input.exclude_list,
        metadata: input.metadata,
        webhook: input.webhook_url ? { url: input.webhook_url } : undefined,
        memory_scope_key: input.memory_scope_key,
      }),
      responseSchema: Schema.Struct({ findall_id: Schema.String }),
    })

    const enrichments = input.enrichments ?? inferred?.enrichments ?? []
    const appliedEnrichments = yield* Effect.forEach(
      enrichments,
      (enrichment) =>
        enrichFindAllRun({
          findall_id: created.findall_id,
          ...toEnrichmentPayload(enrichment),
        }).pipe(Effect.map((result) => result.schema)),
      { concurrency: 1 },
    )

    return {
      findall_id: created.findall_id,
      entity_type: entityType,
      match_conditions: matchConditions,
      generator: input.generator ?? inferred?.generator ?? "core",
      match_limit: matchLimit,
      ...(appliedEnrichments.length > 0 ? { enrichments: appliedEnrichments } : {}),
    }
  })

export const getFindAllRun = (findallId: string) =>
  requestJson({
    method: "GET",
    path: `/v1beta/findall/runs/${encodeURIComponent(findallId)}`,
    responseSchema: FindAllRun,
  })

export const getFindAllResult = (findallId: string) =>
  requestJson({
    method: "GET",
    path: `/v1beta/findall/runs/${encodeURIComponent(findallId)}/result`,
    responseSchema: FindAllRunResult,
  })

export const getFindAllEvents = (input: typeof FindAllEventsInput.Type) =>
  requestText({
    method: "GET",
    path: `/v1beta/findall/runs/${encodeURIComponent(input.findall_id)}/events`,
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

const cadenceToFrequency = (cadence: NonNullable<typeof MonitorCreateInput.Type["cadence"]>) => {
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
  Effect.gen(function* () {
    const type = input.type ?? (input.task_run_id ? "snapshot" : "event_stream")
    const frequency = input.frequency ?? (input.cadence ? cadenceToFrequency(input.cadence) : undefined)

    if (!frequency) {
      return yield* new CommandInputError({
        field: "frequency",
        message: "frequency or cadence is required",
      })
    }

    const sourcePolicy = compactObject({
      include_domains: input.include_domains,
      exclude_domains: input.exclude_domains,
      after_date: input.after_date,
    })
    const advancedSettings = compactObject({
      source_policy: sourcePolicy,
      location: input.location,
    })

    const settings = type === "snapshot"
      ? (() => {
          const taskRunId = input.task_run_id
          if (!taskRunId) {
            return undefined
          }

          return { task_run_id: taskRunId }
        })()
      : compactObject({
          query: input.query,
          output_schema: input.output_schema,
          include_backfill: input.include_backfill,
          advanced_settings: advancedSettings,
        })

    if (type === "snapshot" && !input.task_run_id) {
      return yield* new CommandInputError({
        field: "task_run_id",
        message: "task_run_id is required for snapshot monitors",
      })
    }

    if (type === "event_stream" && !input.query) {
      return yield* new CommandInputError({
        field: "query",
        message: "query is required for event_stream monitors",
      })
    }

    return yield* requestJson({
      method: "POST",
      path: "/v1/monitors",
      body: omitUndefined({
        type,
        frequency,
        processor: input.processor ?? "lite",
        settings,
        webhook: input.webhook_url
          ? { url: input.webhook_url, event_types: ["monitor.event.detected"] }
          : undefined,
        metadata: input.metadata,
        memory_scope_key: input.memory_scope_key,
      }),
      responseSchema: Monitor,
    })
  })

export const listMonitors = requestJson({
  method: "GET",
  path: "/v1/monitors",
  responseSchema: MonitorsResponse,
}).pipe(
  Effect.map((page) => ({
    monitor_count: page.monitors.length,
    monitors: page.monitors,
    ...(page.next_cursor ? { next_cursor: page.next_cursor } : {}),
  })),
)

export const getMonitor = (monitorId: string) =>
  requestJson({
    method: "GET",
    path: `/v1/monitors/${encodeURIComponent(monitorId)}`,
    responseSchema: Monitor,
  })

export const cancelMonitor = (monitorId: string) =>
  requestJson({
    method: "POST",
    path: `/v1/monitors/${encodeURIComponent(monitorId)}/cancel`,
    responseSchema: Monitor,
  }).pipe(
    Effect.map((monitor) => ({
      monitor_id: monitorId,
      cancelled: true,
      monitor,
    })),
  )

export const deleteMonitor = cancelMonitor

export const triggerMonitorRun = (monitorId: string) =>
  requestText({
    method: "POST",
    path: `/v1/monitors/${encodeURIComponent(monitorId)}/trigger`,
  }).pipe(
    Effect.map(() => ({
      monitor_id: monitorId,
      triggered: true,
    })),
  )

export const simulateMonitorEvent = (input: typeof MonitorSimulateInput.Type) =>
  triggerMonitorRun(input.monitor_id).pipe(
    Effect.map((result) => ({
      ...result,
      simulated: false,
      event_type: input.event_type,
      note: "Monitor V1 removed simulate_event; this enqueues a real off-schedule run via POST /v1/monitors/{id}/trigger.",
    })),
  )

export const listMonitorEvents = (input: typeof MonitorEventsInput.Type) =>
  requestJson({
    method: "GET",
    path: `/v1/monitors/${encodeURIComponent(input.monitor_id)}/events`,
    query: {
      ...(input.event_group_id ? { event_group_id: input.event_group_id } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.limit === undefined ? {} : { limit: String(input.limit) }),
      ...(input.include_completions === undefined
        ? {}
        : { include_completions: String(input.include_completions) }),
    },
    responseSchema: MonitorEventsResponse,
  })
