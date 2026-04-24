# parallel-cli

JSON-first Effect CLI for Parallel API operations.

## Commands

Each operation accepts one JSON input argument. The input can be inline JSON, `@path/to/file.json`, or `-` / `@-` for stdin.

```bash
parallel auth status
parallel search '{"objective":"Find official Parallel API docs","mode":"agentic"}'
parallel extract '{"urls":["https://parallel.ai"],"full_content":true}'
parallel deep-research run '{"input":"Research current AI browser agents","processor":"base"}'
parallel deep-research start '{"input":"Find AI startups that raised Series A this month"}'
parallel deep-research check '{"run_id":"run_..."}'
parallel findall start '{"objective":"Find AI infrastructure startups founded after 2023"}'
parallel findall check '{"findall_id":"fa_..."}'
parallel monitors create '{"query":"Notable news about Parallel Web Systems","cadence":"daily"}'
parallel monitors events '{"monitor_id":"mon_...","lookback":"7d"}'
```

All command output is a deterministic JSON envelope:

```json
{
  "ok": true,
  "command": "search",
  "data": {}
}
```

Failures are emitted to stderr with typed error details:

```json
{
  "ok": false,
  "command": "search",
  "error": {
    "type": "MissingApiKeyError",
    "message": "PARALLEL_API_KEY is not configured",
    "details": {
      "env_var": "PARALLEL_API_KEY"
    }
  }
}
```

## Environment

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PARALLEL_API_KEY` | Yes | - | Parallel API key |
| `PARALLEL_API_BASE_URL` | No | `https://api.parallel.ai` | Override API base URL for tests or proxies |

## Development

```bash
bun install
bun run typecheck
bun run test
bun run build
```

The build emits cross-platform binaries under `dist/`.
