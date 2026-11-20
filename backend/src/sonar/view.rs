//! What a player is allowed to see of a sea: hits, misses, sunk ships, the
//! water around them and ping counts. Never the ships that are still hidden.

use serde::Serialize;

use super::rules::{Duel, Mark, Move, Ping, Sea, ShotResult, Sweep, CELLS};
use super::tactics::POWERS;

#[derive(Debug, Clone, Serialize)]
pub struct SunkShip {
    pub ship: u8,
    pub cells: Vec<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SeaView {
    /// 100 characters, cell 0 first: '.' unknown, 'o' miss, 'x' hit,
    /// 's' sunk ship, '-' known water, '*' spotted ship (see `Mark::ch`).
    pub marks: String,
    pub sunk: Vec<SunkShip>,
    pub pings: Vec<Ping>,
    /// Pings the shooter still has against this sea.
    pub pings_left: u8,
    pub shots: usize,
    pub all_sunk: bool,
    /// Tactics: radar sweeps of this sea.
    pub sweeps: Vec<Sweep>,
    /// Tactics: shields guarding this sea's ships (each blocks one hit).
    pub shields: u8,
}

impl SeaView {
    pub fn of(sea: &Sea) -> SeaView {
        let marks = sea.marks.iter().map(|m| m.ch()).collect();
        let mut sunk: Vec<SunkShip> = Vec::new();
        for c in 0..CELLS {
            if let Mark::Sunk(ship) = sea.marks[c] {
                match sunk.iter_mut().find(|s| s.ship == ship) {
                    Some(s) => s.cells.push(c),
                    None => sunk.push(SunkShip { ship, cells: vec![c] }),
                }
            }
        }
        SeaView {
            marks,
            sunk,
            pings: sea.pings.clone(),
            pings_left: sea.pings_left(),
            shots: sea.shots(),
            all_sunk: sea.all_sunk(),
            sweeps: sea.sweeps.clone(),
            shields: sea.shields,
        }
    }
}

/// One move in the log, from the viewer's side.
#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    /// true = the viewer made this move.
    pub mine: bool,
    #[serde(rename = "move")]
    pub mv: String,
    pub cell: usize,
    pub ping: bool,
    /// The headline result (a sinking beats a hit beats a miss).
    pub result: ShotResult,
    /// Tactics: every square the move touched in the other sea.
    pub hits: Vec<CellResult>,
    /// Tactics: what happened in the mover's own sea (a mine showed a ship
    /// square, a repair kit fixed one).
    pub own: Vec<CellResult>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CellResult {
    pub cell: usize,
    pub result: ShotResult,
}

fn cells(v: &[(usize, ShotResult)]) -> Vec<CellResult> {
    v.iter().map(|&(cell, result)| CellResult { cell, result }).collect()
}

/// One side's Tactics powers, in fleet order (all public: both players can
/// work them out from the moves).
#[derive(Debug, Clone, Serialize)]
pub struct PowersView {
    pub charge: [u8; POWERS],
    pub cooldown: [u8; POWERS],
    pub size: [u8; POWERS],
    pub levels: [u8; POWERS],
    /// The ship with this power has sunk.
    pub lost: [bool; POWERS],
    pub combo: u8,
    pub overdrive: bool,
}

impl PowersView {
    /// `side`'s powers, or None in a Classic duel.
    pub fn of(d: &Duel, side: usize) -> Option<PowersView> {
        let t = d.tactics.as_ref()?;
        Some(PowersView {
            charge: t.charge[side],
            cooldown: std::array::from_fn(|p| t.spec(side, p).cooldown),
            size: std::array::from_fn(|p| t.spec(side, p).size),
            levels: t.levels[side],
            lost: std::array::from_fn(|p| d.seas[side].is_sunk(p)),
            combo: t.combo[side],
            overdrive: t.overdrive[side],
        })
    }
}

/// The duel's log as seen by `side`.
pub fn log_for(d: &Duel, side: usize) -> Vec<LogEntry> {
    d.log
        .iter()
        .map(|t| LogEntry {
            mine: t.side == side,
            mv: t.mv.code(),
            cell: t.mv.cell(),
            ping: matches!(t.mv, Move::Ping(_)),
            result: t.main(),
            hits: cells(&t.results),
            own: cells(&t.own),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sonar::rules::Fleet;

    #[test]
    fn the_view_hides_ships_that_arent_found() {
        let f = Fleet::parse("a1h a3h a5h a7h a9h").unwrap();
        let (sea, _) = Sea::replay(&f, "f0 f80 f81 f99 p55").unwrap();
        let v = SeaView::of(&sea);
        assert_eq!(&v.marks[0..2], "x.");
        assert_eq!(&v.marks[80..83], "ss-");
        assert_eq!(v.marks.chars().nth(99), Some('o'));
        assert_eq!(v.marks.chars().filter(|&c| c == 'x' || c == 's').count(), 3, "only the hit and the sunk destroyer show");
        assert_eq!(v.sunk.len(), 1);
        assert_eq!(v.pings_left, 1);
        assert_eq!(v.shots, 5);
    }
}
