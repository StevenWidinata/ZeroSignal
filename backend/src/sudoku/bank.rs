//! The puzzle bank (`backend/data/sudoku_puzzles.json`, made by
//! `generator.rs`): a list per level plus the Daily list. Only the server
//! reads it; the browser gets one puzzle's givens at a time.

use std::sync::OnceLock;

use chrono::NaiveDate;
use serde::Deserialize;

use super::rules::{parse, Grid, Level};

const JSON: &str = include_str!("../../data/sudoku_puzzles.json");

#[derive(Deserialize)]
struct File {
    easy: Vec<String>,
    medium: Vec<String>,
    hard: Vec<String>,
    expert: Vec<String>,
    daily: Vec<String>,
}

pub struct Bank {
    levels: [Vec<Grid>; 4],
    daily: Vec<Grid>,
}

fn grids(list: &[String]) -> Vec<Grid> {
    list.iter().map(|s| parse(s).expect("a bad puzzle in sudoku_puzzles.json")).collect()
}

pub fn bank() -> &'static Bank {
    static B: OnceLock<Bank> = OnceLock::new();
    B.get_or_init(|| {
        let f: File = serde_json::from_str(JSON).expect("backend/data/sudoku_puzzles.json");
        Bank { levels: [grids(&f.easy), grids(&f.medium), grids(&f.hard), grids(&f.expert)], daily: grids(&f.daily) }
    })
}

/// The Daily list starts over after this day.
const FIRST_DAY: (i32, u32, u32) = (2026, 1, 1);

impl Bank {
    pub fn count(&self, level: Level) -> usize {
        self.levels[level as usize].len()
    }

    pub fn puzzle(&self, level: Level, index: usize) -> Option<Grid> {
        self.levels[level as usize].get(index).copied()
    }

    /// Today's Daily: its index in the Daily list and its givens.
    pub fn daily(&self, day: NaiveDate) -> (usize, Grid) {
        let first = NaiveDate::from_ymd_opt(FIRST_DAY.0, FIRST_DAY.1, FIRST_DAY.2).expect("a date");
        let n = self.daily.len() as i64;
        let i = (day - first).num_days().rem_euclid(n) as usize;
        (i, self.daily[i])
    }

    pub fn daily_puzzle(&self, index: usize) -> Option<Grid> {
        self.daily.get(index).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sudoku::generator::classify;
    use crate::sudoku::rules::code;
    use crate::sudoku::solver::count_solutions;
    use std::collections::HashSet;

    #[test]
    fn every_puzzle_has_one_solution_and_its_level() {
        let b = bank();
        let mut seen = HashSet::new();
        for level in Level::ALL {
            assert!(b.count(level) >= 200, "{level:?}: {}", b.count(level));
            for i in 0..b.count(level) {
                let g = b.puzzle(level, i).unwrap();
                assert_eq!(count_solutions(&g, 2), 1, "{level:?} {i}");
                assert_eq!(classify(&g), Some(level), "{level:?} {i}: {}", code(&g));
                assert!(seen.insert(g), "{level:?} {i} is a repeat");
            }
        }
        assert!(b.daily.len() >= 366);
        for (i, g) in b.daily.iter().enumerate() {
            assert_eq!(count_solutions(g, 2), 1, "daily {i}");
            assert_eq!(classify(g), Some(Level::Medium), "daily {i}");
            assert!(seen.insert(*g), "daily {i} is a repeat");
        }
    }

    #[test]
    fn hints_alone_finish_bank_puzzles_with_logic() {
        use crate::sudoku::rules::CELLS;
        use crate::sudoku::solver::{hint, solve};
        let b = bank();
        for level in Level::ALL {
            for i in 0..20 {
                let p = b.puzzle(level, i).unwrap();
                let s = solve(&p).unwrap();
                let mut g = p;
                while let Some(h) = hint(&g, &[false; CELLS], &s) {
                    assert_eq!(h.digit, s[h.cell], "{level:?} {i}");
                    assert!(h.tech.is_some(), "{level:?} {i}: graded puzzles never need a free reveal");
                    g[h.cell] = h.digit;
                }
                assert_eq!(g, s, "{level:?} {i}");
            }
        }
    }

    #[test]
    fn the_daily_changes_each_day_and_wraps() {
        let b = bank();
        let d = |y, m, day| NaiveDate::from_ymd_opt(y, m, day).unwrap();
        let (a, _) = b.daily(d(2026, 11, 22));
        let (n, _) = b.daily(d(2026, 11, 23));
        assert_eq!((a + 1) % b.daily.len(), n);
        assert_eq!(b.daily(d(2026, 1, 1)).0, 0);
        assert_eq!(b.daily(d(2025, 12, 31)).0, b.daily.len() - 1);
        assert_eq!(b.daily_puzzle(a), Some(b.daily(d(2026, 11, 22)).1));
    }
}
