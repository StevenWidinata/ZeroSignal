//! Sonar fleet looks and sea themes, loaded from `shared/sonar_items.json`
//! (the frontend reads the same file and draws them). Free items are owned
//! by everyone; the rest are bought with coins or dropped after AI wins.
//! Same shape as `chess::items`.

use std::sync::OnceLock;

use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::character::catalog::Rarity;

const JSON: &str = include_str!("../../../shared/sonar_items.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Fleet,
    Sea,
}

impl Kind {
    pub fn prefix(self) -> &'static str {
        match self {
            Kind::Fleet => "fleet",
            Kind::Sea => "sea",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Item {
    pub id: String,
    pub name: String,
    pub rarity: Rarity,
    /// `None` = free for everyone.
    pub price: Option<i64>,
}

impl Item {
    pub fn free(&self) -> bool {
        self.price.is_none()
    }
}

#[derive(Deserialize)]
pub struct Items {
    pub fleets: Vec<Item>,
    pub seas: Vec<Item>,
}

/// Stored ownership key, e.g. "fleet:pirate".
pub fn key(kind: Kind, id: &str) -> String {
    format!("{}:{id}", kind.prefix())
}

impl Items {
    fn parse(json: &str) -> Result<Items, String> {
        let items: Items = serde_json::from_str(json).map_err(|e| e.to_string())?;
        for list in [&items.fleets, &items.seas] {
            for (i, it) in list.iter().enumerate() {
                if list[i + 1..].iter().any(|o| o.id == it.id) {
                    return Err(format!("duplicate id {}", it.id));
                }
                if it.price.is_some_and(|p| p <= 0) {
                    return Err(format!("{} has a non-positive price", it.id));
                }
            }
            if !list.iter().any(Item::free) {
                return Err("each list needs a free item".into());
            }
        }
        Ok(items)
    }

    pub fn list(&self, kind: Kind) -> &[Item] {
        match kind {
            Kind::Fleet => &self.fleets,
            Kind::Sea => &self.seas,
        }
    }

    pub fn find(&self, kind: Kind, id: &str) -> Option<&Item> {
        self.list(kind).iter().find(|i| i.id == id)
    }

    pub fn default_id(&self, kind: Kind) -> &str {
        &self.list(kind).iter().find(|i| i.free()).expect("checked at load").id
    }

    pub fn owns(&self, kind: Kind, id: &str, owned: &[String]) -> bool {
        self.find(kind, id).is_some_and(|i| i.free() || owned.contains(&key(kind, id)))
    }

    /// A random paid item you don't own yet (for lucky drops).
    pub fn random_unowned(&self, owned: &[String], rng: &mut impl Rng) -> Option<String> {
        let pool: Vec<String> = [Kind::Fleet, Kind::Sea]
            .into_iter()
            .flat_map(|k| self.list(k).iter().filter(|i| !i.free()).map(move |i| key(k, &i.id)))
            .filter(|k| !owned.contains(k))
            .collect();
        pool.choose(rng).cloned()
    }
}

pub fn items() -> &'static Items {
    static ITEMS: OnceLock<Items> = OnceLock::new();
    ITEMS.get_or_init(|| Items::parse(JSON).expect("shared/sonar_items.json is invalid"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_8_fleets_and_8_seas_half_free() {
        let it = items();
        assert_eq!(it.fleets.len(), 8);
        assert_eq!(it.seas.len(), 8);
        assert_eq!(it.fleets.iter().filter(|b| b.free()).count(), 4);
        assert_eq!(it.seas.iter().filter(|p| p.free()).count(), 4);
        assert_eq!(it.default_id(Kind::Fleet), "navy");
        assert_eq!(it.default_id(Kind::Sea), "ocean");
        assert!(it.owns(Kind::Fleet, "ducks", &[]));
        assert!(!it.owns(Kind::Sea, "lava", &[]));
        assert!(it.owns(Kind::Sea, "lava", &[key(Kind::Sea, "lava")]));
    }
}
