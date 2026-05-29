# parallel-cli Agent Guide

## Project Intent

This is a JSON-first Effect CLI for Parallel API operations. It replaces the old OpenCode-local `parallel-tools` provider wrapper with a generic command-line interface that agents can call outside any harness.

## Interface Rules

- Commands accept one JSON argument: inline JSON, `@file`, `-`, or `@-`.
- Commands write only deterministic JSON envelopes to stdout/stderr.
- Success envelopes use `{ ok: true, command, data }`.
- Failure envelopes use `{ ok: false, command, error: { type, message, details } }`.
- Use `snake_case` JSON keys because the CLI mirrors Parallel API payloads.

## Effect Rules

- IO and command work should return `Effect.Effect`.
- Recoverable failures should be tagged errors in `src/core/errors.ts`.
- Parse public inputs with Effect Schema at the boundary.
- Provide the runtime layer once from `src/cli.ts`; do not provision app layers inside commands.

## Validation

Use:

```bash
bun run typecheck
bun run test
bun run build
bun run package:release
```

Use `PARALLEL_API_BASE_URL` for mock servers in tests. Do not hit the live Parallel API from unit tests.
