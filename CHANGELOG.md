# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-07-14

### Added
- **Flexible deployment at `/OPT_Mentor_`** — separate helm release
  `opt-mentor-flex` (namespace `opt-mentor`) that lets users choose between
  WebLLM (local) and API key (remote) via the AI Tutor config panel. The
  original `/OPT_Mentor` deployment remains unchanged.
  - `chart/values-flex.yaml` — helm values for the flexible deployment
    (no API proxy, no mode lock, route `/OPT_Mentor_`)
  - `Dockerfile` — `ARG INJECT_API_CONFIG` and `ARG API_HIDE_API_PANEL`
    make API config injection configurable at build time
  - `webpack.config.js` — `[contenthash:8]` in JS bundle filename prevents
    stale browser cache across deployments

### Changed
- **AI Tutor config redesign** — config panel hidden by default; "AI Tutor"
  button (renamed from "Configure", moved to left of status text) toggles
  the panel. Confirm/Cancel hides the panel after applying/restoring. Mode
  toggle stays inside the config panel.
  - `live.html` — compact status bar, AI Tutor button, Confirm/Cancel
    buttons, model-status-line, all config elements `display: none` by
    default
  - `webllm.ts` — `hideConfigPanel()` / `showConfigPanel()` (sync),
    `updateStatusBar()`, Configure button as toggle, simplified
    `updateUIElements()`
- **"Current Mode:" prefix removed** from mode display — now just "Local
  Mode" / "API Mode"

### Removed
- Dead code cleanup (-47 lines): `$("#send").click()`, redundant toggle
  listener, `enforceSingleModelSetting()` IIFE, `loadAPIConfig()` input
  echo, `updateModeDisplay()` on page load, duplicate `lock` declaration

## [0.2.0] - 2026-07-10

### Added
- **nginx reverse proxy for API key hiding** — the LLM API key is now injected server-side by nginx, never visible in the browser. The browser calls same-origin `/OPT_Mentor/ai-proxy/chat/completions`; nginx forwards to the upstream API with `Authorization: Bearer ***` injected from a Kubernetes secret. GitHub Pages deployments continue using WebLLM (no proxy, no key).
  - `nginx.conf` — new `/ai-proxy/` location block with `proxy_pass`, `Authorization` header injection, SSE streaming support
  - `Dockerfile` — uses nginx `envsubst` template (`/etc/nginx/templates/default.conf.template`) for runtime env var substitution (`API_PROXY_TARGET`, `API_PROXY_KEY`)
  - `webllm.ts` — `callOpenAIAPI` skips sending `Authorization` header from client when using the proxy
  - Helm chart — `env` vars for `API_PROXY_TARGET` and `API_PROXY_KEY` (from K8s secret `opt-mentor-api-key`)

### Fixed
- **Ask AI button shown during code execution** — the `MutationObserver` in `webllm.ts` showed the Ask AI button whenever `frontendErrorOutput` had any text, including the transient "Running your code ..." message. The `startsWith('Running your code')` check failed because `htmlspecialchars` converts spaces to `&nbsp;` (non-breaking spaces, U+00A0). Fixed by using regex `/^Running\s+your\s+code/` which matches non-breaking spaces via `\s`.
- **VCR controls not shown on error** — in `opt-live.ts`, the error path (syntax error or runtime exception) never called `finishSuccessfulExecution()`, so VCR controls stayed `display: none` on the first error run. Now always creates an `ExecutionVisualizer` and shows VCR controls (wrapped in try-catch), so users can step through execution even when errors occur.
- **Duplicate element IDs** — the `live.html` template used the same IDs (`vcrControls`, `curInstr`, `executionSlider`, `raw_input_textbox`, etc.) as the `ExecutionVisualizer`'s internal elements, causing 14 duplicate ID violations in the browser DOM. Fixed by renaming all template IDs to use a `_live` suffix (e.g., `vcrControls_live`, `curInstr_live`, `raw_input_textbox_live`).
- **Legend arrows too large** — after renaming IDs to `_live` suffix, the CSS selectors in `opt-live.css` no longer matched the renamed SVG elements, causing arrows to render at their default (very large) size. Fixed by adding `_live` variants alongside existing CSS selectors.
- **Error message cleanup** — `setFronendError` for compiler/runtime errors now uses `ignoreLog=true` to suppress the misleading `(UNSUPPORTED FEATURES)` suffix; removed redundant `"Error: "` prefix from the catch handler.
- **Ace editor textarea audit** — added `name="ace_code_input"` attribute to the Ace editor's internal textarea to satisfy browser autofill/accessibility audit.

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
