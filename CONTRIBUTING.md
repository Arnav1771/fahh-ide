# Contributing to Fahh Editor

Thanks for wanting to contribute. Here's everything you need to know.

---

## Getting started

1. Fork the repo and clone your fork
2. Follow the setup in [README.md](README.md#quick-start)
3. Create a branch: `git checkout -b feat/your-feature-name`
4. Make your changes
5. Run tests: `cargo test && pnpm test`
6. Open a pull request against `main`

---

## Branch naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/short-description` | `feat/canvas-zoom` |
| Bug fix | `fix/short-description` | `fix/lsp-crash-on-empty-file` |
| Documentation | `docs/short-description` | `docs/installer-guide` |
| Refactor | `refactor/short-description` | `refactor/editor-store` |

---

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add panel detach to separate window
fix: prevent fahh sfx spam on batch LSP errors
docs: add n8n setup instructions to INSTALLER.md
refactor: extract lsp error parser into own module
```

---

## Code style

**Rust:**
- `cargo fmt` before committing (enforced in CI)
- `cargo clippy -- -D warnings` must pass
- Use `anyhow::Result` for fallible functions
- No `unwrap()` in production paths — use `?` or handle explicitly
- Every public function needs a doc comment

**TypeScript / React:**
- `pnpm lint` must pass (ESLint + Prettier)
- Strict mode — no `any`, no `// @ts-ignore`
- Functional components only, no class components
- Zustand for global state, `useState` for local
- TailwindCSS only — no inline styles, no CSS modules

---

## Testing

All new features need tests.

- **Rust unit tests:** in the same file, under `#[cfg(test)]`
- **Rust integration tests:** in `tests/`
- **Frontend component tests:** colocated as `ComponentName.test.tsx`

Run everything:

```bash
cargo test
pnpm test
```

---

## Pull request checklist

Before opening a PR, make sure:

- [ ] `cargo fmt && cargo clippy` pass with no warnings
- [ ] `pnpm lint && pnpm test` pass
- [ ] New functionality has tests
- [ ] If you changed the Fahh SFX system, `docs/FAHH_SFX.md` is updated
- [ ] If you added an optional tool to the installer, `docs/INSTALLER.md` is updated
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]`
- [ ] PR description explains what changed and why

---

## What not to do

- Do not add Docker to anything. Optional tools run as local processes.
- Do not rename or move `src-tauri/assets/fahhhh.mp3`. It will break the SFX.
- Do not hardcode an AI provider. Use MCP.
- Do not use Electron. This is a Tauri 2 project.

---

## Need help?

Open an issue. Include your OS, Rust version (`rustc --version`), and Node version
(`node --version`), and the full error output.
