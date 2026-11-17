//! Daily checkers puzzles: "Dark (or Light) to move and win in N".
//!
//! "Win" means the other side is left without a legal move (all pieces
//! taken or blocked). The puzzles live in `shared/checkers_puzzles.json`;
//! they were found by Zero-Bot self-play and checked by the solver (run
//! `cargo test --release checkers_generate_puzzles -- --ignored`). Everyone
//! gets the same puzzle on the same WIB day, and any move that still forces
//! the win in time counts as right, not only the stored solution.

use std::sync::OnceLock;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

const JSON: &str = include_str!("../../../shared/checkers_puzzles.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Puzzle {
    pub id: u32,
    /// Start position (`rules::encode`); the side to move is the solver.
    pub pos: String,
    /// Win within this many of the solver's moves.
    pub win_in: u8,
    /// One correct line (solver, reply, solver, …), shown after a fail.
    pub solution: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct File {
    puzzles: Vec<Puzzle>,
}

pub fn puzzles() -> &'static [Puzzle] {
    static P: OnceLock<Vec<Puzzle>> = OnceLock::new();
    P.get_or_init(|| serde_json::from_str::<File>(JSON).expect("shared/checkers_puzzles.json").puzzles)
}

/// The puzzle for a WIB day, in a scrambled but fixed order so puzzles don't
/// repeat until the whole list has been used.
pub fn for_day(day: NaiveDate) -> &'static Puzzle {
    let all = puzzles();
    let n = all.len() as i64;
    let days = (day - NaiveDate::from_ymd_opt(2026, 1, 1).expect("date")).num_days();
    // 7919 is prime and bigger than the list, so a cycle visits every index once.
    let i = (days.rem_euclid(n) * 7919).rem_euclid(n);
    &all[i as usize]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checkers::ai::{best_defence, forces_win, winning_moves};
    use crate::checkers::rules::{decode, encode, Game, Move, Outcome};
    use std::collections::HashSet;

    #[test]
    fn every_day_has_a_puzzle_and_they_dont_repeat_soon() {
        let all = puzzles();
        assert!(all.len() >= 100, "only {} puzzles", all.len());
        let start = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
        let ids: HashSet<u32> = (0..all.len() as i64).map(|d| for_day(start + chrono::Duration::days(d)).id).collect();
        assert_eq!(ids.len(), all.len(), "a full cycle visits every puzzle once");
    }

    /// Spot-check stored puzzles with the solver (the generator checked them all).
    #[test]
    fn puzzles_are_real_wins() {
        for p in puzzles().iter().step_by(20) {
            let (cells, turn) = decode(&p.pos).unwrap();
            let g = Game::from_position(cells, turn);
            assert!(winning_moves(&g, p.win_in - 1).is_empty(), "puzzle {} isn't shorter", p.id);
            let line = Game::replay_from(cells, turn, &p.solution.join(" ")).unwrap();
            assert_eq!(line.outcome(), Outcome::Win(turn), "puzzle {} ends in a win", p.id);
            let mut first = g.clone();
            first.play_str(&p.solution[0]).unwrap();
            assert!(forces_win(&first, p.win_in), "puzzle {} first move forces the win", p.id);
        }
    }

    /// Finds puzzles from Zero-Bot self-play and writes the JSON file.
    #[test]
    #[ignore]
    fn checkers_generate_puzzles() {
        use crate::checkers::ai::{best_move, Level};
        use crate::checkers::rules::Side;
        use rand::{Rng, SeedableRng};
        use rand_chacha::ChaCha8Rng;
        use std::time::{Duration, Instant};
        const WANT: usize = 180;
        let mut rng = ChaCha8Rng::seed_from_u64(20261117);
        let mut out: Vec<Puzzle> = Vec::new();
        let mut seen = HashSet::new();
        let (mut darks, mut lights) = (0, 0);
        let mut by_len = [0usize; 5];
        let t = Instant::now();
        let mut games = 0usize;
        while out.len() < WANT && t.elapsed() < Duration::from_secs(2400) {
            games += 1;
            let mut g = Game::new();
            for _ in 0..(2 + games % 6) {
                let legal = g.legal_moves();
                let m = legal[rng.gen_range(0..legal.len())].clone();
                g.apply(&m);
            }
            let levels = [Level::Easy, Level::Medium, Level::Hard];
            let (ld, ll) = (levels[games % 3], levels[(games / 3) % 3]);
            let mut found_here = 0;
            while g.outcome() == Outcome::Ongoing && g.moves.len() < 200 && found_here < 2 {
                let side = g.turn;
                let need = if side == Side::Dark { darks <= lights + 5 } else { lights <= darks + 5 };
                let pieces = g.cells.iter().filter(|&&c| c != 0).count();
                if g.moves.len() >= 16 && need && pieces <= 14 && winning_moves(&g, 1).is_empty() {
                    // The shortest forced win, 2 to 4 moves, with few right first moves.
                    for n in 2..=4u8 {
                        let ms = winning_moves(&g, n);
                        if ms.is_empty() {
                            continue;
                        }
                        let key = encode(&g.cells, g.turn);
                        // Prefer longer puzzles: keep the mix about even.
                        let full = by_len[n as usize] >= WANT / 3 + 4;
                        if ms.len() <= 2 && !full && seen.insert(key.clone()) {
                            let mut line = g.clone();
                            let mut sol: Vec<Move> = vec![ms[0].clone()];
                            line.apply(&ms[0]);
                            let mut left = n;
                            while line.outcome() == Outcome::Ongoing {
                                let reply = best_defence(&line, left).expect("a reply");
                                line.apply(&reply);
                                sol.push(reply);
                                left -= 1;
                                let next = winning_moves(&line, left)[0].clone();
                                line.apply(&next);
                                sol.push(next);
                            }
                            assert_eq!(line.outcome(), Outcome::Win(side));
                            out.push(Puzzle {
                                id: out.len() as u32 + 1,
                                pos: key,
                                win_in: n,
                                solution: sol.iter().map(Move::notation).collect(),
                            });
                            by_len[n as usize] += 1;
                            found_here += 1;
                            if side == Side::Dark {
                                darks += 1
                            } else {
                                lights += 1
                            }
                            eprintln!("{} puzzles after {games} games ({:?}) {:?}", out.len(), t.elapsed(), by_len);
                            // Save as we go, so a stopped run keeps what it found.
                            save(&out);
                        }
                        break;
                    }
                }
                let level = if side == Side::Dark { ld } else { ll };
                let m = best_move(&g, level, Duration::from_millis(40), &mut rng).unwrap();
                g.apply(&m);
            }
        }
        save(&out);
    }

    fn save(out: &[Puzzle]) {
        let json = serde_json::to_string_pretty(&File { puzzles: out.to_vec() }).unwrap();
        std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/../shared/checkers_puzzles.json"), json + "\n").unwrap();
    }
}
