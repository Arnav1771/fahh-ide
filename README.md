# fahh-ide (Rust MVP Rebuild)

This repository now contains a clean, Rust-first MVP foundation for a fast and stable IDE architecture.

## MVP Scope

- Workspace/project file explorer metadata scanning
- Tabbed editor model with undo/redo and dirty-state tracking
- Integrated terminal task runner abstraction
- Diagnostics engine abstraction
- Multi-language support via LSP provider abstraction (Rust, Python, TypeScript/JavaScript)
- Plugin-style capability registry for future language/tool extensions
- Session state restore/load foundation
- Startup quality gate definitions for release checks

## Architecture

- `src/app/` - application bootstrap and startup orchestration
- `src/core/editor.rs` - document model and tab management
- `src/core/workspace.rs` - async workspace scanning and cache structures
- `src/core/terminal.rs` - run/build task execution abstraction
- `src/core/lsp.rs` - language server abstraction + default providers
- `src/core/plugin.rs` - capability-oriented plugin registry
- `src/core/state.rs` - persisted session restore/save
- `src/core/runtime.rs` - logging and panic boundary setup
- `src/core/quality.rs` - acceptance gates (startup, memory, crashes, tests)

## Milestones

1. Core shell/bootstrap and quality gates
2. Editor + workspace indexing
3. Terminal/tasks integration
4. LSP + diagnostics wiring
5. Packaging/performance hardening

## Run

```bash
cargo run -- /path/to/workspace
```

## Test

```bash
cargo test
```
