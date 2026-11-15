//! Snake Signal skins, arenas and trails, loaded from
//! `shared/snake_items.json` (the frontend reads the same file and draws
//! them). Free items are owned by everyone; the rest are bought with coins or
//! found as lucky drops after big runs. Same shape as `sonar::items`.

use std::sync::OnceLock;

use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::character::catalog::Rarity;

const JSON: &str = include_str!("../../../shared/snake_items.json");

/// A run needs at least this score for a chance at a lucky drop...
pub const DROP_MIN_SCORE: i64 = 5_000;
/// ...and then drops an item this often.
pub const DROP_CHANCE: f64 = 0.20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Skin,
    Arena,
    Trail,
}

impl Kind {
    pub const ALL: [Kind; 3] = [Kind::Skin, Kind::Arena, Kind::Trail];

    pub fn prefix(self) -> &'static str {
        match self {
            Kind::Skin => "skin",
            Kind::Arena => "arena",
            Kind::Trail => "trail",
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
    pub skins: Vec<Item>,
    pub arenas: Vec<Item>,
    pub trails: Vec<Item>,
}

/// Stored ownership key, e.g. "skin:lava".
pub fn key(kind: Kind, id: &str) -> String {
    format!("{}:{id}", kind.prefix())
}

impl Items {
    fn parse(json: &str) -> Result<Items, String> {
        let items: Items = serde_json::from_str(json).map_err(|e| e.to_string())?;
        for list in [&items.skins, &items.arenas, &items.trails] {
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
            Kind::Skin => &self.skins,
            Kind::Arena => &self.arenas,
            Kind::Trail => &self.trails,
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
        let pool: Vec<String> = Kind::ALL
            .into_iter()
            .flat_map(|k| self.list(k).iter().filter(|i| !i.free()).map(move |i| key(k, &i.id)))
            .filter(|k| !owned.contains(k))
            .collect();
        pool.choose(rng).cloned()
    }
}

pub fn items() -> &'static Items {
    static ITEMS: OnceLock<Items> = OnceLock::new();
    ITEMS.get_or_init(|| Items::parse(JSON).expect("shared/snake_items.json is invalid"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_8_skins_8_arenas_6_trails_half_free() {
        let it = items();
        assert_eq!(it.skins.len(), 8);
        assert_eq!(it.arenas.len(), 8);
        assert_eq!(it.trails.len(), 6);
        assert_eq!(it.skins.iter().filter(|b| b.free()).count(), 4);
        assert_eq!(it.arenas.iter().filter(|b| b.free()).count(), 4);
        assert_eq!(it.trails.iter().filter(|b| b.free()).count(), 3);
        assert_eq!(it.default_id(Kind::Skin), "neon");
        assert_eq!(it.default_id(Kind::Arena), "grid");
        assert_eq!(it.default_id(Kind::Trail), "none");
        assert!(it.owns(Kind::Skin, "pixel", &[]));
        assert!(!it.owns(Kind::Trail, "comet", &[]));
        assert!(it.owns(Kind::Trail, "comet", &[key(Kind::Trail, "comet")]));
        let all: Vec<String> = Kind::ALL
            .into_iter()
            .flat_map(|k| it.list(k).iter().map(move |i| key(k, &i.id)))
            .collect();
        assert_eq!(it.random_unowned(&all, &mut rand::thread_rng()), None);
    }
}
