use serde::Serialize;

/// Special ability a bird can trigger mid-flight (on "tap").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Ability {
    None,     // Red: balanced, no ability
    Dash,     // Chuck: speed burst in travel direction
    Explode,  // Bomb: radial impulse to nearby bodies
    EggDrop,  // Matilda: downward impulse / drop
    Heavy,    // Terence: extra mass, no active ability
    Split,    // Blues: splits into 3
}

#[derive(Debug, Clone, Serialize)]
pub struct BirdVariant {
    pub id: &'static str,
    pub name: &'static str,
    pub color: &'static str,
    pub ability: Ability,
    pub mass: f32,
    pub power: f32,
    pub unlock_score: i32,
    pub description: &'static str,
}

/// The full catalog. Order defines display order.
pub const BIRDS: &[BirdVariant] = &[
    BirdVariant {
        id: "pip",
        name: "Pip",
        color: "#FF6B35",
        ability: Ability::None,
        mass: 1.0,
        power: 1.0,
        unlock_score: 0,
        description: "The classic. Balanced mass and power.",
    },
    BirdVariant {
        id: "zip",
        name: "Zip",
        color: "#FFD23F",
        ability: Ability::Dash,
        mass: 0.7,
        power: 1.1,
        unlock_score: 2000,
        description: "Speedster. Tap to dash forward.",
    },
    BirdVariant {
        id: "boomer",
        name: "Boomer",
        color: "#4B2A6B",
        ability: Ability::Explode,
        mass: 1.6,
        power: 1.0,
        unlock_score: 5000,
        description: "Tap to explode, blasting nearby blocks.",
    },
    BirdVariant {
        id: "eggbert",
        name: "Eggbert",
        color: "#F7E7C6",
        ability: Ability::EggDrop,
        mass: 1.0,
        power: 0.9,
        unlock_score: 9000,
        description: "Tap to drop an egg bomb straight down.",
    },
    BirdVariant {
        id: "tank",
        name: "Tank",
        color: "#7A3E1D",
        ability: Ability::Heavy,
        mass: 2.6,
        power: 1.0,
        unlock_score: 15000,
        description: "Huge mass. Smashes through everything.",
    },
    BirdVariant {
        id: "trio",
        name: "Trio",
        color: "#2EC4B6",
        ability: Ability::Split,
        mass: 0.6,
        power: 1.0,
        unlock_score: 22000,
        description: "Tap to split into three birds.",
    },
];

pub fn find(id: &str) -> Option<&'static BirdVariant> {
    BIRDS.iter().find(|b| b.id == id)
}

pub fn is_unlocked(id: &str, best_score: i32) -> bool {
    find(id).map(|b| best_score >= b.unlock_score).unwrap_or(false)
}
