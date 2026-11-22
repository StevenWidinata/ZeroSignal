//! Sudoku board themes, loaded from `shared/sudoku_items.json` (the frontend
//! reads the same file and draws them). Free themes are owned by everyone;
//! the rest are bought with coins or dropped after Hard and Expert wins.

use std::sync::OnceLock;

use rand::seq::SliceRandom;
use rand::Rng;
use serde::Deserialize;

use crate::character::catalog::Rarity;

const JSON: &str = include_str!("../../../shared/sudoku_items.json");

#[derive(Debug, Clone, Deserialize)]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub rarity: Rarity,
    /// `None` = free for everyone.
    pub price: Option<i64>,
}

impl Theme {
    pub fn free(&self) -> bool {
        self.price.is_none()
    }
}

#[derive(Deserialize)]
pub struct Items {
    pub themes: Vec<Theme>,
}

/// Stored ownership key, e.g. "theme:neon".
pub fn key(id: &str) -> String {
    format!("theme:{id}")
}

impl Items {
    fn parse(json: &str) -> Result<Items, String> {
        let items: Items = serde_json::from_str(json).map_err(|e| e.to_string())?;
        for (i, t) in items.themes.iter().enumerate() {
            if items.themes[i + 1..].iter().any(|o| o.id == t.id) {
                return Err(format!("duplicate id {}", t.id));
            }
            if t.price.is_some_and(|p| p <= 0) {
                return Err(format!("{} has a non-positive price", t.id));
            }
        }
        if !items.themes.iter().any(Theme::free) {
            return Err("there must be a free theme".into());
        }
        Ok(items)
    }

    pub fn find(&self, id: &str) -> Option<&Theme> {
        self.themes.iter().find(|t| t.id == id)
    }

    /// Do you own it? Free themes always; others when `owned` has the key.
    pub fn owns(&self, id: &str, owned: &[String]) -> bool {
        self.find(id).is_some_and(|t| t.free() || owned.contains(&key(id)))
    }

    /// A random paid theme you don't own yet (for lucky drops).
    pub fn random_unowned(&self, owned: &[String], rng: &mut impl Rng) -> Option<String> {
        let pool: Vec<String> = self.themes.iter().filter(|t| !t.free()).map(|t| key(&t.id)).filter(|k| !owned.contains(k)).collect();
        pool.choose(rng).cloned()
    }
}

pub fn items() -> &'static Items {
    static ITEMS: OnceLock<Items> = OnceLock::new();
    ITEMS.get_or_init(|| Items::parse(JSON).expect("shared/sudoku_items.json is invalid"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    #[test]
    fn eight_themes_half_free() {
        let it = items();
        assert_eq!(it.themes.len(), 8);
        assert_eq!(it.themes.iter().filter(|t| t.free()).count(), 4);
        assert!(it.owns("paper", &[]));
        assert!(!it.owns("neon", &[]));
        assert!(it.owns("neon", &[key("neon")]));
        assert!(!it.owns("nope", &[key("nope")]));
        let mut r = ChaCha8Rng::seed_from_u64(1);
        let all: Vec<String> = it.themes.iter().filter(|t| !t.free()).map(|t| key(&t.id)).collect();
        assert_eq!(it.random_unowned(&all, &mut r), None);
        assert!(it.random_unowned(&[], &mut r).is_some_and(|k| k.starts_with("theme:")));
    }

    #[test]
    fn rejects_bad_catalogs() {
        assert!(Items::parse(r#"{"themes":[{"id":"a","name":"A","rarity":"common","price":5}]}"#).is_err());
        assert!(Items::parse(r#"{"themes":[{"id":"a","name":"A","rarity":"common","price":null},{"id":"a","name":"B","rarity":"rare","price":5}]}"#).is_err());
    }
}
