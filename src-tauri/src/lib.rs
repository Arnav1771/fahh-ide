mod core;
mod app;

use core::{editor, workspace, terminal, installer, state};

pub fn run() {
    core::runtime::init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            workspace::get_file_tree,
            workspace::read_file,
            workspace::write_file,
            workspace::create_file,
            workspace::delete_file,
            workspace::rename_file,
            editor::open_document,
            editor::close_document,
            editor::get_open_documents,
            terminal::execute_command,
            terminal::write_stdin,
            installer::get_tool_status,
            installer::install_tool,
            state::load_config,
            state::save_config,
        ])
        .setup(|app| {
            app::setup(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Fahh Editor");
}
