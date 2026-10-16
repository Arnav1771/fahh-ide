//! Fahh Local in a terminal. All logic lives in `fahh_editor_lib::agent::cli`.
#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::process::exit(fahh_editor_lib::agent::cli::main_cli(args, None).await);
}
