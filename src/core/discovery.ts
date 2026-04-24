import { JSONSchema, Schema } from "effect"

import {
  DeepResearchCheckInput,
  DeepResearchEventsInput,
  DeepResearchInput,
  DeepResearchWaitInput,
  ExtractInput,
  FindAllCancelInput,
  FindAllCheckInput,
  FindAllEventsInput,
  FindAllStartInput,
  FindAllWaitInput,
  MonitorCreateInput,
  MonitorEventsInput,
  MonitorIdInput,
  MonitorSimulateInput,
  SearchInput,
} from "./parallel"

interface CommandCapability {
  readonly command: string
  readonly lifecycle: "synchronous" | "provider_async" | "scheduled_monitor" | "unsupported"
  readonly supported_actions: ReadonlyArray<string>
  readonly unsupported_actions: ReadonlyArray<{
    readonly action: string
    readonly reason: string
  }>
  readonly supports_batch: boolean
  readonly supports_artifacts: boolean
  readonly idempotency?: {
    readonly supported: boolean
    readonly scope: string
    readonly retry_behavior: string
  }
}

interface CommandExample {
  readonly name: string
  readonly input: unknown
  readonly flags?: Record<string, string | number | boolean>
}

interface CommandSpec {
  readonly command: string
  readonly schema_id: string
  readonly description: string
  readonly schema: Schema.Schema.Any
  readonly examples: ReadonlyArray<CommandExample>
  readonly capability: CommandCapability
}

const localIdempotency = {
  supported: true,
  scope: "local_success_receipt",
  retry_behavior:
    "After a successful provider submission, repeated calls with the same key and payload replay the local receipt on this machine. Provider timeout before receipt storage is not guaranteed idempotent.",
}

const syncUnsupported = [
  { action: "start", reason: "Provider endpoint completes synchronously." },
  { action: "inspect", reason: "Provider does not create a run object for this endpoint." },
  { action: "wait", reason: "Provider endpoint completes during the request." },
  { action: "cancel", reason: "Provider endpoint has no long-running job to cancel." },
  { action: "events", reason: "Provider endpoint does not expose an event stream." },
]

const taskNoCancel = [
  {
    action: "cancel",
    reason: "Parallel Task Run API does not document a task-run cancel endpoint.",
  },
]

export const commandSpecs: ReadonlyArray<CommandSpec> = [
  {
    command: "search",
    schema_id: "parallel.search.input/v1",
    description: "Run a synchronous Parallel Search request.",
    schema: SearchInput,
    examples: [
      {
        name: "agentic search",
        input: { objective: "Find official Parallel API docs", mode: "agentic", max_results: 5 },
      },
    ],
    capability: {
      command: "search",
      lifecycle: "synchronous",
      supported_actions: ["run"],
      unsupported_actions: syncUnsupported,
      supports_batch: true,
      supports_artifacts: true,
    },
  },
  {
    command: "extract",
    schema_id: "parallel.extract.input/v1",
    description: "Run a synchronous Parallel Extract request.",
    schema: ExtractInput,
    examples: [
      {
        name: "focused extraction",
        input: {
          urls: ["https://parallel.ai"],
          objective: "Extract product names and API categories",
          full_content: true,
        },
      },
    ],
    capability: {
      command: "extract",
      lifecycle: "synchronous",
      supported_actions: ["run"],
      unsupported_actions: syncUnsupported,
      supports_batch: true,
      supports_artifacts: true,
    },
  },
  {
    command: "deep-research start",
    schema_id: "parallel.deep_research.start.input/v1",
    description: "Submit a Parallel Task Run and return the run id.",
    schema: DeepResearchInput,
    examples: [
      {
        name: "evented deep research",
        input: {
          input: "Research current AI browser agents",
          processor: "base",
          enable_events: true,
        },
        flags: { idempotency_key: "research-browser-agents-2026-04-24" },
      },
    ],
    capability: {
      command: "deep-research start",
      lifecycle: "provider_async",
      supported_actions: ["start", "inspect", "check", "wait", "events"],
      unsupported_actions: taskNoCancel,
      supports_batch: true,
      supports_artifacts: true,
      idempotency: localIdempotency,
    },
  },
  {
    command: "deep-research run",
    schema_id: "parallel.deep_research.run.input/v1",
    description: "Submit a Parallel Task Run and poll until complete or timed out.",
    schema: DeepResearchInput,
    examples: [
      {
        name: "bounded wait",
        input: {
          input: "Summarize current web extraction APIs",
          processor: "core",
          max_wait_seconds: 120,
          poll_interval_seconds: 5,
        },
      },
    ],
    capability: {
      command: "deep-research run",
      lifecycle: "provider_async",
      supported_actions: ["run", "start", "inspect", "check", "wait", "events"],
      unsupported_actions: taskNoCancel,
      supports_batch: false,
      supports_artifacts: true,
      idempotency: localIdempotency,
    },
  },
  {
    command: "deep-research check",
    schema_id: "parallel.deep_research.check.input/v1",
    description: "Inspect a Task Run and fetch results when complete.",
    schema: DeepResearchCheckInput,
    examples: [{ name: "check run", input: { run_id: "trun_..." } }],
    capability: {
      command: "deep-research check",
      lifecycle: "provider_async",
      supported_actions: ["inspect", "check"],
      unsupported_actions: taskNoCancel,
      supports_batch: false,
      supports_artifacts: true,
    },
  },
  {
    command: "deep-research wait",
    schema_id: "parallel.deep_research.wait.input/v1",
    description: "Poll an existing Task Run until complete or timed out.",
    schema: DeepResearchWaitInput,
    examples: [{ name: "wait for run", input: { run_id: "trun_...", max_wait_seconds: 600 } }],
    capability: {
      command: "deep-research wait",
      lifecycle: "provider_async",
      supported_actions: ["wait", "inspect", "check"],
      unsupported_actions: taskNoCancel,
      supports_batch: false,
      supports_artifacts: true,
    },
  },
  {
    command: "deep-research events",
    schema_id: "parallel.deep_research.events.input/v1",
    description: "Read Task Run SSE events.",
    schema: DeepResearchEventsInput,
    examples: [{ name: "events", input: { run_id: "trun_...", timeout_seconds: 30 } }],
    capability: {
      command: "deep-research events",
      lifecycle: "provider_async",
      supported_actions: ["events"],
      unsupported_actions: taskNoCancel,
      supports_batch: false,
      supports_artifacts: true,
    },
  },
  {
    command: "findall start",
    schema_id: "parallel.findall.start.input/v1",
    description: "Submit a Parallel FindAll run.",
    schema: FindAllStartInput,
    examples: [
      {
        name: "entity discovery",
        input: { objective: "Find AI infrastructure startups founded after 2023" },
        flags: { idempotency_key: "find-ai-infra-2026-04-24" },
      },
    ],
    capability: {
      command: "findall start",
      lifecycle: "provider_async",
      supported_actions: ["start", "inspect", "check", "wait", "events", "cancel"],
      unsupported_actions: [],
      supports_batch: true,
      supports_artifacts: true,
      idempotency: localIdempotency,
    },
  },
  {
    command: "findall check",
    schema_id: "parallel.findall.check.input/v1",
    description: "Inspect a FindAll run and fetch candidates when complete.",
    schema: FindAllCheckInput,
    examples: [{ name: "check findall", input: { findall_id: "findall_..." } }],
    capability: {
      command: "findall check",
      lifecycle: "provider_async",
      supported_actions: ["inspect", "check"],
      unsupported_actions: [],
      supports_batch: false,
      supports_artifacts: true,
    },
  },
  {
    command: "findall wait",
    schema_id: "parallel.findall.wait.input/v1",
    description: "Poll an existing FindAll run until complete or timed out.",
    schema: FindAllWaitInput,
    examples: [{ name: "wait findall", input: { findall_id: "findall_..." } }],
    capability: {
      command: "findall wait",
      lifecycle: "provider_async",
      supported_actions: ["wait", "inspect", "check"],
      unsupported_actions: [],
      supports_batch: false,
      supports_artifacts: true,
    },
  },
  {
    command: "findall events",
    schema_id: "parallel.findall.events.input/v1",
    description: "Read FindAll SSE events.",
    schema: FindAllEventsInput,
    examples: [{ name: "events", input: { findall_id: "findall_...", timeout_seconds: 30 } }],
    capability: {
      command: "findall events",
      lifecycle: "provider_async",
      supported_actions: ["events"],
      unsupported_actions: [],
      supports_batch: false,
      supports_artifacts: true,
    },
  },
  {
    command: "findall cancel",
    schema_id: "parallel.findall.cancel.input/v1",
    description: "Cancel a FindAll run.",
    schema: FindAllCancelInput,
    examples: [{ name: "cancel", input: { findall_id: "findall_..." } }],
    capability: {
      command: "findall cancel",
      lifecycle: "provider_async",
      supported_actions: ["cancel"],
      unsupported_actions: [],
      supports_batch: false,
      supports_artifacts: false,
    },
  },
  {
    command: "monitors create",
    schema_id: "parallel.monitors.create.input/v1",
    description: "Create a scheduled web monitor.",
    schema: MonitorCreateInput,
    examples: [
      {
        name: "daily monitor",
        input: {
          query: "Notable news about Parallel Web Systems",
          cadence: "daily",
        },
        flags: { idempotency_key: "parallel-news-monitor" },
      },
    ],
    capability: {
      command: "monitors create",
      lifecycle: "scheduled_monitor",
      supported_actions: ["start", "inspect", "events", "cancel"],
      unsupported_actions: [
        {
          action: "wait",
          reason: "Monitor execution is scheduled or webhook-driven; use events for history/backfill.",
        },
        {
          action: "stream",
          reason: "Monitor API documents webhooks and event history, not an SSE stream.",
        },
      ],
      supports_batch: true,
      supports_artifacts: true,
      idempotency: localIdempotency,
    },
  },
  {
    command: "monitors events",
    schema_id: "parallel.monitors.events.input/v1",
    description: "List monitor events or retrieve an event group.",
    schema: MonitorEventsInput,
    examples: [{ name: "recent events", input: { monitor_id: "mon_...", lookback_period: "7d" } }],
    capability: {
      command: "monitors events",
      lifecycle: "scheduled_monitor",
      supported_actions: ["events"],
      unsupported_actions: [],
      supports_batch: false,
      supports_artifacts: true,
    },
  },
  {
    command: "monitors inspect",
    schema_id: "parallel.monitors.inspect.input/v1",
    description: "Retrieve a monitor by id.",
    schema: MonitorIdInput,
    examples: [{ name: "inspect monitor", input: { monitor_id: "mon_..." } }],
    capability: {
      command: "monitors inspect",
      lifecycle: "scheduled_monitor",
      supported_actions: ["inspect"],
      unsupported_actions: [],
      supports_batch: false,
      supports_artifacts: true,
    },
  },
  {
    command: "monitors cancel",
    schema_id: "parallel.monitors.cancel.input/v1",
    description: "Delete a monitor to stop future executions.",
    schema: MonitorIdInput,
    examples: [{ name: "delete monitor", input: { monitor_id: "mon_..." } }],
    capability: {
      command: "monitors cancel",
      lifecycle: "scheduled_monitor",
      supported_actions: ["cancel"],
      unsupported_actions: [],
      supports_batch: false,
      supports_artifacts: false,
    },
  },
  {
    command: "monitors simulate",
    schema_id: "parallel.monitors.simulate.input/v1",
    description: "Ask Parallel to simulate a monitor webhook event.",
    schema: MonitorSimulateInput,
    examples: [
      {
        name: "simulate detected event",
        input: { monitor_id: "mon_...", event_type: "monitor.event.detected" },
      },
    ],
    capability: {
      command: "monitors simulate",
      lifecycle: "scheduled_monitor",
      supported_actions: ["events"],
      unsupported_actions: [],
      supports_batch: false,
      supports_artifacts: false,
    },
  },
]

export const listSchemaSpecs = () => ({
  schemas: commandSpecs.map((spec) => ({
    command: spec.command,
    schema_id: spec.schema_id,
    description: spec.description,
  })),
})

export const showSchemaSpec = (schemaId: string) => {
  const spec = commandSpecs.find((candidate) => candidate.schema_id === schemaId)

  if (!spec) {
    return undefined
  }

  let json_schema: unknown
  try {
    json_schema = JSONSchema.make(spec.schema)
  } catch (cause) {
    json_schema = {
      unavailable: true,
      reason: cause instanceof Error ? cause.message : String(cause),
    }
  }

  return {
    command: spec.command,
    schema_id: spec.schema_id,
    description: spec.description,
    json_schema,
  }
}

export const listExamples = () => ({
  commands: commandSpecs.map((spec) => ({
    command: spec.command,
    example_count: spec.examples.length,
  })),
})

export const showExamples = (command: string) => {
  const spec = commandSpecs.find((candidate) => candidate.command === command)

  if (!spec) {
    return undefined
  }

  return {
    command: spec.command,
    examples: spec.examples,
  }
}

export const listCapabilities = () => ({
  provider: "parallel",
  generated_at: new Date().toISOString(),
  commands: commandSpecs.map((spec) => spec.capability),
})
