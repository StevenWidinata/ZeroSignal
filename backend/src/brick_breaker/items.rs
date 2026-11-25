//! Brick Breaker paddles, balls, brick themes and backdrops, loaded from
//! `shared/brick_items.json` (the frontend reads the same file and draws
//! them). Free items are owned by everyone; the rest are bought with coins or
//! found as lucky drops. Same shape as `snake_signal::items`.

use std::sync::OnceLock;

use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::character::catalog::Rarity;

const JSON: &str = include_str!("../../../shared/brick_items.json");

/// An Endless or Daily run needs at least this score for a chance at a lucky
/// drop (a 3-star Campaign clear always gets the chance)...
pub const DROP_MIN_SCORE: i64 = 10_000;
/// ...and then drops an item this often.
pub const DROP_CHANCE: f64 = 0.20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Paddle,
    Ball,
    Theme,
    Backdrop,
}

impl Kind {
    pub const ALL: [Kind; 4] = [Kind::Paddle, Kind::Ball, Kind::Theme, Kind::Backdrop];

    pub fn prefix(self) -> &'static str {
        match self {
            Kind::Paddle => "paddle",
            Kind::Ball => "ball",
            Kind::Theme => "theme",
            Kind::Backdrop => "backdrop",
        }
    }

    /// What the player calls it ("you don't own that brick theme").
    pub fn noun(self) -> &'static str {
        match self {
            Kind::Theme => "brick theme",
            k => k.prefix(),
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
    pub paddles: Vec<Item>,
    pub balls: Vec<Item>,
    pub themes: Vec<Item>,
    pub backdrops: Vec<Item>,
}

/// Stored ownership key, e.g. "ball:comet".
pub fn key(kind: Kind, id: &str) -> String {
    format!("{}:{id}", kind.prefix())
}

impl Items {
    fn parse(json: &str) -> Result<Items, String> {
        let items: Items = serde_json::from_str(json).map_err(|e| e.to_string())?;
        for list in [&items.paddles, &items.balls, &items.themes, &items.backdrops] {
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
            Kind::Paddle => &self.paddles,
            Kind::Ball => &self.balls,
            Kind::Theme => &self.themes,
            Kind::Backdrop => &self.backdrops,
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
    ITEMS.get_or_init(|| Items::parse(JSON).expect("shared/brick_items.json is invalid"))
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
        assert_eq!(it.default_id(Kind::Paddle), "classic");
        assert_eq!(it.default_id(Kind::Ball), "white");
        assert_eq!(it.default_id(Kind::Theme), "spectrum");
        assert_eq!(it.default_id(Kind::Backdrop), "night");
        assert!(it.owns(Kind::Ball, "ember", &[]));
        assert!(!it.owns(Kind::Ball, "comet", &[]));
        assert!(it.owns(Kind::Ball, "comet", &[key(Kind::Ball, "comet")]));
        // The same id in another list doesn't count.
        assert!(!it.owns(Kind::Paddle, "gold", &[key(Kind::Theme, "gold")]));
        assert!(!it.owns(Kind::Paddle, "nope", &[]));
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
