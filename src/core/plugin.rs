use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Capability {
    Syntax,
    Diagnostics,
    Formatter,
    TaskRunner,
}

pub trait Plugin: Send + Sync {
    fn name(&self) -> &'static str;
    fn capabilities(&self) -> Vec<Capability>;
}

#[derive(Default)]
pub struct PluginRegistry {
    plugins: HashMap<String, Box<dyn Plugin>>,
}

impl PluginRegistry {
    pub fn register(&mut self, plugin: Box<dyn Plugin>) {
        self.plugins.insert(plugin.name().to_string(), plugin);
    }

    pub fn has_capability(&self, capability: &Capability) -> bool {
        self.plugins
            .values()
            .any(|plugin| plugin.capabilities().iter().any(|item| item == capability))
    }

    pub fn plugin_count(&self) -> usize {
        self.plugins.len()
    }
}

#[cfg(test)]
mod tests {
    use super::{Capability, Plugin, PluginRegistry};

    struct RustPlugin;

    impl Plugin for RustPlugin {
        fn name(&self) -> &'static str {
            "rust"
        }

        fn capabilities(&self) -> Vec<Capability> {
            vec![Capability::Syntax, Capability::Diagnostics]
        }
    }

    #[test]
    fn tracks_plugin_capabilities() {
        let mut registry = PluginRegistry::default();
        registry.register(Box::new(RustPlugin));
        assert!(registry.has_capability(&Capability::Diagnostics));
        assert_eq!(registry.plugin_count(), 1);
    }
}
