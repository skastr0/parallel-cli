# parallel-cli

JSON-first Effect CLI for Parallel API operations.

## Status

- Maturity: experimental
- Repository visibility: prepared for public release after explicit maintainer approval
- Primary release lane: npm package with a Node launcher and per-platform optional binary packages
- Secondary release lane: GitHub Release archives with standalone Bun-compiled binaries
- Maintainer model: solo-maintained

The first public release is prepared for review but not published yet. Real publishing, tag pushes, GitHub release creation, Homebrew tap changes, package registry publication, and repository visibility changes require explicit maintainer approval.

The CLI is designed as a stable agent protocol surface:

- commands accept one JSON argument: inline JSON, `@file`, `-`, or `@-`
- stdout/stderr contain deterministic JSON envelopes only
- command payloads use `snake_case` keys to mirror Parallel API payloads
- execution controls use flags such as `--output`, `--concurrency`, and `--idempotency-key`

## Install Surface

After the npm release exists, install or run the CLI from the npm package:

```bash
npm install -g @skastr0/parallel-cli
parallel doctor
```

The package exposes the `parallel` command through a Node launcher and installs the matching platform binary as an optional dependency. Ephemeral runners can use the package directly:

```bash
npx -y --package @skastr0/parallel-cli parallel doctor
bunx -p @skastr0/parallel-cli parallel doctor
pnpm --package @skastr0/parallel-cli dlx parallel doctor
```

For source builds before the first release:

```bash
export PARALLEL_API_KEY="..."
bun install
bun run build
bun run install:local
parallel doctor
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
bun run package:release
bun run package:npm
bun run npm:dry-run
```

`bun run verify` runs typechecking, tests, and a full cross-platform build. `bun run package:release` expects the build outputs and writes release archives plus `SHA256SUMS` under `dist/release/`.

The build emits cross-platform binaries under `dist/`:

- `parallel-darwin-arm64`
- `parallel-darwin-x64`
- `parallel-linux-arm64`
- `parallel-linux-x64`

`bun run package:npm` expects those binaries and writes npm publish packages under `dist/npm/`:

- `@skastr0/parallel-cli-darwin-x64`
- `@skastr0/parallel-cli-darwin-arm64`
- `@skastr0/parallel-cli-linux-x64`
- `@skastr0/parallel-cli-linux-arm64`
- `@skastr0/parallel-cli`

`bun run npm:dry-run` inspects the generated npm package contents with `npm pack --dry-run`.

## Release Plan

The intended first release lane is npm trusted publishing through GitHub Actions:

1. Keep external mutations gated until public-readiness scans and maintainer approval are complete.
2. Build and package standalone binaries with `bun run build`.
3. Generate npm wrapper and platform packages with `bun run package:npm`.
4. Inspect package contents with `bun run npm:dry-run`.
5. Configure npm trusted publishing for `.github/workflows/npm-publish.yml` and the protected GitHub `release` environment.
6. Make the repository public before publishing if npm provenance is required.
7. Push the approved release tag or dispatch the workflow only after explicit maintainer approval.
8. Let CI publish the platform packages first and the main wrapper package last.
9. Verify `npx`, `bunx`, `pnpm dlx`, package metadata, and npm provenance after publication.

The project is not released until the maintainer explicitly approves the real tag, GitHub Release, Homebrew tap, package registry, and visibility actions. Local `npm publish` is intentionally guarded and is only a bootstrap exception for an exact package/version after explicit approval.

## Known Limitations

- The CLI stores local artifact and idempotency receipt data on the user's machine; it does not synchronize that state across machines.
- Local idempotency receipts cannot guarantee provider-level idempotency if a provider request succeeds but the local receipt write fails.
- `deep-research cancel` and `monitors wait` intentionally report unsupported provider capabilities where the public Parallel API does not document the needed endpoint.
- npm installation depends on the generated platform package for the user's operating system and CPU architecture.

## Support And Security

Use GitHub issues for reproducible bugs and scoped proposals once the repository is public. Please do not open public issues for suspected vulnerabilities; follow `SECURITY.md` instead.

## License

MIT
