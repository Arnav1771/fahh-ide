use leptos::*;
use leptos_meta::*;
use leptos_router::*;

pub struct Terminal {
    pub id: String,
}

impl Component for Terminal {
    fn component_id() -> &'static str {
        "terminal"
    }

    fn create(_cx: &mut Context, _props: Props) -> Self {
        Terminal {
            id: "terminal-1".to_string(),
        }
    }

    fn view(&self, _cx: &mut Context) -> Node {
        view! {
            div(class="terminal-container", id=self.id) {
                div(class="terminal-header") {
                    span(class="terminal-title") { "Terminal" }
                }
                div(class="terminal-body") {
                    div(class="terminal-output") {
                        pre(class="terminal-text") {
                            "Welcome to the terminal!"
                        }
                    }
                    div(class="terminal-input") {
                        input(
                            class="terminal-input-field",
                            type_"text",
                            placeholder="Type a command...",
                            oninput=|_: &_| {}
                        )
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_terminal_component() {
        let mut cx = Context::new();
        let terminal = Terminal::create(&mut cx, Props::default());
        let node = terminal.view(&mut cx);
        assert!(node.find(".terminal-container").is_some());
    }
}