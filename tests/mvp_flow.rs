use fahh_ide::app::AppBootstrap;
use std::fs;

#[tokio::test]
async fn initializes_mvp_runtime_and_languages() {
    let workspace = tempfile::tempdir().expect("tempdir should create");
    fs::write(workspace.path().join("main.rs"), "fn main() {}\n").expect("write should succeed");
    fs::write(workspace.path().join("app.py"), "print('hello')\n").expect("write should succeed");
    fs::write(workspace.path().join("ui.ts"), "export const app = 1;\n")
        .expect("write should succeed");

    let state_path = workspace.path().join(".fahh/session.json");
    let app = AppBootstrap::new(workspace.path(), &state_path)
        .initialize()
        .await
        .expect("app should initialize");

    assert_eq!(
        app.language_registry
            .resolve_for_extension("rs")
            .unwrap()
            .id(),
        "rust"
    );
    assert_eq!(
        app.language_registry
            .resolve_for_extension("py")
            .unwrap()
            .id(),
        "python"
    );
    assert_eq!(
        app.language_registry
            .resolve_for_extension("ts")
            .unwrap()
            .id(),
        "typescript"
    );

    let metadata = app
        .workspace_metadata()
        .await
        .expect("workspace should scan");
    assert!(metadata
        .files
        .iter()
        .any(|file| file.to_string_lossy().ends_with("main.rs")));
}
