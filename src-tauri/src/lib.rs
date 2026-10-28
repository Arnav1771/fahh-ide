// Phase 2 modules contain WIP stub implementations — suppress lint noise
// until each feature is fully wired. Remove these as features land.
#![allow(dead_code, unused_imports, unused_variables, unused_mut)]

mod core;
mod app;
pub mod agent;

use core::{editor, workspace, terminal, installer, state, runner, lsp_client, debugger, pty, remote, extensions, watch, account, formatter, plugin, error_detector, git, preview, syntax, setup};

pub fn run() {
    core::runtime::init_logging();

    tauri::Builder::default()
        // First, so a second `fahh <path>` is forwarded to the running window instead of starting another.
        .plugin(tauri_plugin_single_instance::init(app::on_second_launch))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(state::AppState::default())
        .manage(app::cli::PendingOpen::default())
        .manage(lsp_client::LspState::default())
        .manage(error_detector::ErrorDetector::default())
        .manage(agent::AgentState::default())
        .invoke_handler(tauri::generate_handler![
            // `fahh <path>` command line
            app::take_pending_open,
            app::open_new_window,
            app::cli::install_cli,
            // Workspace / file operations
            workspace::get_file_tree,
            workspace::read_file,
            workspace::write_file,
            workspace::create_file,
            workspace::delete_file,
            workspace::rename_file,
            workspace::create_dir,
            workspace::move_path,
            workspace::reveal_path,
            workspace::search_workspace,
            workspace::replace_in_workspace,
            // Editor / document management
            editor::open_document,
            editor::close_document,
            editor::get_open_documents,
            // Terminal
            terminal::execute_command,
            terminal::write_stdin,
            terminal::launch_agy_terminal,
            // Fahh SFX trigger (core feature)
            error_detector::trigger_error_sound,
            // Syntax errors for Python and Rust without a language server
            syntax::syntax_check,
            // First run: Check Setup and the custom error sound
            setup::check_setup,
            setup::set_custom_sound,
            setup::load_custom_sound,
            setup::clear_custom_sound,
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
            debugger::debug_request,
            debugger::debug_stop,
            pty::terminal_profiles,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            remote::remote_wsl_distros,
            remote::remote_wsl_home,
            remote::remote_ssh_hosts,
            remote::remote_containers,
            extensions::ext_install_theme,
            watch::watch_workspace,
            account::account_status,
            account::account_sign_up,
            account::account_sign_in,
            account::account_sign_out,
            account::account_send_code,
            account::account_verify_email,
            account::account_reset_password,
            account::account_set_newsletter,
            account::cloud_announcements,
            account::account_push_settings,
            account::account_pull_settings,
            // Formatter (Phase 2)
            formatter::format_file,
            // Plugin registry (Phase 2)
            plugin::get_plugins,
            plugin::get_themes,
            plugin::get_language_packs,
            plugin::get_formatter_plugins,
            plugin::get_snippet_plugins,
            // Git / source control
            git::git_status,
            git::git_current_branch,
            git::git_stage,
            git::git_unstage,
            git::git_commit,
            git::git_diff,
            // Previews: let the asset protocol load the opened folder
            preview::allow_preview,
            // Fahh Local agent
            agent::agent_start,
            agent::agent_approve,
            agent::agent_stop,
            agent::agent_stop_child,
            agent::agent_list_models,
            agent::agent_sessions,
            agent::agent_session_load,
            agent::agent_session_fork,
            agent::agent_session_revert,
            agent::agent_session_rename,
            agent::agent_session_remove,
            agent::agent_steps,
            agent::agent_compact,
            agent::agent_context,
            agent::agent_usage,
            agent::agent_export,
            agent::agent_agents,
            agent::agent_revert_turn,
            agent::agent_revert_file,
            agent::agent_turn_diff,
            agent::agent_set_diagnostics,
        ])
        .setup(|app| {
            app::setup(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Fahh Editor");
}
