use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct LanguageCapabilities {
    pub diagnostics: bool,
    pub completion: bool,
    pub formatting: bool,
}

pub trait LanguageProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn supports_extension(&self, extension: &str) -> bool;
    fn server_command(&self) -> (&'static str, Vec<&'static str>);
    fn capabilities(&self) -> LanguageCapabilities;
}

#[derive(Default)]
pub struct LanguageRegistry {
    providers: Vec<Arc<dyn LanguageProvider>>,
}

impl LanguageRegistry {
    pub fn with_defaults() -> Self {
        let mut registry = Self::default();
        registry.register(Arc::new(RustProvider));
        registry.register(Arc::new(PythonProvider));
        registry.register(Arc::new(TypeScriptProvider));
        registry
    }

    pub fn register(&mut self, provider: Arc<dyn LanguageProvider>) {
        self.providers.push(provider);
    }

    pub fn resolve_for_extension(&self, extension: &str) -> Option<&Arc<dyn LanguageProvider>> {
        self.providers
            .iter()
            .find(|provider| provider.supports_extension(extension))
    }
}

pub struct RustProvider;

impl LanguageProvider for RustProvider {
    fn id(&self) -> &'static str {
        "rust"
    }

    fn supports_extension(&self, extension: &str) -> bool {
        extension.eq_ignore_ascii_case("rs")
    }

    fn server_command(&self) -> (&'static str, Vec<&'static str>) {
        ("rust-analyzer", Vec::new())
    }

    fn capabilities(&self) -> LanguageCapabilities {
        LanguageCapabilities {
            diagnostics: true,
            completion: true,
            formatting: true,
        }
    }
}

pub struct PythonProvider;

impl LanguageProvider for PythonProvider {
    fn id(&self) -> &'static str {
        "python"
    }

    fn supports_extension(&self, extension: &str) -> bool {
        extension.eq_ignore_ascii_case("py")
    }

    fn server_command(&self) -> (&'static str, Vec<&'static str>) {
        ("pyright-langserver", vec!["--stdio"])
    }

    fn capabilities(&self) -> LanguageCapabilities {
        LanguageCapabilities {
            diagnostics: true,
            completion: true,
            formatting: false,
        }
    }
}

pub struct TypeScriptProvider;

impl LanguageProvider for TypeScriptProvider {
    fn id(&self) -> &'static str {
        "typescript"
    }

    fn supports_extension(&self, extension: &str) -> bool {
        matches!(
            extension.to_ascii_lowercase().as_str(),
            "ts" | "tsx" | "js" | "jsx"
        )
    }

    fn server_command(&self) -> (&'static str, Vec<&'static str>) {
        ("typescript-language-server", vec!["--stdio"])
    }

    fn capabilities(&self) -> LanguageCapabilities {
        LanguageCapabilities {
            diagnostics: true,
            completion: true,
            formatting: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::LanguageRegistry;

    #[test]
    fn resolves_default_languages() {
        let registry = LanguageRegistry::with_defaults();
        assert_eq!(registry.resolve_for_extension("rs").unwrap().id(), "rust");
        assert_eq!(registry.resolve_for_extension("py").unwrap().id(), "python");
        assert_eq!(
            registry.resolve_for_extension("tsx").unwrap().id(),
            "typescript"
        );
    }
}
