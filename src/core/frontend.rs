use crate::core::state::SessionState;

pub trait FrontendAdapter: Send + Sync {
    fn notify_first_paint_ready(&self);
    fn restore_state(&self, state: &SessionState);
}

#[derive(Default)]
pub struct NullFrontend;

impl FrontendAdapter for NullFrontend {
    fn notify_first_paint_ready(&self) {}

    fn restore_state(&self, _state: &SessionState) {}
}
