import { Command } from "@effect/cli"
import { Effect, Schema } from "effect"

import { executeJsonCommand } from "../core/output"
import { getAuthStatus } from "../core/api"

const authStatusCommand = Command.make("status", {}, () =>
  executeJsonCommand(
    "auth status",
    getAuthStatus,
  ),
).pipe(
  Command.withDescription("Check authentication status and API configuration"),
)

export const authCommand = Command.make("auth").pipe(
  Command.withDescription("Authentication commands"),
  Command.withSubcommands([authStatusCommand]),
)
