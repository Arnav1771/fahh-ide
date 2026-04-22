#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Document {
    pub path: String,
    pub language: String,
    pub text: String,
    pub revision: u64,
    pub last_saved_revision: u64,
    undo_stack: Vec<String>,
    redo_stack: Vec<String>,
}

impl Document {
    pub fn new(
        path: impl Into<String>,
        language: impl Into<String>,
        text: impl Into<String>,
    ) -> Self {
        Self {
            path: path.into(),
            language: language.into(),
            text: text.into(),
            revision: 0,
            last_saved_revision: 0,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    pub fn apply_edit(&mut self, new_text: impl Into<String>) {
        self.undo_stack.push(self.text.clone());
        self.text = new_text.into();
        self.revision += 1;
        self.redo_stack.clear();
    }

    pub fn undo(&mut self) -> bool {
        let Some(previous) = self.undo_stack.pop() else {
            return false;
        };
        self.redo_stack.push(self.text.clone());
        self.text = previous;
        self.revision += 1;
        true
    }

    pub fn redo(&mut self) -> bool {
        let Some(next) = self.redo_stack.pop() else {
            return false;
        };
        self.undo_stack.push(self.text.clone());
        self.text = next;
        self.revision += 1;
        true
    }

    pub fn mark_saved(&mut self) {
        self.last_saved_revision = self.revision;
    }

    pub fn is_dirty(&self) -> bool {
        self.revision != self.last_saved_revision
    }
}

#[derive(Default, Debug)]
pub struct TabManager {
    pub open_tabs: Vec<Document>,
    pub active_index: Option<usize>,
}

impl TabManager {
    pub fn open_document(&mut self, document: Document) {
        self.open_tabs.push(document);
        self.active_index = Some(self.open_tabs.len() - 1);
    }

    pub fn close_active(&mut self) {
        let Some(index) = self.active_index else {
            return;
        };

        self.open_tabs.remove(index);

        self.active_index = if self.open_tabs.is_empty() {
            None
        } else {
            Some(index.saturating_sub(1).min(self.open_tabs.len() - 1))
        };
    }

    pub fn active_mut(&mut self) -> Option<&mut Document> {
        self.active_index
            .and_then(|index| self.open_tabs.get_mut(index))
    }
}

#[cfg(test)]
mod tests {
    use super::{Document, TabManager};

    #[test]
    fn document_undo_redo_roundtrip() {
        let mut doc = Document::new("main.rs", "rust", "fn main() {}\n");
        doc.apply_edit("fn main() { println!(\"hi\"); }\n");
        assert!(doc.is_dirty());

        assert!(doc.undo());
        assert_eq!(doc.text, "fn main() {}\n");

        assert!(doc.redo());
        assert_eq!(doc.text, "fn main() { println!(\"hi\"); }\n");
    }

    #[test]
    fn tab_manager_tracks_active_tab() {
        let mut tabs = TabManager::default();
        tabs.open_document(Document::new("a.rs", "rust", ""));
        tabs.open_document(Document::new("b.py", "python", ""));

        tabs.close_active();
        assert_eq!(tabs.open_tabs.len(), 1);
        assert_eq!(tabs.active_index, Some(0));
    }
}
