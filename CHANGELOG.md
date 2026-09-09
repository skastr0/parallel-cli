# Changelog

All notable changes to this project will be documented in this file.

The project follows Semantic Versioning for its declared CLI protocol surface.

## 0.2.0 - 2026-09-09

### Added

- `findall entity-search` for synchronous ranked people/company search (`POST /v1beta/findall/entity-search`).
- `findall enrich` and `findall extend` for V1 FindAll post-create operations.
- `monitors trigger` to enqueue a real off-schedule Monitor V1 run.
- Search/Extract `session_id`, `client_model`, `max_chars_total`, and v1 advanced settings.
- Search modes `turbo`, `fast`, `basic`, and `advanced`, with Beta aliases `one-shot` → `basic` and `agentic` → `advanced`.

### Changed

- Search and Extract now call `/v1/search` and `/v1/extract`. `/v1beta` is no longer the default.
- Search encodes `search_queries` (derived from `objective` when omitted), `mode`, and `advanced_settings`.
- Extract always returns excerpts. `full_content` and excerpt size settings are encoded under `advanced_settings`.
- FindAll run create no longer sends `parallel-beta: findall-2025-09-15`. Ingested enrichments are applied via `/enrich` after create.
- FindAll `exclude_list` is `{ name, url }` objects, not strings.
- Monitors now use GA `/v1/monitors`: nested `settings`, `POST /{id}/cancel`, cursor-paginated events, and `POST /{id}/trigger`.
- `monitors simulate` is an honest alias for `monitors trigger`. Monitor V1 removed synthetic `simulate_event`.

### Removed

- Search/Extract `parallel-beta: search-extract-2025-10-10` header on the default path.

## 0.1.0 - 2026-06-03

### Added

- Initial JSON-first Effect CLI for Parallel API operations.
- npm release surface with a Node launcher and per-platform optional binary packages.
- Standalone Bun-compiled release asset packaging.
- GitHub Actions CI and protected npm trusted-publishing workflow.
- Public README, support, security, contribution, issue-template, and release-gate documentation.
