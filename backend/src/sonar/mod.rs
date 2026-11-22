//! Sonar: a Battleship-style game with sonar pings. Rules shared with the
//! browser, Zero-Bot, games vs Zero-Bot, the Daily Hunt and the fleet shop.

pub mod ai;
pub mod api;
pub mod campaign;
pub mod daily;
pub mod items;
pub mod rules;
pub mod tactics;
pub mod view;

/// New games and rooms are always Tactics (ship powers); Classic (shots and
/// pings only) was retired. Unfinished Classic games and rooms still play.
pub const CLASSIC_RETIRED: &str = "Classic Sonar was retired: every battle has ship powers now. Reload the page.";
pub mod workshop;
