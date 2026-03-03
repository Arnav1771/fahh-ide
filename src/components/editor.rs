use leptos::*;
use leptos_meta::*;
use leptos_router::*;
use leptos_storage::*;
use std::collections::HashMap;

pub struct Editor {
    pub id: String,
    pub code: String,
    pub language: String,
}

impl Editor {
    pub fn new(id: String, code: String, language: String) -> Self {
        Self { id, code, language }
    }
}

#[component]
pub fn Editor(cx: Scope, id: String, code: String, language: String) {
    let editor = use_state(&cx, || Editor::new(id.clone(), code.clone(), language.clone()));

    let on_change = move |code: String| {
        editor.update(|editor| editor.code = code);
    };

    view! {
        cx,
        <div class="editor">
            <div class="editor-header">
                <h2>{editor.id.clone()}</h2>
            </div>
            <div class="editor-body">
                <CodeMirror
                    code={editor.code.clone()}
                    language={editor.language.clone()}
                    on_change={on_change}
                />
            </div>
        </div>
    }
}

#[component]
pub fn CodeMirror(cx: Scope, code: String, language: String, on_change: impl Fn(String) + 'static) {
    let codemirror = use_state(&cx, || {
        let mut codemirror = HashMap::new();
        codemirror.insert("code", code.clone());
        codemirror.insert("language", language.clone());
        codemirror
    });

    let on_input = move |event: InputEvent| {
        let code = event.target.value.clone();
        on_change(code);
    };

    view! {
        cx,
        <div class="codemirror">
            <textarea
                class="codemirror-textarea"
                value={codemirror.get("code").unwrap().clone()}
                oninput={on_input}
            />
            <div class="codemirror-editor" />
        </div>
    }
}

pub fn main() {
    console_log::init_with_level(log::Level::Debug).unwrap();
    leptos::start("editor", Editor::new("editor".to_string(), "".to_string(), "rust".to_string()));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_editor() {
        let editor = Editor::new("editor".to_string(), "fn main() {}".to_string(), "rust".to_string());
        assert_eq!(editor.id, "editor");
        assert_eq!(editor.code, "fn main() {}");
        assert_eq!(editor.language, "rust");
    }
}