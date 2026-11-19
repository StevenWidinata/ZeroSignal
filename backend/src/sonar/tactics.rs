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

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

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
pub struct TacticsRules {
    pub powers: Vec<PowerSpec>,
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

/// Both sides' power charges.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Tactics {
    pub levels: [Levels; 2],
    pub charge: [[u8; POWERS]; 2],
}

impl Tactics {
    pub fn new(levels: [Levels; 2]) -> Tactics {
        let mut charge = [[0; POWERS]; 2];
        for side in 0..2 {
            for p in 0..POWERS {
                charge[side][p] = power_level(p, levels[side][p]).cooldown / 2;
            }
        }
        Tactics { levels, charge }
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
            // Upgrades never make a power worse.
            for w in spec.levels.windows(2) {
                assert!(w[1].cooldown <= w[0].cooldown && w[1].size >= w[0].size, "{}", spec.id);
            }
        }
        assert_eq!(rules().fleet[usize::from(SILENT_SHIP)].id, "submarine");
        let codes: Vec<&str> = t.powers.iter().map(|p| p.code.as_str()).collect();
        assert_eq!(codes, ["a", "b", "r", "t", "l"]);
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
