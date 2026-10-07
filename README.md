# Env Reaper

A local-first environment configuration workbench built with React, TypeScript, Tauri 2, and a Rust analysis engine shared by the desktop app and CLI.

The opening **Shipwreck** workspace is explicitly labeled demo data. Use **All projects → Open repository** to inspect your own code. Reap means analyze; scanning never deletes files.

## Run locally

```sh
npm install
npm run dev
```

Open `http://localhost:5173`. Browser folder imports run in a Web Worker without uploading files. Browser imports cannot inspect Git metadata or modify the source repository. Downloaded example files may need the leading dot restored to `.env.example` by browsers that sanitize download names.

For native Git inspection, editor integration, reviewed writes, undo, and watch mode:

```sh
npm run desktop
```

Rust 1.95 is pinned by `rust-toolchain.toml`. Desktop development requires the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). A running `npm run dev` process on port 5173 must be stopped before `npm run desktop` starts its own Vite server.

## Build

```sh
npm run build
npm run desktop:build
# macOS app bundle only:
npm run desktop:build -- --bundles app
```

Desktop packaging targets the host platform. This repository was built and tested on Apple Silicon macOS. Windows and Linux code paths are present but need builds on their respective operating systems. Signing and notarization are not configured.

## CLI

```sh
cargo run -p env-reaper-cli -- scan /path/to/repository
cargo run -p env-reaper-cli -- missing /path/to/repository
cargo run -p env-reaper-cli -- dead /path/to/repository
cargo run -p env-reaper-cli -- secrets /path/to/repository
cargo run -p env-reaper-cli -- drift /path/to/repository
cargo run -p env-reaper-cli -- graph /path/to/repository
cargo run -p env-reaper-cli -- example /path/to/repository
cargo run -p env-reaper-cli -- scan /path/to/repository --json
```

`example` prints blank assignments to stdout. `graph` prints the reference data as JSON. CLI commands are read-only. Install the command with `cargo install --path crates/env-reaper-cli`.

## Workbench

- Health summary with actual findings alongside the score.
- Search, name/reference sorting, status/service/file filters, secret-only filtering, and pagination.
- Variable inspector with definitions, masked values, detected source expressions, service ownership, and desktop editor links.
- Dedicated dead, missing, and secret views, plus a presence drift matrix.
- Variable → source file → service graph with variable selection and zoom. Up to six source files are displayed per variable; the inspector lists references.
- Empty-value example generation, grouped by inferred service. All values are omitted, including potential defaults.
- Native removal of individual definitions, addition of empty placeholders, and `.env.example` replacement. Every native change requires a redacted before/after preview.
- Atomic native writes with file-content and path revalidation. A file changed after preview is rejected. One in-memory undo is retained; undo also refuses to overwrite subsequent edits.
- Metadata-only project history and pinning. Browser source contents are kept only in memory.
- Command palette (`Cmd/Ctrl+K`), variable search (`/`), overview (`Cmd/Ctrl+1`), inventory (`Cmd/Ctrl+2`), and projects (`Cmd/Ctrl+O`).

## Scanner behavior and current limits

The Rust scanner respects `.gitignore` and `.ignore`, skips generated directories and symlinks, filters binary/non-UTF-8 files, and skips files over 2 MB. Ignored `.env*` files are intentionally included because inspecting local configuration is the product’s purpose. Files are read in parallel; analysis runs off the desktop UI thread.

Recognized reference patterns cover common JavaScript/TypeScript, Python, Rust, Go, .NET, shell interpolation, and CI environment contexts. Definitions include dotenv files and probable quoted secret assignments in source/configuration files. Entropy, credential prefixes, names, and connection-string patterns inform secret classification.

This is a heuristic scanner, not a complete language parser or deployment configuration evaluator. Dynamic variable names, generated configuration, framework-specific accessors, and some Docker/Kubernetes/Terraform definitions can be missed. Confidence indicates a matched static pattern, not a statistical security guarantee. Ownership is inferred from `apps`, `packages`, and `services` paths. Missing status uses repository-wide definitions rather than full service/environment precedence resolution. Comments and complex language syntax can cause false positives. Never delete solely because no reference was found.

Drift compares **definition presence**, not secret value equality. Git exposure means a probable secret is currently in a tracked file; it does not assert the credential was committed or remains valid. The native history inspector finds commits changing a variable’s name and returns hashes/dates without patches or commit messages. It is not an exhaustive historical credential audit. Source previews show only the detected access expression to avoid disclosing surrounding credentials.

Native watch mode rescans every 15 seconds. Incremental indexing, OS filesystem watchers, full AST parsing, deployment/infrastructure graph nodes, bulk edits, persisted ignore rules, and historical secret mining remain extension work. Browser imports skip common generated directories but do not interpret ignore files or Git tracking. Browser rescans analyze the imported snapshot; reselect a folder to import changed files.

Health is a summary: `100 − 100 × weighted findings / variable count`, clamped to 0–100. Current weights are 2 for exposed, 1.3 for missing, 0.45 for dead, plus 0.25 for drift. Secret classification alone carries no penalty. Scores are not security assurances.

## Privacy

No cloud backend, analytics, remote fonts, or external credential rotation. Scanner results contain names, paths, classifications, and counts—not secret values. Native change buffers and browser imports exist in memory only. Local persistence contains project paths, timestamps, counts, pins, and preferences. Editor opening asks for confirmation because the editor may display real values.

## Repository structure

```text
src/                         React workbench
src/lib/scanner.ts            Browser fallback analyzer
src/lib/scan.worker.ts        Browser worker boundary
src/lib/platform.ts           Desktop IPC and browser adapters
crates/env-reaper-core/       Shared Rust scanner and Git inspection
crates/env-reaper-cli/        Read-only CLI
src-tauri/                   Native shell and guarded write operations
tests/e2e/                   Browser workflow tests
```

## Verify

```sh
npm test
npm run test:e2e
npm run build
cargo test --workspace
cargo fmt --all --check
npm audit
```

Install Chromium with `npx playwright install chromium` if needed. Tests exercise parsing, redaction, ignore behavior, multiline-safe removal, path validation, example generation, imports, navigation, filtering, downloads, and responsive layout. The app has no external integration dependencies.

## License

[MIT NON-AI License](LICENSE). This custom, source-available license permits use, modification, and redistribution subject to its terms, but **prohibits all AI/ML use of the code**, including training, inference, AI integrations, and supplying the code to AI coding tools, unless separately authorized in writing by the applicable copyright holder(s). It is not the standard MIT License or an OSI-approved open-source license.

Third-party components and assets retain their own licenses. Previously granted licenses are not retroactively revoked. See the license file for the full terms.

## House Edge browser analytics

The browser version includes House Edge page/view tracking, anonymous sessions, errors, and Web Vitals. Native Tauri sessions are always excluded, even when analytics environment variables are set. Named views are mapped to fixed paths; project names, file contents, and search text are not used as page names.

Create a House Edge project with key `env-reaper` and allow this site's exact origin. Set `VITE_HOUSE_EDGE_KEY` to its **browser ingestion key** and `VITE_HOUSE_EDGE_ENDPOINT` to your collector URL ending in `/api/collect`, using `.env.local` or your build environment. `.env.example` lists the settings. Rebuild and redeploy the browser version, then check Live Activity for `page_view` and `session_start` after about five seconds.

Tracking is off when the key or endpoint is missing, and development requires `VITE_HOUSE_EDGE_TRACK_DEVELOPMENT=true`. Do Not Track is respected. The SDK is installed from the checked-in `vendor/house-edge-analytics-0.1.1.tgz`, so independent builds need no sibling House Edge checkout. Commit the tarball with its package manifest and lockfile.

## macOS Release

Run `npm run release:mac:check` to validate prerequisites, then `npm run release:desktop` for Developer ID signed, notarized ARM64, Intel and universal apps/DMGs. See [macOS release setup, credentials, outputs and verification](docs/MACOS_RELEASE.md). Existing development and Windows/Linux commands remain available.
