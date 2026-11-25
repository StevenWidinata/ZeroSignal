//! Brick Breaker: a 24-level Campaign, Endless waves and a Daily. The server
//! replays every run from the paddle inputs (see `engine.rs`).

pub mod api;
// Some engine fields and helpers are only read by tests and the frontend copy.
#[allow(dead_code)]
pub mod engine;
pub mod items;
pub mod levels;
