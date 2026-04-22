use crate::core::diagnostics::DiagnosticEngine;
use crate::core::editor::TabManager;
use crate::core::frontend::{FrontendAdapter, NullFrontend};
use crate::core::lsp::LanguageRegistry;
use crate::core::plugin::PluginRegistry;
use crate::core::state::{SessionState, StateStore};
use crate::core::terminal::TaskRunner;
use crate::core::workspace::{scan_workspace, WorkspaceMetadata};
use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::task::JoinHandle;

pub struct AppBootstrap {
    workspace_root: PathBuf,
    state_store: StateStore,
}

pub struct RunningApp {
    pub started_at: Instant,
    pub state: SessionState,
    pub tabs: TabManager,
    pub diagnostics: DiagnosticEngine,
    pub task_runner: TaskRunner,
    pub language_registry: LanguageRegistry,
    pub plugin_registry: PluginRegistry,
    pub frontend: Arc<dyn FrontendAdapter>,
    workspace_loader: JoinHandle<Result<WorkspaceMetadata>>,
}

impl AppBootstrap {
    pub fn new(workspace_root: impl Into<PathBuf>, state_path: impl Into<PathBuf>) -> Self {
        Self {
            workspace_root: workspace_root.into(),
            state_store: StateStore::new(state_path),
        }
    }

    pub async fn initialize(self) -> Result<RunningApp> {
        let started_at = Instant::now();
        let workspace_root = self.workspace_root.clone();
        let workspace_loader = tokio::task::spawn_blocking(move || {
            scan_workspace(&workspace_root, 6).map_err(Into::into)
        });

        let state = self.state_store.load()?;
        let frontend: Arc<dyn FrontendAdapter> = Arc::new(NullFrontend);
        frontend.notify_first_paint_ready();
        frontend.restore_state(&state);

        Ok(RunningApp {
            started_at,
            state,
            tabs: TabManager::default(),
            diagnostics: DiagnosticEngine::default(),
            task_runner: TaskRunner,
            language_registry: LanguageRegistry::with_defaults(),
            plugin_registry: PluginRegistry::default(),
            frontend,
            workspace_loader,
        })
    }
}

impl RunningApp {
    pub fn startup_ms(&self) -> u128 {
        self.started_at.elapsed().as_millis()
    }

    pub async fn workspace_metadata(self) -> Result<WorkspaceMetadata> {
        self.workspace_loader.await?
    }
}
