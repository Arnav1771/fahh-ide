# fahh-ide Technical Docs (MVP Rebuild)

## Goals

- Fast startup
- Stable core workflows
- Multi-language extensibility

## Core Boundaries

- App bootstrap (`src/app/bootstrap.rs`): async startup, lazy workspace scan kickoff, state restore wiring
- Core domain (`src/core/*`): editor model, workspace scan, terminal task runner, diagnostics, language abstraction, plugin registry
- Frontend boundary (`src/core/frontend.rs`): adapter trait for UI integration (Tauri/web shell implementation can be plugged later)

## Stability Foundations

- Structured logging (`tracing`)
- Panic boundary hook
- Session state persistence abstraction
- Quality gate thresholds for release acceptance

## Language Support

Language providers are registered through `LanguageRegistry` and currently include:

- Rust (`.rs`)
- Python (`.py`)
- TypeScript/JavaScript (`.ts`, `.tsx`, `.js`, `.jsx`)

## Testing

- Unit tests for editor, workspace, quality gates, state persistence, plugin registry, and language registry
- Integration test for end-to-end bootstrap and language resolution
