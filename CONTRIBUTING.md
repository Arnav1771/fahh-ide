# Contributing to This Project 🤝

Thank you for your interest in contributing! We welcome bug fixes, documentation improvements, new features, and performance optimizations.

---

## ⚡ Quick Start (5-Minute On-Ramp)

1. **Fork and Clone**:
   ```bash
   git clone https://github.com/<your-username>/<repo-name>.git
   cd <repo-name>
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Verify Everything Passes**:
   ```bash
   npm test
   ```

4. **Create a Feature Branch**:
   ```bash
   git checkout -b feat/my-awesome-improvement
   ```

---

## 📐 Development Guidelines

- **Standard Library First (Ponytail Rule)**: Avoid pulling in heavy external dependencies if standard platform features or native modules suffice.
- **Test Before Submitting**: Always write unit tests under `test/` for any new logic or bugfixes.
- **Conventional Commits**: Format your commit messages clearly:
  - `feat: add automated token burn alert`
  - `fix: resolve race condition in process scanner`
  - `docs: update setup instructions`

---

## 🏷️ Looking for Tasks?

Check out our [Issue Tracker](../../issues) filtered by:
- `good first issue`: Accessible, well-scoped tasks ideal for newcomers.
- `help wanted`: Strategic enhancements where community ideas are celebrated.
- `bounty`: Prioritized high-impact tasks.

---

## 🚀 Submitting Your Pull Request

1. Push your branch:
   ```bash
   git push origin feat/my-awesome-improvement
   ```
2. Open a Pull Request against `main`.
3. Our GitHub Actions CI/CD will immediately run tests across Ubuntu, Windows, and macOS.
4. Once tests pass and review is approved, your code will be merged into the core project!
