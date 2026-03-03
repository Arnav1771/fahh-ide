use leptos::*;
use leptos_meta::*;
use leptos_router::*;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn main() {
    console_error_panic_hook::set_once();
    console_log::init_with_level(log::Level::Debug).unwrap();

    leptos::mount(_app);
}

#[component]
fn App(cx: Scope) {
    provide_context(cx, Meta::new(
        "FAHH IDE",
        "https://fahh-ide.com",
        "Ultra-Fast Lightweight IDE",
    ));

    view! {
        cx,
        <Router>
            <Route path="/" component=|cx| view! { cx, <Home /> } />
            <Route path="/editor" component=|cx| view! { cx, <Editor /> } />
        </Router>
    }
}

#[component]
fn Home(cx: Scope) {
    let (dark_mode, set_dark_mode) = create_signal(cx, false);

    view! {
        cx,
        <div class="app-container">
            <header class="header">
                <nav class="nav">
                    <ul>
                        <li><a href="#editor">Editor</a></li>
                    </ul>
                </nav>
            </header>
            <main class="main">
                <h1 class="title">FAHH IDE</h1>
                <p class="description">Ultra-Fast Lightweight IDE</p>
                <button class="toggle-button" onclick=|_| set_dark_mode(!*dark_mode)>
                    { if *dark_mode { "Light" } else { "Dark" } }
                </button>
            </main>
        </div>
    }
}

#[component]
fn Editor(cx: Scope) {
    let (code, set_code) = create_signal(cx, "");
    let (language, set_language) = create_signal(cx, "rust");

    view! {
        cx,
        <div class="editor-container">
            <div class="editor-header">
                <select class="language-select" onchange=|event| set_language(event.target_value())>
                    <option value="rust">Rust</option>
                    <option value="python">Python</option>
                </select>
            </div>
            <div class="editor-body">
                <CodeMirror
                    code={code}
                    language={language}
                    on_change=|new_code| set_code(new_code)
                />
            </div>
        </div>
    }
}

#[component]
struct CodeMirror(cx: Scope, props: Props) {
    let code = props.code;
    let language = props.language;
    let on_change = props.on_change;

    view! {
        cx,
        <div class="code-mirror">
            <textarea
                class="code-mirror-textarea"
                value={*code}
                oninput=|event| on_change(event.target_value())
            />
            <div class="code-mirror-highlight">
                <pre>
                    <code class={format!("language-{}", *language)}>
                        { *code }
                    </code>
                </pre>
            </div>
        </div>
    }
}

struct Props {
    code: RcSignal<String>,
    language: RcSignal<String>,
    on_change: RcSignal<String>,
}

impl Props {
    fn code(&self) -> String {
        self.code.get()
    }

    fn language(&self) -> String {
        self.language.get()
    }

    fn on_change(&self, new_code: String) {
        self.on_change.set(new_code);
    }
}

fn main() {
    leptos::mount(_app);
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn start() {
        main();
    }
}