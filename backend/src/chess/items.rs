//! Chess board styles and piece sets, loaded from `shared/chess_items.json`
//! (the frontend reads the same file and draws them). Free items are owned
//! by everyone; the rest are bought with coins or dropped after AI wins.

use std::sync::OnceLock;

use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::character::catalog::Rarity;

const JSON: &str = include_str!("../../../shared/chess_items.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Board,
    Pieces,
}

impl Kind {
    pub fn prefix(self) -> &'static str {
        match self {
            Kind::Board => "board",
            Kind::Pieces => "pieces",
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
    pub boards: Vec<Item>,
    pub pieces: Vec<Item>,
}

/// Stored ownership key, e.g. "board:neon".
pub fn key(kind: Kind, id: &str) -> String {
    format!("{}:{id}", kind.prefix())
}

impl Items {
    fn parse(json: &str) -> Result<Items, String> {
        let items: Items = serde_json::from_str(json).map_err(|e| e.to_string())?;
        for list in [&items.boards, &items.pieces] {
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
            Kind::Board => &self.boards,
            Kind::Pieces => &self.pieces,
        }
    }

    pub fn find(&self, kind: Kind, id: &str) -> Option<&Item> {
        self.list(kind).iter().find(|i| i.id == id)
    }

    /// Free item of a kind (the default choice).
    pub fn default_id(&self, kind: Kind) -> &str {
        &self.list(kind).iter().find(|i| i.free()).expect("checked at load").id
    }

    /// Do you own it? Free items always; others when `owned` has the key.
    pub fn owns(&self, kind: Kind, id: &str, owned: &[String]) -> bool {
        self.find(kind, id).is_some_and(|i| i.free() || owned.contains(&key(kind, id)))
    }

    /// A random paid item you don't own yet (for lucky drops).
    pub fn random_unowned(&self, owned: &[String], rng: &mut impl Rng) -> Option<String> {
        let pool: Vec<String> = [Kind::Board, Kind::Pieces]
            .into_iter()
            .flat_map(|k| self.list(k).iter().filter(|i| !i.free()).map(move |i| key(k, &i.id)))
            .filter(|k| !owned.contains(k))
            .collect();
        pool.choose(rng).cloned()
    }
}

pub fn items() -> &'static Items {
    static ITEMS: OnceLock<Items> = OnceLock::new();
    ITEMS.get_or_init(|| Items::parse(JSON).expect("shared/chess_items.json is invalid"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_12_boards_and_8_piece_sets_with_free_ones() {
        let it = items();
        assert_eq!(it.boards.len(), 12);
        assert_eq!(it.pieces.len(), 8);
        assert_eq!(it.boards.iter().filter(|b| b.free()).count(), 6);
        assert_eq!(it.pieces.iter().filter(|p| p.free()).count(), 4);
        assert_eq!(it.default_id(Kind::Board), "classic");
        assert_eq!(it.default_id(Kind::Pieces), "classic");
        assert!(it.owns(Kind::Pieces, "animals", &[]));
        assert!(!it.owns(Kind::Pieces, "space", &[]));
        assert!(it.owns(Kind::Pieces, "space", &[key(Kind::Pieces, "space")]));
    }
}
