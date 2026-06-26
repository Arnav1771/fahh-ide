use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Capability {
    pub id: String,
    pub description: String,
    pub enabled: bool,
}

#[derive(Default)]
pub struct CapabilityRegistry {
    capabilities: HashMap<String, Capability>,
}

impl CapabilityRegistry {
    pub fn register(&mut self, id: &str, description: &str) {
        self.capabilities.insert(
            id.to_string(),
            Capability {
                id: id.to_string(),
                description: description.to_string(),
                enabled: true,
            },
        );
    }

    pub fn is_enabled(&self, id: &str) -> bool {
        self.capabilities.get(id).map(|c| c.enabled).unwrap_or(false)
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) {
        if let Some(cap) = self.capabilities.get_mut(id) {
            cap.enabled = enabled;
        }
    }
}
