//! Memory Match power-ups as shop items, loaded from
//! `shared/memory_powers.json` (the frontend reads the same file). Free
//! powers are owned by everyone; the rest are bought with coins.

use std::sync::OnceLock;

use serde::Deserialize;

use super::rules::{Power, Target};
use crate::character::catalog::Rarity;

const JSON: &str = include_str!("../../../shared/memory_powers.json");

#[derive(Debug, Clone, Deserialize)]
pub struct PowerItem {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub rarity: Rarity,
    /// `None` = free for everyone.
    pub price: Option<i64>,
    pub target: String,
    pub text: String,
}

impl PowerItem {
    pub fn free(&self) -> bool {
        self.price.is_none()
    }
}

#[derive(Deserialize)]
pub struct Items {
    pub powers: Vec<PowerItem>,
}

/// Stored ownership key, e.g. "power:mirror".
pub fn key(id: &str) -> String {
    format!("power:{id}")
}

fn target_id(t: Target) -> &'static str {
    match t {
        Target::None => "none",
        Target::Two => "two",
        Target::Block => "block",
        Target::Row => "row",
    }
}

impl Items {
    /// The file must list exactly the powers the rules know, with the same targets.
    fn parse(json: &str) -> Result<Items, String> {
        let items: Items = serde_json::from_str(json).map_err(|e| e.to_string())?;
        if items.powers.len() != Power::ALL.len() {
            return Err(format!("expected {} powers", Power::ALL.len()));
        }
        for p in Power::ALL {
            let item = items.find(p.id()).ok_or_else(|| format!("{} is missing", p.id()))?;
            if item.target != target_id(p.target()) {
                return Err(format!("{} should target {}", p.id(), target_id(p.target())));
            }
            if item.price.is_some_and(|c| c <= 0) {
                return Err(format!("{} has a non-positive price", p.id()));
            }
        }
        if items.powers.iter().filter(|p| p.free()).count() < super::rules::KIT_SIZE {
            return Err("everyone needs enough free powers for a kit".into());
        }
        Ok(items)
    }

    pub fn find(&self, id: &str) -> Option<&PowerItem> {
        self.powers.iter().find(|p| p.id == id)
    }

    /// Free, or bought (`owned` holds stored keys).
    pub fn owns(&self, id: &str, owned: &[String]) -> bool {
        self.find(id).is_some_and(|p| p.free() || owned.contains(&key(id)))
    }
}

pub fn items() -> &'static Items {
    static ITEMS: OnceLock<Items> = OnceLock::new();
    ITEMS.get_or_init(|| Items::parse(JSON).expect("shared/memory_powers.json is valid"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shared_file_matches_the_rules() {
        let items = Items::parse(JSON).unwrap();
        let free: Vec<&str> = items.powers.iter().filter(|p| p.free()).map(|p| p.id.as_str()).collect();
        assert_eq!(free, ["shuffle", "swap", "peek", "fog", "second-chance"]);
        let prices: Vec<i64> = items.powers.iter().filter_map(|p| p.price).collect();
        assert_eq!(prices, [300, 300, 350, 400, 500]);
        assert_eq!(key("x-ray"), "power:x-ray");
        assert!(Items::parse(&JSON.replace("\"target\": \"row\"", "\"target\": \"two\"")).is_err());
    }
}
