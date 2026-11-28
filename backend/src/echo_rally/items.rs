//! Echo Rally shop: Chaos powers plus paddles, balls and courts, loaded from
//! `shared/rally_items.json` (the frontend reads the same file and draws the
//! cosmetics). Free items are owned by everyone; the rest are bought with
//! coins, and cosmetics can also be lucky drops. Same shape as
//! `signal_flap::items`.

use std::sync::OnceLock;

use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};

use super::engine::{rules, Power};
use crate::character::catalog::Rarity;

const JSON: &str = include_str!("../../../shared/rally_items.json");

/// How often a win against Hard or Master drops a cosmetic you don't own.
pub const DROP_CHANCE: f64 = 0.20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Power,
    Paddle,
    Ball,
    Court,
}

impl Kind {
    pub const ALL: [Kind; 4] = [Kind::Power, Kind::Paddle, Kind::Ball, Kind::Court];
    pub const COSMETICS: [Kind; 3] = [Kind::Paddle, Kind::Ball, Kind::Court];

    /// Also what the player calls it ("you don't own that ball").
    pub fn prefix(self) -> &'static str {
        match self {
            Kind::Power => "power",
            Kind::Paddle => "paddle",
            Kind::Ball => "ball",
            Kind::Court => "court",
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
    pub powers: Vec<Item>,
    pub paddles: Vec<Item>,
    pub balls: Vec<Item>,
    pub courts: Vec<Item>,
}

/// Stored ownership key, e.g. "ball:comet" or "power:fog".
pub fn key(kind: Kind, id: &str) -> String {
    format!("{}:{id}", kind.prefix())
}

impl Items {
    fn parse(json: &str) -> Result<Items, String> {
        let items: Items = serde_json::from_str(json).map_err(|e| e.to_string())?;
        let ids: Vec<&str> = items.powers.iter().map(|p| p.id.as_str()).collect();
        let want: Vec<&str> = rules().power_ids.iter().map(String::as_str).collect();
        if ids != want {
            return Err("powers must match shared/rally_rules.json power_ids".into());
        }
        if items.powers.iter().filter(|p| p.free()).count() < rules().kit_size {
            return Err("everyone needs enough free powers for a kit".into());
        }
        for kind in Kind::ALL {
            let list = items.list(kind);
            for (i, it) in list.iter().enumerate() {
                if list[i + 1..].iter().any(|o| o.id == it.id) {
                    return Err(format!("duplicate id {}", it.id));
                }
                // Stored in a VARCHAR(24) column with no prefix.
                if it.id.is_empty() || it.id.len() > 24 || it.id.contains(',') {
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
            Kind::Power => &self.powers,
            Kind::Paddle => &self.paddles,
            Kind::Ball => &self.balls,
            Kind::Court => &self.courts,
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

    /// The first power in `kit` you don't own, if any.
    pub fn missing_power(&self, kit: &[Power], owned: &[String]) -> Option<&Item> {
        kit.iter().find(|p| !self.owns(Kind::Power, p.id(), owned)).and_then(|p| self.find(Kind::Power, p.id()))
    }

    /// A random paid cosmetic you don't own yet (for lucky drops).
    pub fn random_unowned(&self, owned: &[String], rng: &mut impl Rng) -> Option<String> {
        let pool: Vec<String> = Kind::COSMETICS
            .into_iter()
            .flat_map(|k| self.list(k).iter().filter(|i| !i.free()).map(move |i| key(k, &i.id)))
            .filter(|k| !owned.contains(k))
            .collect();
        pool.choose(rng).cloned()
    }
}

pub fn items() -> &'static Items {
    static ITEMS: OnceLock<Items> = OnceLock::new();
    ITEMS.get_or_init(|| Items::parse(JSON).expect("shared/rally_items.json is invalid"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_10_powers_and_8_of_each_cosmetic_half_free() {
        let it = items();
        assert_eq!(it.list(Kind::Power).len(), 10);
        assert_eq!(it.list(Kind::Power).iter().filter(|i| i.free()).count(), 5);
        let paid: Vec<i64> = it.list(Kind::Power).iter().filter_map(|i| i.price).collect();
        assert_eq!(paid, vec![300, 350, 400, 450, 500]);
        for k in Kind::COSMETICS {
            assert_eq!(it.list(k).len(), 8, "{k:?}");
            assert_eq!(it.list(k).iter().filter(|i| i.free()).count(), 4, "{k:?}");
            let paid: Vec<i64> = it.list(k).iter().filter_map(|i| i.price).collect();
            assert_eq!(paid, vec![300, 350, 550, 900], "{k:?}");
        }
        assert_eq!(it.default_id(Kind::Paddle), "classic");
        assert_eq!(it.default_id(Kind::Ball), "pixel");
        assert_eq!(it.default_id(Kind::Court), "black");
    }

    #[test]
    fn ownership_and_drops() {
        let it = items();
        assert!(it.owns(Kind::Power, "echo", &[]));
        assert!(!it.owns(Kind::Power, "fog", &[]));
        assert!(it.owns(Kind::Power, "fog", &[key(Kind::Power, "fog")]));
        // The same id in another list doesn't count.
        assert!(!it.owns(Kind::Ball, "echo", &[key(Kind::Power, "echo")]));
        assert!(!it.owns(Kind::Paddle, "nope", &[]));
        assert_eq!(it.missing_power(&[Power::Grow, Power::Fog, Power::Echo], &[]).map(|i| i.name.as_str()), Some("Fog"));
        assert!(it.missing_power(&[Power::Grow, Power::Fog], &[key(Kind::Power, "fog")]).is_none());
        let all: Vec<String> = Kind::COSMETICS
            .into_iter()
            .flat_map(|k| it.list(k).iter().map(move |i| key(k, &i.id)))
            .collect();
        assert_eq!(it.random_unowned(&all, &mut rand::thread_rng()), None);
        for _ in 0..50 {
            let one = it.random_unowned(&[], &mut rand::thread_rng()).unwrap();
            assert!(all.contains(&one) && !one.starts_with("power:"));
        }
    }
}
