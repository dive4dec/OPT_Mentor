# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-09

### Added
- **Sub-path deployment support** — webpack `publicPath` configurable via `PUBLIC_PATH`
  env var for serving under a sub-path (e.g., `/OPT_Mentor/`).
- **Multi-stage Dockerfile** — rewritten from single-stage Ubuntu to 3-stage build:
  - Stage 1: `node:22-slim` — builds webllm-components (rollup → `lib/index.js`)
  - Stage 2: `node:22-slim` — builds optlite-components (webpack → `build/`) with
    build args for `PUBLIC_PATH`, `API_BASE_URL`, `API_KEY`, `API_MODEL`, `SINGLE_MODE`
  - Stage 3: `nginx:1.29-alpine3.23` — serves static files (replaces `python http.server`)
- **nginx.conf** — SPA `try_files`, favicon 204, static asset caching.
- **.dockerignore** — excludes `node_modules/`, `build/`, `docs/`, `tests/` from context.
- This `CHANGELOG.md`.

### Changed
- `npm ci` replaces `npm install` for reproducible builds.
- Build verification: `test -f build/index.html && test -f build/live.html`.
- Cleaned up `webpack.config.js`: removed ~40 lines of dead commented-out code
  (WebpackOnBuildPlugin, optimization config, devtool comments, inline noise).

### Fixed
- **Pyodide wheel URL** — `runner.ts` now forces absolute URL for the optlite wheel
  via `new URL(OptLite.optlite, window.location.href).href`, fixing `micropip.install()`
  failure when serving under a sub-path.
- **JSON.parse("undefined") crash** — `runner.ts` now properly rejects on worker errors
  instead of resolving with `undefined`. Callers (`opt-frontend-common.ts`, `opt-live.ts`)
  wrap execution in try/catch to display errors gracefully.
- **WebGPU context failure** — `visualize-ai.ts` and `webllm.ts` guard auto-load with
  `'gpu' in navigator` check, preventing "Failed to create WebGPU Context Provider"
  on unsupported browsers.
- **favicon 404** — nginx returns 204 for `/favicon.ico`.

---

## Versioning Policy

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- **MAJOR** (1.0.0): Breaking changes (new API, incompatible config).
- **MINOR** (0.x.0): New features (new deployment mode, new Docker stage).
- **PATCH** (0.0.x): Bug fixes, dependency bumps.

Tags are created as `vX.Y.Z` (e.g., `v0.1.0`).
