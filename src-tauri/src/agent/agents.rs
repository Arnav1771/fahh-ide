//! Subagent definitions: markdown files with YAML-ish frontmatter.
//!
//!   ---
//!   name: explore
//!   description: Read-only search and summary
//!   model: optional-model-name
//!   mode: plan | ask | accept-edits | normal | read-only   (a ceiling, never above the parent's)
//!   max_steps: 12
//!   ---
//!   Instructions for the agent...
//!
//! Sources, later wins: built-ins, user (`~/.fahh/agents`), project (`.fahh/agents`).
//! A bad file is skipped and reported, like `devin doctor`.

use super::perm::Mode;
use std::path::Path;

#[derive(Debug, Clone, PartialEq)]
pub struct AgentDef {
    pub name: String,
    pub description: String,
    pub model: Option<String>,
    pub mode: Mode,
    pub max_steps: u32,
    pub body: String,
    pub source: String,
}

pub fn parse_def(text: &str, source: &str) -> Result<AgentDef, String> {
    let text = text.trim_start_matches('\u{feff}');
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return Err("missing frontmatter (the file must start with ---)".into());
    }
    let (mut name, mut description, mut model, mut mode, mut max_steps) = (None, None, None, Mode::Ask, 12u32);
    let mut closed = false;
    let mut body = Vec::new();
    for line in lines.by_ref() {
        if line.trim() == "---" {
            closed = true;
            break;
        }
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let (k, v) = line.split_once(':').ok_or_else(|| format!("bad frontmatter line `{}`", line.trim()))?;
        let v = v.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
        match k.trim() {
            "name" => name = Some(v),
            "description" => description = Some(v),
            "model" if !v.is_empty() => model = Some(v),
            "mode" | "tools" => mode = Mode::parse(&v).ok_or_else(|| format!("unknown mode `{v}`"))?,
            "max_steps" => max_steps = v.parse().ok().filter(|n| (1..=50).contains(n)).ok_or("max_steps must be 1 to 50")?,
            _ => {} // unknown keys are ignored so files can carry extras
        }
    }
    if !closed {
        return Err("frontmatter is not closed (missing the second ---)".into());
    }
    body.extend(lines);
    let name = name.filter(|n| !n.is_empty()).ok_or("missing `name`")?;
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(format!("name `{name}` may only use letters, digits, - and _"));
    }
    Ok(AgentDef {
        name,
        description: description.unwrap_or_default(),
        model,
        mode,
        max_steps,
        body: body.join("\n").trim().to_string(),
        source: source.into(),
    })
}

pub fn builtins() -> Vec<AgentDef> {
    let d = |name: &str, description: &str, mode, max_steps, body: &str| AgentDef {
        name: name.into(),
        description: description.into(),
        model: None,
        mode,
        max_steps,
        body: body.into(),
        source: "builtin".into(),
    };
    vec![
        d(
            "explore",
            "Read-only: search the codebase and report what you find",
            Mode::Qa,
            12,
            "You explore code. Search and read as needed, then answer with the relevant file paths and line numbers and a short explanation of what the code does. Never guess: if you cannot find it, say so. You cannot change anything.",
        ),
        d(
            "reviewer",
            "Reviews a diff against the original request",
            Mode::Qa,
            8,
            "You review code changes. You get the request and a diff. Look for bugs, missed requirements, broken edge cases and unsafe code; read surrounding files if needed. Your reply's FIRST line must be exactly APPROVED, or CHANGES followed by concrete fix instructions on the next lines. Do not nitpick style.",
        ),
        d(
            "planner",
            "Researches read-only, then writes a plan file",
            Mode::Plan,
            15,
            "You plan work. Research with the read tools and read-only commands, then call write_plan with a concrete step-by-step plan (files to touch, order, how to verify). Reply with a one-paragraph summary of the plan.",
        ),
    ]
}

/// Built-ins, then user, then project definitions. Returns what loaded and what was skipped.
pub fn load_all(project_root: &Path, user_dir: Option<&Path>) -> (Vec<AgentDef>, Vec<String>) {
    let mut defs = builtins();
    let mut problems = Vec::new();
    let mut read = |dir: &Path, source: &str| {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut files: Vec<_> = rd.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.extension().map(|x| x == "md").unwrap_or(false)).collect();
        files.sort();
        for p in files {
            let label = format!("{source}/{}", p.file_name().unwrap().to_string_lossy());
            match std::fs::read_to_string(&p).map_err(|e| e.to_string()).and_then(|t| parse_def(&t, source)) {
                Ok(def) => {
                    defs.retain(|d| d.name != def.name);
                    defs.push(def);
                }
                Err(e) => problems.push(format!("{label}: {e}")),
            }
        }
    };
    if let Some(u) = user_dir {
        read(u, "user");
    }
    read(&project_root.join(".fahh").join("agents"), "project");
    (defs, problems)
}

pub fn user_dir() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".fahh").join("agents"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = "---\nname: docs\ndescription: \"Writes docs\"\nmodel: small-model\nmode: accept-edits\nmax_steps: 5\n---\nWrite docs.\nBe brief.\n";

    #[test]
    fn parses_a_definition() {
        let d = parse_def(GOOD, "project").unwrap();
        assert_eq!((d.name.as_str(), d.description.as_str(), d.model.as_deref(), d.mode, d.max_steps), ("docs", "Writes docs", Some("small-model"), Mode::AutoEdit, 5));
        assert_eq!(d.body, "Write docs.\nBe brief.");
    }

    #[test]
    fn defaults_and_aliases() {
        let d = parse_def("---\nname: x\ntools: read-only\n---\nbody", "user").unwrap();
        assert_eq!((d.mode, d.max_steps, d.model), (Mode::Qa, 12, None));
    }

    #[test]
    fn bad_frontmatter_is_an_error() {
        assert!(parse_def("no frontmatter", "p").unwrap_err().contains("frontmatter"));
        assert!(parse_def("---\nname: x\nbody", "p").unwrap_err().contains("not closed"));
        assert!(parse_def("---\ndescription: d\n---\n", "p").unwrap_err().contains("name"));
        assert!(parse_def("---\nname: x\nmode: godlike\n---\n", "p").unwrap_err().contains("mode"));
        assert!(parse_def("---\nname: x\nmax_steps: 500\n---\n", "p").unwrap_err().contains("max_steps"));
        assert!(parse_def("---\nname: bad name!\n---\n", "p").unwrap_err().contains("may only"));
        assert!(parse_def("---\nname x\n---\n", "p").unwrap_err().contains("bad frontmatter line"));
    }

    #[test]
    fn loads_with_precedence_and_reports_bad_files() {
        let proj = tempfile::tempdir().unwrap();
        let user = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(proj.path().join(".fahh/agents")).unwrap();
        std::fs::write(proj.path().join(".fahh/agents/docs.md"), GOOD).unwrap();
        std::fs::write(proj.path().join(".fahh/agents/broken.md"), "oops").unwrap();
        std::fs::write(proj.path().join(".fahh/agents/notes.txt"), "ignored").unwrap();
        std::fs::write(user.path().join("explore.md"), "---\nname: explore\ndescription: mine\n---\nmy explore").unwrap();
        std::fs::write(proj.path().join(".fahh/agents/explore.md"), "---\nname: explore\ndescription: project one\n---\nx").unwrap();
        let (defs, problems) = load_all(proj.path(), Some(user.path()));
        let names: Vec<_> = defs.iter().map(|d| d.name.as_str()).collect();
        for n in ["reviewer", "planner", "docs", "explore"] {
            assert!(names.contains(&n), "{names:?}");
        }
        assert_eq!(defs.iter().filter(|d| d.name == "explore").count(), 1);
        assert_eq!(defs.iter().find(|d| d.name == "explore").unwrap().description, "project one"); // project beats user beats built-in
        assert_eq!(problems.len(), 1);
        assert!(problems[0].starts_with("project/broken.md"), "{problems:?}");
    }

    #[test]
    fn builtins_are_read_only_or_plan() {
        let b = builtins();
        assert_eq!(b.iter().map(|d| d.name.as_str()).collect::<Vec<_>>(), vec!["explore", "reviewer", "planner"]);
        assert!(b.iter().all(|d| d.mode.read_only()));
    }
}
