use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum Severity {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Diagnostic {
    pub file: String,
    pub line: u32,
    pub message: String,
    pub severity: Severity,
}

#[derive(Default, Debug)]
pub struct DiagnosticEngine {
    diagnostics_by_file: HashMap<String, Vec<Diagnostic>>,
}

impl DiagnosticEngine {
    pub fn update_for_file(&mut self, file: impl Into<String>, diagnostics: Vec<Diagnostic>) {
        self.diagnostics_by_file.insert(file.into(), diagnostics);
    }

    pub fn diagnostics_for_file(&self, file: &str) -> &[Diagnostic] {
        self.diagnostics_by_file
            .get(file)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }
}
