//! Making puzzles: fill a random grid, then empty squares in mirrored pairs
//! (180° turn) as long as the solution stays unique, then grade it. The bank
//! in `backend/data/sudoku_puzzles.json` is made once by the ignored test
//! below; games pick from it (see `bank.rs`).

use rand::seq::SliceRandom;
use rand::Rng;

use super::rules::{filled, Grid, Level, CELLS};
use super::solver::{count_solutions, grade, random_full, Technique};

/// Which level a puzzle belongs to (by the logic it needs and its givens),
/// or None if it fits none.
pub fn classify(g: &Grid) -> Option<Level> {
    let givens = filled(g);
    let t = grade(g)?;
    match t {
        Technique::NakedSingle if (38..=44).contains(&givens) => Some(Level::Easy),
        Technique::NakedSingle | Technique::HiddenSingle if (30..=35).contains(&givens) => Some(Level::Medium),
        Technique::LockedCandidates | Technique::NakedPair | Technique::HiddenPair if givens <= 32 => Some(Level::Hard),
        Technique::NakedTriple | Technique::HiddenTriple | Technique::XWing if givens <= 32 => Some(Level::Expert),
        _ => None,
    }
}

/// Empty squares of `solution` in mirrored pairs while it keeps one
/// solution, stopping at `min_givens` (or when nothing more can go).
pub fn dig<R: Rng>(solution: &Grid, min_givens: usize, rng: &mut R) -> Grid {
    let mut g = *solution;
    let mut order: Vec<usize> = (0..=CELLS / 2).collect();
    order.shuffle(rng);
    for c in order {
        if filled(&g) <= min_givens {
            break;
        }
        let pair = [c, CELLS - 1 - c];
        let keep = [g[pair[0]], g[pair[1]]];
        g[pair[0]] = 0;
        g[pair[1]] = 0;
        if count_solutions(&g, 2) != 1 {
            g[pair[0]] = keep[0];
            g[pair[1]] = keep[1];
        }
    }
    g
}

/// One try at a puzzle: Easy and Medium stop digging at a few more givens;
/// Hard and Expert dig as far as possible.
pub fn attempt<R: Rng>(easy_side: Option<Level>, rng: &mut R) -> (Grid, Option<Level>) {
    let solution = random_full(rng);
    let min = match easy_side {
        Some(Level::Easy) => rng.gen_range(38..=42),
        Some(Level::Medium) => rng.gen_range(30..=34),
        _ => 0,
    };
    let g = dig(&solution, min, rng);
    (g, classify(&g))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sudoku::rules::code;
    use crate::sudoku::solver::solve;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    #[test]
    fn dug_puzzles_keep_one_solution() {
        let mut rng = ChaCha8Rng::seed_from_u64(7);
        let s = random_full(&mut rng);
        let g = dig(&s, 30, &mut rng);
        assert!(filled(&g) <= 31 && filled(&g) >= 28, "{}", filled(&g));
        assert_eq!(count_solutions(&g, 2), 1);
        assert_eq!(solve(&g), Some(s));
        // Mirrored: a square and its opposite are both empty or both filled.
        assert!((0..CELLS).all(|c| (g[c] == 0) == (g[CELLS - 1 - c] == 0)));
    }

    #[test]
    fn attempts_classify_into_levels() {
        let mut rng = ChaCha8Rng::seed_from_u64(11);
        let mut seen = std::collections::HashSet::new();
        for i in 0..60 {
            let side = [Some(Level::Easy), Some(Level::Medium), None][i % 3];
            let (g, level) = attempt(side, &mut rng);
            if let Some(l) = level {
                assert_eq!(classify(&g), Some(l));
                seen.insert(l);
            }
            assert_eq!(count_solutions(&g, 2), 1, "{}", code(&g));
        }
        assert!(seen.contains(&Level::Easy) && seen.contains(&Level::Medium), "{seen:?}");
    }

    /// Makes the puzzle bank and writes `backend/data/sudoku_puzzles.json`.
    /// `cargo test --release sudoku_make_bank -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn sudoku_make_bank() {
        use std::collections::{BTreeMap, HashSet};
        use std::sync::Mutex;
        use std::time::Instant;
        const PER_LEVEL: usize = 250;
        const DAILY: usize = 366;
        let want = |name: &str| if name == "daily" { DAILY } else { PER_LEVEL };
        let bank: Mutex<BTreeMap<&'static str, Vec<String>>> = Mutex::new(["easy", "medium", "hard", "expert", "daily"].into_iter().map(|k| (k, Vec::new())).collect());
        let seen: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
        let t = Instant::now();
        let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
        std::thread::scope(|scope| {
            for th in 0..threads {
                let (bank, seen) = (&bank, &seen);
                scope.spawn(move || {
                    let mut rng = ChaCha8Rng::seed_from_u64(20261122 + th as u64);
                    let mut tries = 0u64;
                    loop {
                        let need = |k: &str| bank.lock().unwrap()[k].len() < want(k);
                        let (easy, medium, daily, hard_side) = (need("easy"), need("medium"), need("daily"), need("hard") || need("expert"));
                        if !(easy || medium || daily || hard_side) {
                            break;
                        }
                        tries += 1;
                        // Hard/Expert are rare, so most tries dig all the way.
                        let side = match tries % 6 {
                            0 if easy => Some(Level::Easy),
                            1 if medium || daily => Some(Level::Medium),
                            _ if hard_side => None,
                            _ if easy => Some(Level::Easy),
                            _ => Some(Level::Medium),
                        };
                        let (g, level) = attempt(side, &mut rng);
                        let Some(level) = level else { continue };
                        let c = code(&g);
                        if !seen.lock().unwrap().insert(c.clone()) {
                            continue;
                        }
                        let mut b = bank.lock().unwrap();
                        // Medium puzzles fill the Medium list, then the Daily list.
                        let key = match level.as_str() {
                            "medium" if b["medium"].len() >= PER_LEVEL => "daily",
                            k => k,
                        };
                        let key: &'static str = ["easy", "medium", "hard", "expert", "daily"].into_iter().find(|&k| k == key).unwrap();
                        if b[key].len() < want(key) {
                            b.get_mut(key).unwrap().push(c);
                            let sizes: Vec<String> = b.iter().map(|(k, v)| format!("{k} {}", v.len())).collect();
                            if b.values().map(Vec::len).sum::<usize>() % 50 == 0 {
                                eprintln!("{:?}: {}", t.elapsed(), sizes.join(", "));
                            }
                        }
                    }
                });
            }
        });
        let b = bank.into_inner().unwrap();
        let mut out = String::from("{\n  \"about\": \"Sudoku puzzles (81 characters, . = empty), made by generator.rs sudoku_make_bank. Each has exactly one solution and is graded by the logic it needs. Server only: never sent to the browser.\"");
        for k in ["easy", "medium", "hard", "expert", "daily"] {
            out.push_str(&format!(",\n  \"{k}\": [\n"));
            out.push_str(&b[k].iter().map(|p| format!("    \"{p}\"")).collect::<Vec<_>>().join(",\n"));
            out.push_str("\n  ]");
        }
        out.push_str("\n}\n");
        std::fs::create_dir_all(concat!(env!("CARGO_MANIFEST_DIR"), "/data")).unwrap();
        std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/data/sudoku_puzzles.json"), out).unwrap();
        eprintln!("done in {:?}", t.elapsed());
    }
}
