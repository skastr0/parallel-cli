import { Args, Command } from "@effect/cli"
import { Effect } from "effect"

import { getArtifactDir } from "../core/artifacts"
import { getAuthStatus } from "../core/api"
import {
  commandSpecs,
  listCapabilities,
  listExamples,
  listSchemaSpecs,
  showExamples,
  showSchemaSpec,
} from "../core/discovery"
import { CommandInputError } from "../core/errors"
import { idempotencyStateDir } from "../core/idempotency"
import { executeJsonCommand } from "../core/output"

const schemaIdArg = Args.text({ name: "schema_id" }).pipe(
  Args.withDescription("Schema id from schema list"),
)

const commandArg = Args.text({ name: "command" }).pipe(
  Args.withDescription("Command name from examples list, for example 'search'"),
)

export const capabilitiesCommand = Command.make("capabilities", {}, () =>
  executeJsonCommand("capabilities", Effect.sync(listCapabilities)),
).pipe(Command.withDescription("Describe provider and CLI capabilities"))

const schemaListCommand = Command.make("list", {}, () =>
  executeJsonCommand("schema list", Effect.sync(listSchemaSpecs)),
).pipe(Command.withDescription("List command input schemas"))

const schemaShowCommand = Command.make("show", { schemaId: schemaIdArg }, ({ schemaId }) =>
  executeJsonCommand(
    "schema show",
    Effect.gen(function* () {
      const schema = showSchemaSpec(schemaId)

      if (!schema) {
        return yield* new CommandInputError({
          field: "schema_id",
          message: `Unknown schema id: ${schemaId}`,
        })
      }

      return schema
    }),
  ),
).pipe(Command.withDescription("Show a command input schema"))

export const schemaCommand = Command.make("schema").pipe(
  Command.withDescription("Schema discovery commands"),
  Command.withSubcommands([schemaListCommand, schemaShowCommand]),
)

const examplesListCommand = Command.make("list", {}, () =>
  executeJsonCommand("examples list", Effect.sync(listExamples)),
).pipe(Command.withDescription("List commands with examples"))

const examplesShowCommand = Command.make("show", { command: commandArg }, ({ command }) =>
  executeJsonCommand(
    "examples show",
    Effect.gen(function* () {
      const examples = showExamples(command)

      if (!examples) {
        return yield* new CommandInputError({
          field: "command",
          message: `Unknown command: ${command}`,
        })
      }

      return examples
    }),
  ),
).pipe(Command.withDescription("Show executable examples for a command"))

export const examplesCommand = Command.make("examples").pipe(
  Command.withDescription("Example discovery commands"),
  Command.withSubcommands([examplesListCommand, examplesShowCommand]),
)

export const doctorCommand = Command.make("doctor", {}, () =>
  executeJsonCommand(
    "doctor",
    Effect.gen(function* () {
      const auth = yield* getAuthStatus

      return {
        ok: true,
        checks: [
          {
            name: "api_key",
            ok: auth.configured,
            retryable: false,
            details: auth.configured
              ? { env_var: "PARALLEL_API_KEY" }
              : {
                  env_var: "PARALLEL_API_KEY",
                  hint: "Export PARALLEL_API_KEY before running provider commands.",
                },
          },
          {
            name: "api_base_url",
            ok: true,
            retryable: false,
            details: { api_base_url: auth.api_base_url },
          },
          {
            name: "artifact_dir",
            ok: true,
            retryable: false,
            details: { path: getArtifactDir() },
          },
          {
            name: "state_dir",
            ok: true,
            retryable: false,
            details: { path: idempotencyStateDir() },
          },
          {
            name: "discovery",
            ok: true,
            retryable: false,
            details: { command_count: commandSpecs.length },
          },
        ],
      }
    }),
  ),
).pipe(Command.withDescription("Check local CLI configuration and discovery metadata"))
