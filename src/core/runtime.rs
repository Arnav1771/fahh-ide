use tracing_subscriber::EnvFilter;

pub fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}

pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        tracing::error!("panic boundary triggered: {info}");
    }));
}
