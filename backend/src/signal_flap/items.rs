//! Signal Flap drones, trails and skies, loaded from `shared/flap_items.json`
//! (the frontend reads the same file and draws them). Free items are owned by
//! everyone; the rest are bought with coins or found as lucky drops. Same
//! shape as `brick_breaker::items`.

use std::sync::OnceLock;

use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::character::catalog::Rarity;

const JSON: &str = include_str!("../../../shared/flap_items.json");

/// A run needs at least this score (gaps + bars) for a chance at a lucky
/// drop...
pub const DROP_MIN_SCORE: i64 = 50;
/// ...and then drops an item this often.
pub const DROP_CHANCE: f64 = 0.20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Drone,
    Trail,
    Sky,
}

impl Kind {
    pub const ALL: [Kind; 3] = [Kind::Drone, Kind::Trail, Kind::Sky];

    /// Also what the player calls it ("you don't own that trail").
    pub fn prefix(self) -> &'static str {
        match self {
            Kind::Drone => "drone",
            Kind::Trail => "trail",
            Kind::Sky => "sky",
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
    pub drones: Vec<Item>,
    pub trails: Vec<Item>,
    pub skies: Vec<Item>,
}

/// Stored ownership key, e.g. "trail:comet".
pub fn key(kind: Kind, id: &str) -> String {
    format!("{}:{id}", kind.prefix())
}

impl Items {
    fn parse(json: &str) -> Result<Items, String> {
        let items: Items = serde_json::from_str(json).map_err(|e| e.to_string())?;
        for list in [&items.drones, &items.trails, &items.skies] {
            for (i, it) in list.iter().enumerate() {
                if list[i + 1..].iter().any(|o| o.id == it.id) {
                    return Err(format!("duplicate id {}", it.id));
                }
                // Stored in a VARCHAR(24) column with no prefix.
                if it.id.is_empty() || it.id.len() > 24 {
                    return Err(format!("bad id {}", it.id));
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
            Kind::Drone => &self.drones,
            Kind::Trail => &self.trails,
            Kind::Sky => &self.skies,
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
    ITEMS.get_or_init(|| Items::parse(JSON).expect("shared/flap_items.json is invalid"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_8_of_each_half_free() {
        let it = items();
        for k in Kind::ALL {
            assert_eq!(it.list(k).len(), 8, "{k:?}");
            assert_eq!(it.list(k).iter().filter(|i| i.free()).count(), 4, "{k:?}");
        }
        assert_eq!(it.default_id(Kind::Drone), "scout");
        assert_eq!(it.default_id(Kind::Trail), "none");
        assert_eq!(it.default_id(Kind::Sky), "day");
        assert!(it.owns(Kind::Trail, "dots", &[]));
        assert!(!it.owns(Kind::Trail, "comet", &[]));
        assert!(it.owns(Kind::Trail, "comet", &[key(Kind::Trail, "comet")]));
        // The same id in another list doesn't count.
        assert!(!it.owns(Kind::Drone, "gold", &[key(Kind::Sky, "gold")]));
        assert!(!it.owns(Kind::Drone, "nope", &[]));
        let all: Vec<String> = Kind::ALL
            .into_iter()
            .flat_map(|k| it.list(k).iter().map(move |i| key(k, &i.id)))
            .collect();
        assert_eq!(it.random_unowned(&all, &mut rand::thread_rng()), None);
        let one = it.random_unowned(&[], &mut rand::thread_rng()).unwrap();
        assert!(all.contains(&one));
        assert!(Kind::ALL.into_iter().all(|k| it.list(k).iter().all(|i| !i.free() || key(k, &i.id) != one)));
    }
}
