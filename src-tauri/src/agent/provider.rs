//! Model providers: OpenAI-compatible chat completions (Groq, NVIDIA NIM,
//! OpenRouter, Ollama, ...) and the Anthropic messages API, both with tool
//! calling and streaming, plus a scripted mock so the loop runs without keys.
//!
//! Request building and stream parsing are plain functions over JSON/strings,
//! so they are tested without any network. The API key lives only inside
//! `ProviderConfig` (redacted in `Debug`), is sent as a header, and is never
//! logged or placed in an error message.

use super::tools::ToolSpec;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolCall {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub args: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "role", rename_all = "snake_case")]
pub enum Msg {
    User { text: String },
    Assistant { text: String, calls: Vec<ToolCall> },
    ToolResult { id: String, name: String, content: String },
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct ModelTurn {
    pub text: String,
    pub calls: Vec<ToolCall>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    Openai,
    Anthropic,
}

#[derive(Clone, Deserialize)]
pub struct ProviderConfig {
    pub kind: ProviderKind,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
}

impl std::fmt::Debug for ProviderConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProviderConfig")
            .field("kind", &self.kind)
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("api_key", &self.api_key.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

pub type ScriptFn = Box<dyn Fn(&str, &[Msg]) -> ModelTurn + Send + Sync>;

pub enum Provider {
    Http(ProviderConfig),
    /// Pops one scripted turn per model call; used by tests and demos.
    Mock(Mutex<VecDeque<ModelTurn>>),
    /// Answers from the system prompt and history: deterministic under concurrency (subagent tests).
    Scripted(ScriptFn),
}

impl std::fmt::Debug for Provider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Provider::Http(c) => write!(f, "Http({c:?})"),
            Provider::Mock(_) => write!(f, "Mock"),
            Provider::Scripted(_) => write!(f, "Scripted"),
        }
    }
}

impl Provider {
    pub fn mock(turns: Vec<ModelTurn>) -> Self {
        Provider::Mock(Mutex::new(turns.into()))
    }

    pub fn model_name(&self) -> Option<&str> {
        match self {
            Provider::Http(c) => Some(&c.model),
            _ => None,
        }
    }

    /// Same provider with another model name (a subagent's `model:`). Mocks are shared as they are.
    pub fn with_model(&self, model: &str) -> Option<Provider> {
        match self {
            Provider::Http(c) => Some(Provider::Http(ProviderConfig { model: model.into(), ..c.clone() })),
            _ => None,
        }
    }

    pub async fn complete(
        &self,
        system: &str,
        history: &[Msg],
        tools: &[ToolSpec],
        cancel: &AtomicBool,
        on_text: &mut (dyn FnMut(&str) + Send),
    ) -> Result<ModelTurn, String> {
        match self {
            Provider::Mock(q) => {
                let turn = q.lock().unwrap().pop_front().ok_or("mock provider has no more scripted turns")?;
                if !turn.text.is_empty() {
                    on_text(&turn.text);
                }
                Ok(turn)
            }
            Provider::Scripted(f) => {
                let turn = f(system, history);
                if !turn.text.is_empty() {
                    on_text(&turn.text);
                }
                Ok(turn)
            }
            Provider::Http(cfg) => http_complete(cfg, system, history, tools, cancel, on_text).await,
        }
    }
}

// ─── SSE framing ──────────────────────────────────────────────────────────────

/// Collects bytes and yields complete `data:` payloads (chunks can split anywhere).
#[derive(Default)]
pub struct SseBuf {
    buf: String,
}

impl SseBuf {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buf.push_str(&String::from_utf8_lossy(bytes).replace("\r\n", "\n"));
        let mut out = Vec::new();
        while let Some(i) = self.buf.find("\n\n") {
            let event: String = self.buf.drain(..i + 2).collect();
            for line in event.lines() {
                if let Some(d) = line.strip_prefix("data:") {
                    let d = d.trim();
                    if !d.is_empty() {
                        out.push(d.to_string());
                    }
                }
            }
        }
        out
    }
}

// ─── OpenAI-compatible ────────────────────────────────────────────────────────

pub fn openai_url(base: &str) -> String {
    format!("{}/chat/completions", base.trim().trim_end_matches('/'))
}

pub fn openai_body(model: &str, system: &str, history: &[Msg], tools: &[ToolSpec]) -> Value {
    let mut messages = vec![json!({"role": "system", "content": system})];
    for m in history {
        messages.push(match m {
            Msg::User { text } => json!({"role": "user", "content": text}),
            Msg::Assistant { text, calls } => {
                let mut v = json!({"role": "assistant", "content": if text.is_empty() { Value::Null } else { json!(text) }});
                if !calls.is_empty() {
                    v["tool_calls"] = calls
                        .iter()
                        .map(|c| json!({"id": c.id, "type": "function", "function": {"name": c.name, "arguments": c.args.to_string()}}))
                        .collect();
                }
                v
            }
            Msg::ToolResult { id, content, .. } => json!({"role": "tool", "tool_call_id": id, "content": content}),
        });
    }
    let mut body = json!({"model": model, "messages": messages, "stream": true});
    if !tools.is_empty() {
        body["tools"] = tools
            .iter()
            .map(|t| json!({"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}}))
            .collect();
    }
    body
}

#[derive(Default)]
pub struct OpenAiAcc {
    text: String,
    calls: BTreeMap<usize, (String, String, String)>, // index -> (id, name, args json text)
}

impl OpenAiAcc {
    /// Feed one `data:` payload; returns the new text, if any.
    pub fn feed(&mut self, data: &str) -> Option<String> {
        if data == "[DONE]" {
            return None;
        }
        let v: Value = serde_json::from_str(data).ok()?;
        let delta = v.pointer("/choices/0/delta")?;
        for tc in delta.get("tool_calls").and_then(Value::as_array).into_iter().flatten() {
            let mut idx = tc.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let id = tc.get("id").and_then(Value::as_str).unwrap_or("");
            // some servers reuse index 0 for every call: a new id means a new call
            if let Some((eid, ..)) = self.calls.get(&idx) {
                if !id.is_empty() && !eid.is_empty() && eid != id {
                    idx = self.calls.keys().max().map(|m| m + 1).unwrap_or(0);
                }
            }
            // Gemini sends every call at index 0 with no id: a second name means a new call
            if tc.pointer("/function/name").and_then(Value::as_str).is_some() && self.calls.get(&idx).map(|e| !e.1.is_empty()).unwrap_or(false) {
                idx = self.calls.keys().max().map(|m| m + 1).unwrap_or(0);
            }
            let e = self.calls.entry(idx).or_default();
            if !id.is_empty() {
                e.0 = id.to_string();
            }
            if let Some(n) = tc.pointer("/function/name").and_then(Value::as_str) {
                e.1.push_str(n);
            }
            match tc.pointer("/function/arguments") {
                Some(Value::String(s)) => e.2.push_str(s),
                Some(o @ Value::Object(_)) => e.2 = o.to_string(),
                _ => {}
            }
        }
        let t = delta.get("content").and_then(Value::as_str).filter(|s| !s.is_empty())?;
        self.text.push_str(t);
        Some(t.to_string())
    }

    pub fn finish(self) -> ModelTurn {
        let calls = self
            .calls
            .into_values()
            .filter(|(_, n, _)| !n.is_empty())
            .enumerate()
            .map(|(i, (id, name, args))| ToolCall {
                id: if id.is_empty() { format!("call_{i}") } else { id },
                name,
                args: if args.trim().is_empty() { json!({}) } else { serde_json::from_str(&args).unwrap_or(Value::String(args)) },
            })
            .collect();
        ModelTurn { text: self.text, calls }
    }
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

pub fn anthropic_url(base: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    if b.ends_with("/v1") { format!("{b}/messages") } else { format!("{b}/v1/messages") }
}

pub fn anthropic_body(model: &str, system: &str, history: &[Msg], tools: &[ToolSpec]) -> Value {
    let mut messages: Vec<Value> = Vec::new();
    for m in history {
        match m {
            Msg::User { text } => messages.push(json!({"role": "user", "content": text})),
            Msg::Assistant { text, calls } => {
                let mut blocks = Vec::new();
                if !text.is_empty() {
                    blocks.push(json!({"type": "text", "text": text}));
                }
                for c in calls {
                    blocks.push(json!({"type": "tool_use", "id": c.id, "name": c.name, "input": c.args}));
                }
                messages.push(json!({"role": "assistant", "content": blocks}));
            }
            Msg::ToolResult { id, content, .. } => {
                let block = json!({"type": "tool_result", "tool_use_id": id, "content": content});
                // consecutive results share one user message
                if let Some(last) = messages.last_mut() {
                    if last["role"] == "user" && last["content"].is_array() {
                        last["content"].as_array_mut().unwrap().push(block);
                        continue;
                    }
                }
                messages.push(json!({"role": "user", "content": [block]}));
            }
        }
    }
    let mut body = json!({"model": model, "max_tokens": 8192, "system": system, "messages": messages, "stream": true});
    if !tools.is_empty() {
        body["tools"] = tools.iter().map(|t| json!({"name": t.name, "description": t.description, "input_schema": t.parameters})).collect();
    }
    body
}

#[derive(Default)]
pub struct AnthropicAcc {
    text: String,
    blocks: BTreeMap<usize, (String, String, String)>, // index -> (id, name, partial json)
}

impl AnthropicAcc {
    pub fn feed(&mut self, data: &str) -> Option<String> {
        let v: Value = serde_json::from_str(data).ok()?;
        let idx = v.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
        match v.get("type").and_then(Value::as_str)? {
            "content_block_start" if v.pointer("/content_block/type").and_then(Value::as_str) == Some("tool_use") => {
                let id = v.pointer("/content_block/id").and_then(Value::as_str).unwrap_or("").to_string();
                let name = v.pointer("/content_block/name").and_then(Value::as_str).unwrap_or("").to_string();
                self.blocks.insert(idx, (id, name, String::new()));
                None
            }
            "content_block_delta" => match v.pointer("/delta/type").and_then(Value::as_str)? {
                "text_delta" => {
                    let t = v.pointer("/delta/text").and_then(Value::as_str)?;
                    self.text.push_str(t);
                    Some(t.to_string())
                }
                "input_json_delta" => {
                    if let (Some(b), Some(p)) = (self.blocks.get_mut(&idx), v.pointer("/delta/partial_json").and_then(Value::as_str)) {
                        b.2.push_str(p);
                    }
                    None
                }
                _ => None,
            },
            _ => None,
        }
    }

    pub fn finish(self) -> ModelTurn {
        let calls = self
            .blocks
            .into_values()
            .map(|(id, name, args)| ToolCall {
                id,
                name,
                args: if args.trim().is_empty() { json!({}) } else { serde_json::from_str(&args).unwrap_or(Value::String(args)) },
            })
            .collect();
        ModelTurn { text: self.text, calls }
    }
}

// ─── model listing ────────────────────────────────────────────────────────────

pub fn models_url(cfg: &ProviderConfig) -> String {
    let b = cfg.base_url.trim().trim_end_matches('/');
    match cfg.kind {
        ProviderKind::Openai => format!("{b}/models"),
        ProviderKind::Anthropic if b.ends_with("/v1") => format!("{b}/models"),
        ProviderKind::Anthropic => format!("{b}/v1/models"),
    }
}

/// Model ids from a `/models` response (OpenAI shape `data[].id`; Gemini prefixes `models/`).
pub fn parse_models(body: &Value) -> Vec<String> {
    let mut ids: Vec<String> = body
        .get("data")
        .or_else(|| body.get("models"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|m| m.get("id").or_else(|| m.get("name")).and_then(Value::as_str))
        .map(|s| s.strip_prefix("models/").unwrap_or(s).to_string())
        .collect();
    ids.sort();
    ids
}

/// Ask the provider which models this key can use. The provider's own error text is passed through.
pub async fn list_models(cfg: &ProviderConfig) -> Result<Vec<String>, String> {
    if cfg.base_url.trim().is_empty() {
        return Err("no base URL configured".into());
    }
    let client = reqwest::Client::new();
    let key = cfg.api_key.as_deref().map(str::trim).filter(|k| !k.is_empty());
    let mut req = client.get(models_url(cfg));
    req = match (cfg.kind, key) {
        (ProviderKind::Anthropic, Some(k)) => req.header("x-api-key", k).header("anthropic-version", "2023-06-01"),
        (_, Some(k)) => req.bearer_auth(k),
        _ => req,
    };
    let resp = req.send().await.map_err(|e| format!("could not reach the provider: {}", e.without_url()))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("provider returned {status}: {}", super::tools::truncate(body.trim(), 300)));
    }
    let v: Value = serde_json::from_str(&body).map_err(|e| format!("unexpected /models response: {e}"))?;
    Ok(parse_models(&v))
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

async fn http_complete(
    cfg: &ProviderConfig,
    system: &str,
    history: &[Msg],
    tools: &[ToolSpec],
    cancel: &AtomicBool,
    on_text: &mut (dyn FnMut(&str) + Send),
) -> Result<ModelTurn, String> {
    if cfg.base_url.trim().is_empty() || cfg.model.trim().is_empty() {
        return Err("no provider configured: set a base URL and a model".into());
    }
    let client = reqwest::Client::new();
    let key = cfg.api_key.as_deref().map(str::trim).filter(|k| !k.is_empty());
    // `max_tokens` is left to the provider unless it refuses the default (see output_token_limit).
    let build = |max_tokens: Option<u64>| -> Result<reqwest::RequestBuilder, String> {
        Ok(match cfg.kind {
        ProviderKind::Openai => {
            let mut body = openai_body(&cfg.model, system, history, tools);
            if let Some(m) = max_tokens {
                body["max_tokens"] = json!(m);
            }
            let mut r = client.post(openai_url(&cfg.base_url)).json(&body);
            if let Some(k) = key {
                r = r.bearer_auth(k);
            }
            r
        }
        ProviderKind::Anthropic => {
            let k = key.ok_or("Anthropic needs an API key")?;
            client
                .post(anthropic_url(&cfg.base_url))
                .header("x-api-key", k)
                .header("anthropic-version", "2023-06-01")
                .json(&anthropic_body(&cfg.model, system, history, tools))
        }
        })
    };
    let mut max_tokens = None;
    let mut attempt = 0;
    let resp = loop {
        let r = build(max_tokens)?.send().await.map_err(|e| format!("could not reach the provider: {}", e.without_url()))?;
        let code = r.status().as_u16();
        if !matches!(code, 400 | 413 | 429) || attempt >= 3 {
            break r;
        }
        let header = r.headers().get("retry-after").and_then(|v| v.to_str().ok()).map(str::to_string);
        let body = r.text().await.unwrap_or_default();
        // Small free tiers cap output below the provider's own default: ask for what it allows, once.
        if max_tokens.is_none() && cfg.kind == ProviderKind::Openai {
            if let Some(limit) = output_token_limit(&body) {
                max_tokens = Some(limit);
                attempt += 1;
                continue;
            }
        }
        if code != 429 {
            return Err(format!("provider returned {code}: {}", super::tools::truncate(body.trim(), 300)));
        }
        // Per-minute limits clear within a minute; a longer wait is a daily cap: report it.
        let Some(wait) = retry_wait(header.as_deref(), &body, attempt).filter(|w| *w <= Duration::from_secs(65)) else {
            return Err(format!("provider returned 429 Too Many Requests (rate limited): {}", super::tools::truncate(body.trim(), 300)));
        };
        attempt += 1;
        let until = std::time::Instant::now() + wait;
        while std::time::Instant::now() < until {
            if cancel.load(Ordering::Relaxed) {
                return Err("stopped".into());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    };
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let hint = match status.as_u16() {
            401 | 403 => " (the provider rejected the API key)",
            404 => " (check the base URL and model name)",
            429 => " (rate limited)",
            _ => "",
        };
        return Err(format!("provider returned {status}{hint}: {}", super::tools::truncate(body.trim(), 300)));
    }

    let mut sse = SseBuf::default();
    let mut oa = OpenAiAcc::default();
    let mut an = AnthropicAcc::default();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Err("stopped".into());
        }
        let chunk = chunk.map_err(|e| format!("stream failed: {}", e.without_url()))?;
        for data in sse.push(&chunk) {
            let delta = if cfg.kind == ProviderKind::Openai { oa.feed(&data) } else { an.feed(&data) };
            if let Some(t) = delta {
                on_text(&t);
            }
        }
    }
    Ok(if cfg.kind == ProviderKind::Openai { oa.finish() } else { an.finish() })
}

/// The output-token cap a provider says the request exceeded, e.g. Groq's "output tokens per minute
/// (OTPM): Limit 1000, Requested 2048". `None` when the error is about something else.
fn output_token_limit(body: &str) -> Option<u64> {
    let lower = body.to_ascii_lowercase();
    if !(lower.contains("output tokens") || lower.contains("max_tokens") || lower.contains("max tokens")) {
        return None;
    }
    lower.match_indices("limit").find_map(|(i, _)| {
        let n: String = lower[i + 5..].chars().skip_while(|c| *c == ':' || *c == ' ').take_while(|c| c.is_ascii_digit()).collect();
        n.parse().ok().filter(|n: &u64| *n > 0)
    })
}

/// How long a 429 asks us to wait: the Retry-After header (seconds), else the "try again in 712.5ms" /
/// "in 2.5s" hint Groq and OpenAI put in the body, else 1 s, 2 s, 4 s by attempt.
fn retry_wait(header: Option<&str>, body: &str, attempt: u32) -> Option<Duration> {
    if let Some(secs) = header.and_then(|h| h.trim().parse::<f64>().ok()) {
        return Some(Duration::from_secs_f64(secs.max(0.0)));
    }
    let lower = body.to_ascii_lowercase();
    if let Some(i) = lower.find("try again in ") {
        let rest = &lower[i + 13..];
        let num: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        if let Ok(n) = num.parse::<f64>() {
            let unit = &rest[num.len()..];
            let secs = if unit.starts_with("ms") { n / 1000.0 } else if unit.starts_with('m') { n * 60.0 } else { n };
            return Some(Duration::from_secs_f64(secs + 0.25));
        }
    }
    Some(Duration::from_secs(1 << attempt.min(4)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::tools::specs;

    #[test]
    fn output_token_limit_reads_the_cap() {
        let groq = "Rate limit reached for model `qwen/qwen3.8-27b` on output tokens per minute (OTPM): Limit 1000, Requested 2048. The request's expected output tokens exceed the enforced limit; reduce max_tokens.";
        assert_eq!(output_token_limit(groq), Some(1000));
        assert_eq!(output_token_limit("Rate limit reached on tokens per minute (TPM): Limit 8000, Used 6224"), None, "not an output cap");
        assert_eq!(output_token_limit("bad request"), None);
    }

    #[test]
    fn retry_wait_reads_header_body_hint_or_backs_off() {
        assert_eq!(retry_wait(Some("3"), "", 0), Some(Duration::from_secs(3)));
        let groq = "Rate limit reached ... Please try again in 712.5ms. Need more tokens?";
        assert_eq!(retry_wait(None, groq, 0), Some(Duration::from_secs_f64(0.7125 + 0.25)));
        assert_eq!(retry_wait(None, "Please try again in 2.505s.", 0), Some(Duration::from_secs_f64(2.505 + 0.25)));
        assert!(retry_wait(None, "try again in 7m12s", 0).unwrap() > Duration::from_secs(65), "minutes are not retried");
        assert_eq!(retry_wait(None, "slow down", 2), Some(Duration::from_secs(4)));
    }

    #[test]
    fn sse_frames_split_anywhere() {
        let mut b = SseBuf::default();
        assert!(b.push(b"data: {\"a\"").is_empty());
        let ev = b.push(b":1}\n\ndata: [DONE]\r\n\r\n");
        assert_eq!(ev, vec!["{\"a\":1}".to_string(), "[DONE]".to_string()]);
    }

    #[test]
    fn openai_stream_text_and_tool_calls() {
        let mut a = OpenAiAcc::default();
        let chunks = [
            r#"{"choices":[{"delta":{"content":"Look"}}]}"#,
            r#"{"choices":[{"delta":{"content":"ing"}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{\"pa"}}]}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\":\"a.rs\"}"}}]}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"list_dir","arguments":"{\"path\":\".\"}"}}]}}]}"#,
            "[DONE]",
        ];
        let text: Vec<_> = chunks.iter().filter_map(|c| a.feed(c)).collect();
        assert_eq!(text, vec!["Look", "ing"]);
        let t = a.finish();
        assert_eq!(t.text, "Looking");
        assert_eq!(t.calls.len(), 2);
        assert_eq!(t.calls[0], ToolCall { id: "c1".into(), name: "read_file".into(), args: json!({"path": "a.rs"}) });
        assert_eq!(t.calls[1].name, "list_dir");
    }

    #[test]
    fn openai_servers_that_reuse_index_zero() {
        let mut a = OpenAiAcc::default();
        a.feed(r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","function":{"name":"list_dir","arguments":"{\"path\":\".\"}"}}]}}]}"#);
        a.feed(r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"y","function":{"name":"get_diagnostics","arguments":"{}"}}]}}]}"#);
        assert_eq!(a.finish().calls.len(), 2);
    }

    #[test]
    fn anthropic_stream() {
        let mut a = AnthropicAcc::default();
        let chunks = [
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}"#,
            r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu1","name":"search","input":{}}}"#,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"pattern\":"}}"#,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"foo\"}"}}"#,
            r#"{"type":"message_stop"}"#,
        ];
        let text: Vec<_> = chunks.iter().filter_map(|c| a.feed(c)).collect();
        assert_eq!(text, vec!["Hi"]);
        let t = a.finish();
        assert_eq!(t.calls, vec![ToolCall { id: "tu1".into(), name: "search".into(), args: json!({"pattern": "foo"}) }]);
    }

    fn history() -> Vec<Msg> {
        vec![
            Msg::User { text: "go".into() },
            Msg::Assistant { text: "ok".into(), calls: vec![ToolCall { id: "a".into(), name: "list_dir".into(), args: json!({"path": "."}) }, ToolCall { id: "b".into(), name: "get_diagnostics".into(), args: json!({}) }] },
            Msg::ToolResult { id: "a".into(), name: "list_dir".into(), content: "x".into() },
            Msg::ToolResult { id: "b".into(), name: "get_diagnostics".into(), content: "y".into() },
        ]
    }

    #[test]
    fn request_bodies() {
        let tools = specs(false);
        let o = openai_body("m", "sys", &history(), &tools);
        assert_eq!(o["messages"][0]["role"], "system");
        assert_eq!(o["messages"][2]["tool_calls"][0]["function"]["arguments"], "{\"path\":\".\"}");
        assert_eq!(o["messages"][3]["role"], "tool");
        assert_eq!(o["stream"], true);
        assert!(o["tools"].as_array().unwrap().len() >= 8);
        let a = anthropic_body("m", "sys", &history(), &tools);
        assert_eq!(a["system"], "sys");
        assert_eq!(a["messages"][1]["content"][1]["type"], "tool_use");
        // both results merged into one user message
        assert_eq!(a["messages"].as_array().unwrap().len(), 3);
        assert_eq!(a["messages"][2]["content"].as_array().unwrap().len(), 2);
        assert_eq!(a["tools"][0]["input_schema"]["type"], "object");
    }

    #[test]
    fn model_listing() {
        let v = json!({"data": [{"id": "b"}, {"id": "models/a"}]});
        assert_eq!(parse_models(&v), vec!["a", "b"]);
        assert_eq!(parse_models(&json!({"error": "x"})), Vec::<String>::new());
        let c = |kind, u: &str| ProviderConfig { kind, base_url: u.into(), model: String::new(), api_key: None };
        assert_eq!(models_url(&c(ProviderKind::Openai, "https://x/v1/")), "https://x/v1/models");
        assert_eq!(models_url(&c(ProviderKind::Anthropic, "https://api.anthropic.com")), "https://api.anthropic.com/v1/models");
    }

    #[test]
    fn urls() {
        assert_eq!(openai_url("http://localhost:11434/v1/"), "http://localhost:11434/v1/chat/completions");
        assert_eq!(anthropic_url("https://api.anthropic.com"), "https://api.anthropic.com/v1/messages");
        assert_eq!(anthropic_url("https://x/v1"), "https://x/v1/messages");
    }

    #[test]
    fn key_is_redacted_in_debug() {
        let c = ProviderConfig { kind: ProviderKind::Openai, base_url: "u".into(), model: "m".into(), api_key: Some("sk-secret-123".into()) };
        assert!(!format!("{c:?}").contains("sk-secret"));
    }
}
