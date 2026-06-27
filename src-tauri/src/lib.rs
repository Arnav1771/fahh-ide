// Phase 2 modules contain WIP stub implementations — suppress lint noise
// until each feature is fully wired. Remove these as features land.
#![allow(dead_code, unused_imports, unused_variables, unused_mut)]

mod core;
mod app;

use core::{editor, workspace, terminal, installer, state, runner, lsp_client, debugger, formatter, plugin};

pub fn run() {
    core::runtime::init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(state::AppState::default())
        .manage(lsp_client::LspState::default())
        .invoke_handler(tauri::generate_handler![
            // Workspace / file operations
            workspace::get_file_tree,
            workspace::read_file,
            workspace::write_file,
            workspace::create_file,
            workspace::delete_file,
            workspace::rename_file,
            // Editor / document management
            editor::open_document,
            editor::close_document,
            editor::get_open_documents,
            // Terminal
            terminal::execute_command,
            terminal::write_stdin,
            // Optional tool installer
            installer::get_tool_status,
            installer::install_tool,
            // Persistent config
            state::load_config,
            state::save_config,
            // Code runner (Phase 2)
            runner::run_file,
            runner::stop_run,
            // LSP client (Phase 2)
            lsp_client::lsp_start,
            lsp_client::lsp_send,
            lsp_client::lsp_stop,
            // Debugger / DAP (Phase 2)
            debugger::debug_start,
            debugger::debug_continue,
            debugger::debug_step_over,
            debugger::debug_step_in,
            debugger::debug_stop,
            debugger::debug_set_breakpoints,
            // Formatter (Phase 2)
            formatter::format_file,
            // Plugin registry (Phase 2)
            plugin::get_plugins,
            plugin::get_themes,
            plugin::get_language_packs,
            plugin::get_formatter_plugins,
            plugin::get_snippet_plugins,
        ])
        .setup(|app| {
            app::setup(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Fahh Editor");
}
