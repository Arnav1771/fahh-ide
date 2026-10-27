//! Installing extensions from Open VSX. Fahh has no VS Code extension host, so the one kind it
//! can really use is a colour theme: this downloads the .vsix and returns its themes' JSON
//! (the frontend converts them). Any other extension is refused with the reason.

use std::io::{Cursor, Read};

use serde::Serialize;

/// Refuse anything bigger: a theme extension is a few hundred KB.
const MAX_VSIX_BYTES: usize = 50 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ExtensionTheme {
    pub label: String,
    /// "vs" (light), "vs-dark" or "hc-black".
    pub ui_theme: String,
    /// The theme file, JSON with comments, as shipped.
    pub json: String,
    /// The theme it `include`s (its base), when it has one.
    pub include_json: Option<String>,
}

fn is_safe_id(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// "./themes/x.json" inside the package, normalised ("themes/../x.json" → "x.json").
fn join_in_package(base_dir: &str, rel: &str) -> String {
    let rel = rel.replace('\\', "/");
    let mut parts: Vec<&str> = base_dir.split('/').filter(|p| !p.is_empty()).collect();
    for seg in rel.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

fn read_entry(zip: &mut zip::ZipArchive<Cursor<Vec<u8>>>, name: &str) -> Option<String> {
    let mut f = zip.by_name(name).ok()?;
    let mut s = String::new();
    f.read_to_string(&mut s).ok()?;
    Some(s.trim_start_matches('\u{feff}').to_string())
}

/// The colour themes in a .vsix (a zip whose package lives under `extension/`).
fn themes_in_vsix(bytes: Vec<u8>) -> Result<Vec<ExtensionTheme>, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("Not a valid .vsix: {e}"))?;
    let manifest = read_entry(&mut zip, "extension/package.json").ok_or("The .vsix has no extension/package.json")?;
    let pkg: serde_json::Value = serde_json::from_str(&manifest).map_err(|e| format!("Bad package.json: {e}"))?;
    let declared = pkg["contributes"]["themes"].as_array().cloned().unwrap_or_default();
    if declared.is_empty() {
        return Err("This extension has no colour themes. Fahh can install colour themes; other VS Code extensions need an extension host, which Fahh does not have yet.".into());
    }
    let mut out = vec![];
    for t in declared {
        let Some(path) = t["path"].as_str() else { continue };
        let file = join_in_package("extension", path);
        let Some(json) = read_entry(&mut zip, &file) else { continue };
        let dir = file.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
        // `include` names a base theme next to this one; one level is what themes use.
        let include_json = include_of(&json).and_then(|inc| read_entry(&mut zip, &join_in_package(dir, &inc)));
        out.push(ExtensionTheme {
            label: t["label"].as_str().or(t["id"].as_str()).unwrap_or("Theme").to_string(),
            ui_theme: t["uiTheme"].as_str().unwrap_or("vs-dark").to_string(),
            json,
            include_json,
        });
    }
    if out.is_empty() {
        return Err("The extension declares themes but none of their files could be read.".into());
    }
    Ok(out)
}

/// The value of a top-level `"include": "…"` (theme files allow comments, so no full parse).
fn include_of(json: &str) -> Option<String> {
    let at = json.find("\"include\"")?;
    let rest = &json[at + 9..];
    let start = rest.find('"')? + 1;
    let end = rest[start..].find('"')? + start;
    Some(rest[start..end].to_string())
}

/// Download an extension from Open VSX and return its colour themes. An empty `version`
/// takes the latest one.
#[tauri::command]
pub async fn ext_install_theme(namespace: String, name: String, version: String) -> Result<Vec<ExtensionTheme>, String> {
    if !is_safe_id(&namespace) || !is_safe_id(&name) || !(version.is_empty() || is_safe_id(&version)) {
        return Err("Bad extension id.".into());
    }
    // The metadata names the download (its host can differ from open-vsx.org).
    let meta_url = if version.is_empty() {
        format!("https://open-vsx.org/api/{namespace}/{name}")
    } else {
        format!("https://open-vsx.org/api/{namespace}/{name}/{version}")
    };
    let meta = reqwest::get(&meta_url).await.map_err(|e| format!("Open VSX is unreachable: {e}"))?;
    if !meta.status().is_success() {
        return Err(format!("Open VSX has no {namespace}.{name} {version} ({}).", meta.status()));
    }
    let meta: serde_json::Value = meta.json().await.map_err(|e| format!("Bad answer from Open VSX: {e}"))?;
    let url = meta["files"]["download"].as_str().ok_or("Open VSX gave no download for this extension.")?.to_string();
    if !url.starts_with("https://") {
        return Err("Refusing a download that is not https.".into());
    }
    let res = reqwest::get(&url).await.map_err(|e| format!("Download failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Open VSX answered {} for {namespace}.{name} {version}.", res.status()));
    }
    if res.content_length().unwrap_or(0) as usize > MAX_VSIX_BYTES {
        return Err("The extension is too large to be a colour theme.".into());
    }
    let bytes = res.bytes().await.map_err(|e| format!("Download failed: {e}"))?;
    if bytes.len() > MAX_VSIX_BYTES {
        return Err("The extension is too large to be a colour theme.".into());
    }
    themes_in_vsix(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn vsix(files: &[(&str, &str)]) -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            for (name, body) in files {
                z.start_file(*name, opts).unwrap();
                z.write_all(body.as_bytes()).unwrap();
            }
            z.finish().unwrap();
        }
        buf.into_inner()
    }

    #[test]
    fn reads_themes_and_their_include() {
        let pkg = r#"{"contributes":{"themes":[{"label":"Night Owl","uiTheme":"vs-dark","path":"./themes/owl.json"}]}}"#;
        let owl = "// comment\n{ \"include\": \"./base.json\", \"colors\": {\"editor.background\": \"#011627\"} }";
        let base = r##"{"colors": {"editor.foreground": "#d6deeb"}}"##;
        let t = themes_in_vsix(vsix(&[("extension/package.json", pkg), ("extension/themes/owl.json", owl), ("extension/themes/base.json", base)])).unwrap();
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].label, "Night Owl");
        assert_eq!(t[0].ui_theme, "vs-dark");
        assert!(t[0].json.contains("#011627"));
        assert_eq!(t[0].include_json.as_deref(), Some(base));
    }

    #[test]
    fn refuses_extensions_without_themes() {
        let pkg = r#"{"contributes":{"commands":[]}}"#;
        let err = themes_in_vsix(vsix(&[("extension/package.json", pkg)])).unwrap_err();
        assert!(err.contains("extension host"), "{err}");
        assert!(themes_in_vsix(b"not a zip".to_vec()).is_err());
    }

    #[test]
    fn paths_stay_inside_the_package() {
        assert_eq!(join_in_package("extension", "./themes/a.json"), "extension/themes/a.json");
        assert_eq!(join_in_package("extension/themes", "../b.json"), "extension/b.json");
        assert!(is_safe_id("ms-python.python"));
        assert!(!is_safe_id("../evil"));
    }

    /// Hits open-vsx.org: run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn installs_a_real_theme_from_open_vsx() {
        let themes = ext_install_theme("sdras".into(), "night-owl".into(), "".into()).await.unwrap();
        assert!(themes.iter().any(|t| t.label.contains("Night Owl")), "{:?}", themes.iter().map(|t| &t.label).collect::<Vec<_>>());
        let err = ext_install_theme("ms-python".into(), "python".into(), "".into()).await.unwrap_err();
        assert!(err.contains("extension host"), "{err}");
    }
}
