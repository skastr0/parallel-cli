# parallel-cli

JSON-first Effect CLI for Parallel API operations.

The CLI is designed as a stable agent protocol surface:

- commands accept one JSON argument: inline JSON, `@file`, `-`, or `@-`
- stdout/stderr contain deterministic JSON envelopes only
- command payloads use `snake_case` keys to mirror Parallel API payloads
- execution controls use flags such as `--output`, `--concurrency`, and `--idempotency-key`

## Quick Start

```bash
export PARALLEL_API_KEY="..."
bun install
bun run dev -- doctor
```

All examples below prefer file payloads:

```json
// payloads/search.json
{
  "objective": "Find official Parallel API docs",
  "mode": "agentic",
  "max_results": 5
}
```

```bash
parallel search @payloads/search.json
parallel search --output artifact @payloads/search.json
```

## Commands

```bash
parallel auth status
parallel doctor
parallel capabilities
parallel schema list
parallel schema show parallel.search.input/v1
parallel examples list
parallel examples show search
```

Search and Extract are synchronous provider calls:

```bash
parallel search @payloads/search.json
parallel extract --output auto @payloads/extract.json
```

Deep research uses Parallel Task Runs:

```bash
parallel deep-research start --idempotency-key research-2026-04-24 @payloads/research.json
parallel deep-research inspect @payloads/task-run.json
parallel deep-research check --output auto @payloads/task-run.json
parallel deep-research wait --output artifact @payloads/task-wait.json
parallel deep-research events --output artifact @payloads/task-events.json
parallel deep-research cancel @payloads/task-run.json
```

`deep-research cancel` reports an unsupported capability because the public Task Run API does not document a cancel endpoint.

FindAll uses provider-owned asynchronous runs:

```bash
parallel findall start --idempotency-key findall-ai-infra @payloads/findall.json
parallel findall inspect @payloads/findall-run.json
parallel findall check --output auto @payloads/findall-run.json
parallel findall wait @payloads/findall-wait.json
parallel findall events --output artifact @payloads/findall-events.json
parallel findall cancel @payloads/findall-run.json
```

Monitors are scheduled provider resources:

```bash
parallel monitors create --idempotency-key news-monitor @payloads/monitor.json
parallel monitors list
parallel monitors inspect @payloads/monitor-id.json
parallel monitors events --output artifact @payloads/monitor-events.json
parallel monitors simulate @payloads/monitor-simulate.json
parallel monitors cancel @payloads/monitor-id.json
```

`monitors wait` reports an unsupported capability because monitor execution is scheduled or webhook-driven. Use `monitors events` for history/backfill.

## Payload Examples

```json
// payloads/extract.json
{
  "urls": ["https://parallel.ai"],
  "objective": "Extract product names and API categories",
  "full_content": true
}
```

```json
// payloads/research.json
{
  "input": "Research current AI browser agents",
  "processor": "base",
  "enable_events": true,
  "max_wait_seconds": 120,
  "poll_interval_seconds": 5
}
```

```json
// payloads/task-run.json
{
  "run_id": "trun_..."
}
```

```json
// payloads/findall.json
{
  "objective": "Find AI infrastructure startups founded after 2023"
}
```

```json
// payloads/monitor.json
{
  "query": "Notable news about Parallel Web Systems",
  "cadence": "daily"
}
```

## Batch Inputs

Commands where the CLI owns fan-out accept either one JSON object or an array of objects. Batch outputs preserve input order and include per-item results, counts, `outcome`, target metadata, and the effective concurrency.

```bash
parallel search --concurrency 2 @payloads/search-batch.json
parallel extract --concurrency 2 @payloads/extract-batch.json
parallel deep-research start --concurrency 2 --idempotency-key research-batch @payloads/research-batch.json
parallel findall start --concurrency 2 --idempotency-key findall-batch @payloads/findall-batch.json
parallel monitors create --concurrency 2 --idempotency-key monitor-batch @payloads/monitor-batch.json
```

If any batch item fails, the command exits `1` while stdout still contains a successful top-level envelope with itemized failures.

## Output Policy

Large response commands support:

```bash
--output inline
--output artifact
--output auto
```

`artifact` writes the full JSON data to disk and returns a compact summary with an artifact record. `auto` writes an artifact when the response is larger than the CLI threshold.

Artifacts are CLI runtime data. By default they are stored under `~/.config/parallel-cli/artifacts`, or under `PARALLEL_CLI_HOME/artifacts` when `PARALLEL_CLI_HOME` is set. Set `PARALLEL_CLI_ARTIFACT_DIR` only when you want an explicit artifact output path.

## Idempotency

Mutation and job-submission commands accept `--idempotency-key`.

Parallel does not currently document a provider idempotency header for these endpoints, so this CLI implements local success receipts. After a successful submission, repeating the same command and payload with the same key replays the stored response on the same machine. If the provider request times out before the receipt is written, the CLI cannot guarantee provider-level idempotency.

Receipts are CLI runtime data. By default they are stored under `~/.config/parallel-cli/state`, or under `PARALLEL_CLI_HOME/state` when `PARALLEL_CLI_HOME` is set. Set `PARALLEL_CLI_STATE_DIR` only when you want an explicit receipt storage path.

## Envelopes

Success:

```json
{
  "ok": true,
  "command": "search",
  "data": {}
}
```

Failure:

```json
{
  "ok": false,
  "command": "search",
  "error": {
    "type": "ApiResponseError",
    "message": "rate limited",
    "details": {
      "provider_request": {
        "method": "POST",
        "path": "/v1beta/search",
        "status": 429
      },
      "retryable": true,
      "hint": "Retry with backoff or lower concurrency if the provider is rate limiting."
    }
  }
}
```

Error details include recovery hints, retryability, provider request metadata, and redact secret-like fields.

## Environment

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PARALLEL_API_KEY` | Yes | - | Parallel API key |
| `PARALLEL_API_BASE_URL` | No | `https://api.parallel.ai` | Override API base URL for tests or proxies |
| `PARALLEL_CLI_HOME` | No | `~/.config/parallel-cli` | Root directory for CLI-owned runtime data |
| `PARALLEL_CLI_ARTIFACT_DIR` | No | `$PARALLEL_CLI_HOME/artifacts` | Explicit artifact output directory |
| `PARALLEL_CLI_STATE_DIR` | No | `$PARALLEL_CLI_HOME/state` | Explicit local idempotency receipt directory |

## Development

```bash
bun install
bun run typecheck
bun run test
bun run build
```

The build emits cross-platform binaries under `dist/`.
