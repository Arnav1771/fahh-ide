use std::io::Write;
use std::time::Duration;
use std::thread;

fn main() {
    println!("Hello from Rust!");
    for i in 1..=3 {
        println!("Streaming output {}/3...", i);
        std::io::stdout().flush().unwrap();
        thread::sleep(Duration::from_millis(500));
    }
    println!("Rust execution complete.");
}
