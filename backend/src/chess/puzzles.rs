//! Daily chess puzzles: "White (or Black) to move and mate in 2".
//!
//! The puzzles live in `shared/chess_puzzles.json`. They were found by
//! Zero-Bot self-play and checked by the mate solver (see `generate` below,
//! run with `cargo test --release -- --ignored generate_puzzles`). Everyone
//! gets the same puzzle on the same WIB day. Any move that still forces
//! mate counts as right, not only the stored solution.

use std::sync::OnceLock;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

const JSON: &str = include_str!("../../../shared/chess_puzzles.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Puzzle {
    pub id: u32,
    /// Start position; the side to move is the solver.
    pub fen: String,
    /// Mate within this many of the solver's moves.
    pub mate_in: u8,
    /// One correct line in UCI (solver, reply, solver, …), shown after a fail.
    pub solution: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct File {
    puzzles: Vec<Puzzle>,
}

pub fn puzzles() -> &'static [Puzzle] {
    static P: OnceLock<Vec<Puzzle>> = OnceLock::new();
    P.get_or_init(|| serde_json::from_str::<File>(JSON).expect("shared/chess_puzzles.json").puzzles)
}

/// The puzzle for a WIB day. Steps through the list in a scrambled but
/// fixed order, so puzzles don't repeat until the whole list has been used.
pub fn for_day(day: NaiveDate) -> &'static Puzzle {
    let all = puzzles();
    let n = all.len() as i64;
    let days = (day - NaiveDate::from_ymd_opt(2026, 1, 1).expect("date")).num_days();
    // 7919 is prime and bigger than the list, so this visits every index once per cycle.
    let i = (days.rem_euclid(n) * 7919).rem_euclid(n);
    &all[i as usize]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chess::ai::{best_defence, forces_mate, mate_in, mating_moves};
    use crate::chess::{Game, Side};
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;
    use std::collections::HashSet;

    #[test]
    fn every_day_has_a_puzzle_and_they_dont_repeat_soon() {
        let all = puzzles();
        assert!(all.len() >= 100, "only {} puzzles", all.len());
        let start = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
        let ids: HashSet<u32> = (0..all.len() as i64).map(|d| for_day(start + chrono::Duration::days(d)).id).collect();
        assert_eq!(ids.len(), all.len(), "a full cycle visits every puzzle once");
        let ids: HashSet<u32> = all.iter().map(|p| p.id).collect();
        assert_eq!(ids.len(), all.len(), "ids are unique");
    }

    /// Spot-check stored puzzles with the mate solver (the generator checked all of them).
    #[test]
    fn puzzles_are_real_mates() {
        for p in puzzles().iter().step_by(25) {
            let mut g = Game::from_fen(&p.fen).unwrap();
            assert!(mate_in(g.board(), 1).is_none(), "puzzle {} is not a mate in 1", p.id);
            for (i, mv) in p.solution.iter().enumerate() {
                g.play(mv).unwrap_or_else(|e| panic!("puzzle {} move {mv}: {}", p.id, e.text()));
                if i == 0 {
                    assert!(forces_mate(g.board(), p.mate_in), "puzzle {} first move forces mate", p.id);
                }
            }
            assert!(matches!(g.outcome(), crate::chess::Outcome::Checkmate(_)), "puzzle {} ends in mate", p.id);
        }
    }

    /// Finds new puzzles from Zero-Bot self-play and writes the JSON file.
    #[test]
    #[ignore]
    fn generate_puzzles() {
        use crate::chess::ai::{best_move, evaluate, Level};
        use std::time::{Duration, Instant};
        const WANT: usize = 180;
        let mut rng = ChaCha8Rng::seed_from_u64(20261115);
        let mut out: Vec<Puzzle> = Vec::new();
        let mut seen = HashSet::new();
        let (mut whites, mut blacks) = (0, 0);
        let t = Instant::now();
        let mut games = 0;
        while out.len() < WANT && t.elapsed() < Duration::from_secs(3000) {
            games += 1;
            let mut g = Game::new();
            // A few random opening moves so games differ.
            let random_plies = 2 + games % 5;
            for _ in 0..random_plies {
                let legal = g.legal_moves();
                let m = &legal[rand::Rng::gen_range(&mut rng, 0..legal.len())];
                g.play(m).unwrap();
            }
            let levels = [Level::Medium, Level::Hard];
            let (lw, lb) = (levels[games % 2], levels[(games / 2) % 2]);
            for ply in 0..160 {
                if g.outcome().is_over() {
                    break;
                }
                let b = g.board();
                // Keep the two colours balanced.
                let side = g.to_move();
                let need = if side == Side::White { whites <= blacks + 5 } else { blacks <= whites + 5 };
                if ply >= 10 && need && mate_in(b, 1).is_none() && evaluate(b) < 700 {
                    let ms = mating_moves(b, 2);
                    let key = g.fen().split(' ').take(2).collect::<Vec<_>>().join(" ");
                    if (1..=2).contains(&ms.len()) && seen.insert(key) {
                        let mut line = Game::from_fen(&g.fen()).unwrap();
                        line.play_move(ms[0]);
                        let reply = best_defence(line.board(), &mut rng).unwrap();
                        line.play_move(reply);
                        let last = mate_in(line.board(), 1).expect("mate in 1 after the reply");
                        line.play_move(last);
                        out.push(Puzzle { id: out.len() as u32 + 1, fen: g.fen(), mate_in: 2, solution: line.moves().to_vec() });
                        if side == Side::White {
                            whites += 1
                        } else {
                            blacks += 1
                        }
                        eprintln!("{} puzzles after {games} games ({:?})", out.len(), t.elapsed());
                        break; // one puzzle per game, for variety
                    }
                }
                let level = if side == Side::White { lw } else { lb };
                let m = best_move(b, level, Duration::from_millis(60), &mut rng).unwrap();
                g.play_move(m);
            }
        }
        let json = serde_json::to_string_pretty(&File { puzzles: out }).unwrap();
        std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/../shared/chess_puzzles.json"), json + "\n").unwrap();
    }
}
