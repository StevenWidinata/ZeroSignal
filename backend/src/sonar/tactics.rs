//! Sonar Tactics: every ship type has a power that recharges while the ship
//! is afloat. The settings live in `shared/sonar_tactics.json` (read by the
//! browser too); the moves themselves are played by `rules::Sea::strike` and
//! `rules::Duel::play`.
//!
//! - Powers are in fleet order: 0 Air Strike (carrier), 1 Salvo (battleship),
//!   2 Radar Sweep (cruiser), 3 Torpedo (submarine), 4 Flare (destroyer).
//! - A power is ready when its charge reaches its cooldown. Every move a side
//!   makes adds 1 charge to its other powers (up to the cooldown); using a
//!   power sets its charge to 0. Charges start at half the cooldown.
//! - A sunk ship's power is gone. The submarine also runs silent: while it is
//!   afloat, enemy pings and radar don't count it.
//! - Each side has its own Mk level (1–3) per power (Workshop upgrades).
//! - Extras: each side may hide 2 mines with its fleet (shooting one shows
//!   the mine's owner one of the shooter's ship squares); 3 supply crates are
//!   hidden in each sea from the game seed (shooting one gives its item); and
//!   3 firing moves in a row that hit fill Overdrive, which instantly charges
//!   one power ("o2") and keeps the turn.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use super::rules::{neighbours, Fleet, CELLS};
use crate::rng::Rng;

const TACTICS_JSON: &str = include_str!("../../../shared/sonar_tactics.json");

pub const POWERS: usize = 5;
pub const AIR_STRIKE: usize = 0;
pub const SALVO: usize = 1;
pub const RADAR: usize = 2;
pub const TORPEDO: usize = 3;
pub const FLARE: usize = 4;
/// The ship that runs silent (the submarine), by fleet index.
pub const SILENT_SHIP: u8 = 3;
pub const MAX_LEVEL: u8 = 3;

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct PowerLevel {
    pub cooldown: u8,
    pub size: u8,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PowerSpec {
    pub id: String,
    pub ship: String,
    pub name: String,
    pub code: String,
    pub levels: Vec<PowerLevel>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ItemSpec {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TacticsRules {
    /// Coins for Mk II and Mk III of one power (the Workshop).
    pub upgrade_prices: Vec<i64>,
    /// Zero-Bot's Mk on each level ("easy" … "master").
    pub bot_mk: std::collections::HashMap<String, u8>,
    pub mines: u8,
    pub crates: u8,
    pub combo: u8,
    pub items: Vec<ItemSpec>,
    pub powers: Vec<PowerSpec>,
}

/// What a supply crate holds (same order as `items` in the JSON).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Item {
    Ping,
    Shield,
    Repair,
    ExtraShot,
}

impl Item {
    pub const ALL: [Item; 4] = [Item::Ping, Item::Shield, Item::Repair, Item::ExtraShot];

    pub fn id(self) -> &'static str {
        match self {
            Item::Ping => "ping",
            Item::Shield => "shield",
            Item::Repair => "repair",
            Item::ExtraShot => "extra_shot",
        }
    }
}

/// How a Tactics game is set up: each side's Mk levels, the seed that hides
/// the crates, how many crates each sea gets, and any Campaign twists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Setup {
    pub levels: [Levels; 2],
    pub seed: u32,
    pub crates: u8,
    pub twists: Twists,
}

impl Setup {
    /// A normal game: Mk levels as given, the usual number of crates.
    pub fn new(levels: [Levels; 2], seed: u32) -> Setup {
        Setup { levels, seed, crates: tactics_rules().crates, twists: Twists::default() }
    }
}

/// Campaign twists on top of the Tactics rules (all off in normal games).
/// Arrays are per side: [side 0, side 1]; "sea s" is side s's own sea.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Twists {
    /// Sinking a ship doesn't show the water around it.
    pub fog: bool,
    /// Every ship in sea s hides from pings and radar (not just the sub).
    pub silent_all: [bool; 2],
    /// Shields sea s starts with.
    pub shields: [u8; 2],
    /// Crates hidden in each sea instead of `Setup::crates`.
    pub crates: Option<[u8; 2]>,
    /// Side s can't use ship powers (or Overdrive).
    pub no_powers: [bool; 2],
}

pub fn tactics_rules() -> &'static TacticsRules {
    static R: OnceLock<TacticsRules> = OnceLock::new();
    R.get_or_init(|| serde_json::from_str(TACTICS_JSON).expect("shared/sonar_tactics.json"))
}

/// A power's numbers at Mk `level` (1–3; anything else counts as the nearest).
pub fn power_level(power: usize, level: u8) -> PowerLevel {
    tactics_rules().powers[power].levels[usize::from(level.clamp(1, MAX_LEVEL)) - 1]
}

/// Mk levels for one side's five powers.
pub type Levels = [u8; POWERS];
pub const MK1: Levels = [1; POWERS];

/// Both sides' power charges, combo counts and Overdrive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Tactics {
    pub levels: [Levels; 2],
    pub charge: [[u8; POWERS]; 2],
    /// Firing moves in a row that hit (resets on a firing move that doesn't).
    pub combo: [u8; 2],
    /// A full Overdrive, ready to spend.
    pub overdrive: [bool; 2],
}

impl Tactics {
    pub fn new(levels: [Levels; 2]) -> Tactics {
        let mut charge = [[0; POWERS]; 2];
        for side in 0..2 {
            for p in 0..POWERS {
                charge[side][p] = power_level(p, levels[side][p]).cooldown / 2;
            }
        }
        Tactics { levels, charge, combo: [0; 2], overdrive: [false; 2] }
    }

    pub fn spec(&self, side: usize, power: usize) -> PowerLevel {
        power_level(power, self.levels[side][power])
    }

    pub fn ready(&self, side: usize, power: usize) -> bool {
        self.charge[side][power] >= self.spec(side, power).cooldown
    }

    /// After `side` moved: the power it used (if any) starts over, the rest charge up.
    pub fn after_move(&mut self, side: usize, used: Option<usize>) {
        for p in 0..POWERS {
            self.charge[side][p] = if used == Some(p) { 0 } else { (self.charge[side][p] + 1).min(self.spec(side, p).cooldown) };
        }
    }

    /// After a firing move by `side`: count the combo and fill Overdrive.
    /// (Pings, radar and flares don't fire, so they leave the combo alone.)
    pub fn after_firing(&mut self, side: usize, hit: bool) {
        if !hit {
            self.combo[side] = 0;
            return;
        }
        let full = tactics_rules().combo;
        self.combo[side] = (self.combo[side] + 1).min(full);
        if self.combo[side] == full && !self.overdrive[side] {
            self.overdrive[side] = true;
            self.combo[side] = 0;
        }
    }

    /// Spend Overdrive to charge `power` right away.
    pub fn spend_overdrive(&mut self, side: usize, power: usize) {
        self.overdrive[side] = false;
        self.charge[side][power] = self.spec(side, power).cooldown;
    }
}

/// The seed that hides sea `side`'s crates (mixed so the two seas differ).
pub fn crate_seed(seed: u32, side: usize) -> u32 {
    seed ^ 0xC8A7_E5A1u32.wrapping_add(side as u32)
}

/// Hide `n` supply crates in a sea: on open water, not next to a ship and
/// not on a mine. Same picks as `hideCrates` in tactics.ts.
pub fn hide_crates(fleet: &Fleet, seed: u32, n: u8) -> Vec<(usize, Item)> {
    let occ = fleet.occupancy();
    let mut spots: Vec<usize> =
        (0..CELLS).filter(|&c| occ[c].is_none() && neighbours(c).all(|x| occ[x].is_none()) && !fleet.mines.contains(&c)).collect();
    let mut rng = Rng::new(seed);
    let mut out = Vec::new();
    for _ in 0..n {
        if spots.is_empty() {
            break;
        }
        let cell = spots.remove(rng.below(spots.len() as u32) as usize);
        let item = Item::ALL[rng.below(Item::ALL.len() as u32) as usize];
        out.push((cell, item));
    }
    out
}

/// "1,1,2,3,1" -> Mk levels (None if malformed).
pub fn parse_levels(s: &str) -> Option<Levels> {
    let v: Vec<u8> = s.split(',').map(|t| t.trim().parse().ok().filter(|l| (1..=MAX_LEVEL).contains(l))).collect::<Option<_>>()?;
    v.try_into().ok()
}

pub fn levels_code(l: &Levels) -> String {
    l.iter().map(u8::to_string).collect::<Vec<_>>().join(",")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sonar::rules::rules;

    #[test]
    fn powers_follow_the_fleet() {
        let t = tactics_rules();
        assert_eq!(t.powers.len(), POWERS);
        for (p, spec) in t.powers.iter().enumerate() {
            assert_eq!(spec.ship, rules().fleet[p].id, "power {} belongs to ship {p}", spec.id);
            assert_eq!(spec.levels.len(), usize::from(MAX_LEVEL));
            // Every upgrade makes a power better, never worse.
            for w in spec.levels.windows(2) {
                assert!(w[1].cooldown <= w[0].cooldown && w[1].size >= w[0].size, "{}", spec.id);
                assert!(w[1].cooldown < w[0].cooldown || w[1].size > w[0].size, "{}: an upgrade that changes nothing", spec.id);
            }
        }
        assert_eq!(rules().fleet[usize::from(SILENT_SHIP)].id, "submarine");
        let codes: Vec<&str> = t.powers.iter().map(|p| p.code.as_str()).collect();
        assert_eq!(codes, ["a", "b", "r", "t", "l"]);
        let items: Vec<&str> = t.items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(items, Item::ALL.map(Item::id));
    }

    #[test]
    fn three_hits_in_a_row_fill_overdrive() {
        let mut t = Tactics::new([MK1, MK1]);
        t.after_firing(0, true);
        t.after_firing(0, false);
        t.after_firing(0, true);
        t.after_firing(0, true);
        assert!(!t.overdrive[0]);
        t.after_firing(0, true);
        assert!(t.overdrive[0]);
        assert_eq!(t.combo[0], 0);
        // A second full meter waits until the first is spent.
        for _ in 0..4 {
            t.after_firing(0, true);
        }
        assert_eq!(t.combo[0], 3);
        t.spend_overdrive(0, AIR_STRIKE);
        assert!(t.ready(0, AIR_STRIKE) && !t.overdrive[0]);
        t.after_firing(0, true);
        assert!(t.overdrive[0]);
    }

    #[test]
    fn charges_start_at_half_and_cap_at_the_cooldown() {
        let mut t = Tactics::new([MK1, MK1]);
        assert_eq!(t.charge[0], [3, 2, 2, 2, 2]);
        assert!(!t.ready(0, FLARE));
        t.after_move(0, None);
        t.after_move(0, None);
        assert!(t.ready(0, FLARE));
        t.after_move(0, Some(FLARE));
        assert_eq!(t.charge[0], [6, 5, 5, 5, 0]);
        assert_eq!(t.charge[1], [3, 2, 2, 2, 2], "the other side didn't move");
    }

    #[test]
    fn levels_round_trip() {
        assert_eq!(parse_levels("1,2,3,1,1"), Some([1, 2, 3, 1, 1]));
        assert_eq!(parse_levels("1,2,3,1"), None);
        assert_eq!(parse_levels("1,2,4,1,1"), None);
        assert_eq!(levels_code(&[3, 3, 3, 3, 3]), "3,3,3,3,3");
    }
}

