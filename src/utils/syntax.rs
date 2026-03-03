use leptos::*;
use leptos_meta::*;
use leptos_router::*;
use wasm_bindgen::JsCast;
use web_sys::{HtmlElement, HtmlPreElement};
use js_sys::Promise;

pub fn syntax_highlighting(cx: Scope, code: &str, language: &str) -> Element {
    let code = create_memo(cx, move || code);
    let language = create_memo(cx, move || language);
    let highlighted_code = create_signal(cx, String::new());
    let error = create_signal(cx, String::new());

    create_effect(cx, move || {
        let code = code.get();
        let language = language.get();
        let window = web_sys::window().unwrap();
        let highlight_js = window
            .dyn_ref::<web_sys::HtmlScriptElement>("highlightJs")
            .unwrap();
        if highlight_js.is_none() {
            let script = window
                .document()
                .unwrap()
                .create_element("script")
                .unwrap()
                .dyn_into::<web_sys::HtmlScriptElement>()
                .unwrap();
            script.set_src("https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.6.0/highlight.min.js");
            window
                .document()
                .unwrap()
                .body()
                .unwrap()
                .append_child(&script)
                .unwrap();
            let promise = Promise::new(&mut |resolve, reject| {
                let callback = Closure::wrap(Box::new(move || {
                    resolve.call1(&JsValue::NULL, &JsValue::from_str("loaded")).unwrap();
                }) as Box<dyn FnMut()>);
                script.set_onload(Some(callback.as_ref().unchecked_ref()));
                callback.forget();
            });
            promise.await.unwrap();
        }
        let window = web_sys::window().unwrap();
        let hljs = window.dyn_ref::<js_sys::Function>("hljs").unwrap().unwrap();
        let result = hljs.call2(&JsValue::from_str("highlightBlock"), &JsValue::from_str(language)).unwrap();
        let highlighted_code = result.as_string().unwrap();
        highlighted_code.set(highlighted_code);
        error.set(String::new());
    });

    view! {
        cx,
        {
            if *error.get() != "" {
                view! {
                    cx,
                    {
                        div(class="error") {
                            *error.get()
                        }
                    }
                }
            } else {
                view! {
                    cx,
                    {
                        pre(class="code-block") {
                            code(class=language, inner_html={highlighted_code.get().clone()}) {
                                *code.get()
                            }
                        }
                    }
                }
            }
        }
    }
}

pub fn init_highlight_js(cx: Scope) {
    let window = web_sys::window().unwrap();
    let link = window
        .document()
        .unwrap()
        .create_element("link")
        .unwrap()
        .dyn_into::<web_sys::HtmlLinkElement>()
        .unwrap();
    link.set_rel("stylesheet");
    link.set_href("https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.6.0/styles/monokai.min.css");
    window
        .document()
        .unwrap()
        .head()
        .unwrap()
        .append_child(&link)
        .unwrap();
}

pub fn use_syntax_highlighting(cx: Scope, code: &str, language: &str) -> Element {
    let highlighted_code = syntax_highlighting(cx, code, language);
    highlighted_code
}