use leptos::*;
use leptos_meta::*;
use leptos_router::*;
use code_mirror::*;
use highlight_js::*;

pub struct Search {
    pub view: View,
}

impl Search {
    pub fn new(cx: &mut Context) -> Self {
        let view = view! {
            cx,
            div(class="search-container") {
                div(class="search-input-container") {
                    input(
                        class="search-input",
                        type="text",
                        placeholder="Search",
                        oninput=|cx, input| {
                            let search_query = input.value();
                            // Handle search query
                        }
                    )
                }
                div(class="replace-input-container") {
                    input(
                        class="replace-input",
                        type="text",
                        placeholder="Replace",
                        oninput=|cx, input| {
                            let replace_query = input.value();
                            // Handle replace query
                        }
                    )
                }
                button(
                    class="search-button",
                    onmousedown=|cx, _| {
                        // Handle search button click
                    }
                ) {
                    "Search"
                }
                button(
                    class="replace-button",
                    onmousedown=|cx, _| {
                        // Handle replace button click
                    }
                ) {
                    "Replace"
                }
            }
        };

        Self { view }
    }
}

impl IntoView for Search {
    fn into_view(self) -> View {
        self.view
    }
}

#[cfg(target_arch = "wasm32")]
leptos::main!(Search::new);

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    // Handle non-wasm32 target
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search() {
        // Test search functionality
    }

    #[test]
    fn test_replace() {
        // Test replace functionality
    }
}