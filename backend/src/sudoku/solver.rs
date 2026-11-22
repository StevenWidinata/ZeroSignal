//! Two solvers.
//!
//! - [`count_solutions`] / [`solve`]: an exact search (bitmasks, fewest
//!   options first) used to make sure a puzzle has exactly one solution.
//! - A human-style solver that only uses logic a person can follow, from
//!   simplest to hardest: naked single, hidden single, locked candidates,
//!   naked pair, hidden pair, naked triple, hidden triple, X-Wing. It grades
//!   puzzles (the hardest step needed) and gives hints with the reason.

use rand::seq::SliceRandom;
use rand::Rng;
use serde::Serialize;

use super::rules::{conflicts, peers, square_name, unit_name, units, Grid, CELLS};

const ALL: u16 = 0b11_1111_1110; // bits 1..=9

fn bit(d: u8) -> u16 {
    1 << d
}

fn digits(mask: u16) -> impl Iterator<Item = u8> {
    (1..=9u8).filter(move |&d| mask & bit(d) != 0)
}

// ---------------------------------------------------------------------------
// Exact search
// ---------------------------------------------------------------------------

struct Search {
    grid: Grid,
    rows: [u16; 9],
    cols: [u16; 9],
    boxes: [u16; 9],
}

impl Search {
    fn new(g: &Grid) -> Option<Search> {
        let mut s = Search { grid: *g, rows: [0; 9], cols: [0; 9], boxes: [0; 9] };
        for c in 0..CELLS {
            let v = g[c];
            if v == 0 {
                continue;
            }
            if v > 9 || s.options(c) & bit(v) == 0 {
                return None;
            }
            s.set(c, v);
        }
        Some(s)
    }

    fn options(&self, c: usize) -> u16 {
        let (r, k, b) = (c / 9, c % 9, (c / 27) * 3 + (c % 9) / 3);
        ALL & !(self.rows[r] | self.cols[k] | self.boxes[b])
    }

    fn set(&mut self, c: usize, v: u8) {
        let (r, k, b) = (c / 9, c % 9, (c / 27) * 3 + (c % 9) / 3);
        self.grid[c] = v;
        self.rows[r] |= bit(v);
        self.cols[k] |= bit(v);
        self.boxes[b] |= bit(v);
    }

    fn unset(&mut self, c: usize, v: u8) {
        let (r, k, b) = (c / 9, c % 9, (c / 27) * 3 + (c % 9) / 3);
        self.grid[c] = 0;
        self.rows[r] &= !bit(v);
        self.cols[k] &= !bit(v);
        self.boxes[b] &= !bit(v);
    }

    /// Counts solutions up to `limit`, keeping the first in `first`.
    fn run<R: Rng>(&mut self, limit: usize, count: &mut usize, first: &mut Option<Grid>, rng: &mut Option<&mut R>) {
        // The empty square with the fewest options.
        let mut best = None;
        let mut best_n = 10;
        for c in 0..CELLS {
            if self.grid[c] == 0 {
                let n = self.options(c).count_ones();
                if n < best_n {
                    best_n = n;
                    best = Some(c);
                    if n <= 1 {
                        break;
                    }
                }
            }
        }
        let Some(c) = best else {
            *count += 1;
            if first.is_none() {
                *first = Some(self.grid);
            }
            return;
        };
        let mut order: Vec<u8> = digits(self.options(c)).collect();
        if let Some(r) = rng.as_deref_mut() {
            order.shuffle(r);
        }
        for v in order {
            self.set(c, v);
            self.run(limit, count, first, rng);
            self.unset(c, v);
            if *count >= limit {
                return;
            }
        }
    }
}

/// How many solutions `g` has, counting no further than `limit`.
pub fn count_solutions(g: &Grid, limit: usize) -> usize {
    let Some(mut s) = Search::new(g) else { return 0 };
    let mut count = 0;
    s.run::<rand::rngs::ThreadRng>(limit, &mut count, &mut None, &mut None);
    count
}

/// The solution, if there is exactly one.
pub fn solve(g: &Grid) -> Option<Grid> {
    let mut s = Search::new(g)?;
    let (mut count, mut first) = (0, None);
    s.run::<rand::rngs::ThreadRng>(2, &mut count, &mut first, &mut None);
    if count == 1 {
        first
    } else {
        None
    }
}

/// A random completely filled grid.
pub fn random_full<R: Rng>(rng: &mut R) -> Grid {
    let mut s = Search::new(&[0; CELLS]).expect("an empty grid");
    let (mut count, mut first) = (0, None);
    s.run(1, &mut count, &mut first, &mut Some(rng));
    first.expect("an empty grid has solutions")
}

// ---------------------------------------------------------------------------
// Human-style solver
// ---------------------------------------------------------------------------

/// The logic steps, simplest first (the order matters for grading).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Technique {
    NakedSingle,
    HiddenSingle,
    LockedCandidates,
    NakedPair,
    HiddenPair,
    NakedTriple,
    HiddenTriple,
    XWing,
}

impl Technique {
    pub fn name(self) -> &'static str {
        match self {
            Technique::NakedSingle => "naked single",
            Technique::HiddenSingle => "hidden single",
            Technique::LockedCandidates => "locked candidates",
            Technique::NakedPair => "naked pair",
            Technique::HiddenPair => "hidden pair",
            Technique::NakedTriple => "naked triple",
            Technique::HiddenTriple => "hidden triple",
            Technique::XWing => "X-Wing",
        }
    }
}

/// A grid plus the numbers each empty square could still hold.
#[derive(Debug, Clone)]
pub struct Cands {
    pub grid: Grid,
    pub cand: [u16; CELLS],
}

impl Cands {
    /// None if two numbers already clash.
    pub fn new(g: &Grid) -> Option<Cands> {
        if !conflicts(g).is_empty() {
            return None;
        }
        let mut cand = [0u16; CELLS];
        for c in 0..CELLS {
            if g[c] == 0 {
                let used = peers()[c].iter().fold(0u16, |m, &p| m | if g[p] != 0 { bit(g[p]) } else { 0 });
                cand[c] = ALL & !used;
            }
        }
        Some(Cands { grid: *g, cand })
    }

    pub fn place(&mut self, c: usize, d: u8) {
        self.grid[c] = d;
        self.cand[c] = 0;
        for &p in &peers()[c] {
            self.cand[p] &= !bit(d);
        }
    }

    pub fn solved(&self) -> bool {
        self.grid.iter().all(|&v| v != 0)
    }
}

/// One logic step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// A number goes in a square (`unit`: where a hidden single was found).
    Place { cell: usize, digit: u8, tech: Technique, unit: Option<usize> },
    /// Candidates ruled out: (square, numbers removed).
    Eliminate { tech: Technique, removed: Vec<(usize, u16)> },
}

impl Step {
    pub fn tech(&self) -> Technique {
        match self {
            Step::Place { tech, .. } | Step::Eliminate { tech, .. } => *tech,
        }
    }
}

pub fn apply(c: &mut Cands, s: &Step) {
    match s {
        Step::Place { cell, digit, .. } => c.place(*cell, *digit),
        Step::Eliminate { removed, .. } => {
            for &(cell, m) in removed {
                c.cand[cell] &= !m;
            }
        }
    }
}

/// The first naked single, else the first hidden single, on a square `skip` allows.
pub fn first_single(c: &Cands, skip: &dyn Fn(usize) -> bool) -> Option<Step> {
    for cell in 0..CELLS {
        if c.grid[cell] == 0 && c.cand[cell].count_ones() == 1 && !skip(cell) {
            let digit = c.cand[cell].trailing_zeros() as u8;
            return Some(Step::Place { cell, digit, tech: Technique::NakedSingle, unit: None });
        }
    }
    for (u, unit) in units().iter().enumerate() {
        for d in 1..=9u8 {
            if unit.iter().any(|&x| c.grid[x] == d) {
                continue;
            }
            let mut spots = unit.iter().filter(|&&x| c.grid[x] == 0 && c.cand[x] & bit(d) != 0);
            if let (Some(&cell), None) = (spots.next(), spots.next()) {
                if !skip(cell) {
                    return Some(Step::Place { cell, digit: d, tech: Technique::HiddenSingle, unit: Some(u) });
                }
            }
        }
    }
    None
}

/// The simplest step that only rules out candidates.
pub fn elimination(c: &Cands) -> Option<Step> {
    locked(c)
        .or_else(|| naked(c, 2, Technique::NakedPair))
        .or_else(|| hidden(c, 2, Technique::HiddenPair))
        .or_else(|| naked(c, 3, Technique::NakedTriple))
        .or_else(|| hidden(c, 3, Technique::HiddenTriple))
        .or_else(|| x_wing(c))
}

pub fn next_step(c: &Cands) -> Option<Step> {
    first_single(c, &|_| false).or_else(|| elimination(c))
}

/// Remove `mask` from the listed squares; a step only if something changed.
fn eliminate(c: &Cands, tech: Technique, cells: impl Iterator<Item = usize>, mask: impl Fn(usize) -> u16) -> Option<Step> {
    let removed: Vec<(usize, u16)> = cells
        .filter_map(|x| {
            let m = c.cand[x] & mask(x);
            (c.grid[x] == 0 && m != 0).then_some((x, m))
        })
        .collect();
    (!removed.is_empty()).then_some(Step::Eliminate { tech, removed })
}

fn spots(c: &Cands, unit: &[usize; 9], d: u8) -> Vec<usize> {
    unit.iter().copied().filter(|&x| c.grid[x] == 0 && c.cand[x] & bit(d) != 0).collect()
}

/// Pointing (a box's options for a number lie in one row/column) and
/// claiming (a row/column's options lie in one box).
fn locked(c: &Cands) -> Option<Step> {
    let u = units();
    for d in 1..=9u8 {
        for b in 18..27 {
            let s = spots(c, &u[b], d);
            if s.len() < 2 {
                continue;
            }
            for line in [s[0] / 9, 9 + s[0] % 9] {
                if s.iter().all(|&x| u[line].contains(&x)) {
                    let step = eliminate(c, Technique::LockedCandidates, u[line].iter().copied().filter(|x| !u[b].contains(x)), |_| bit(d));
                    if step.is_some() {
                        return step;
                    }
                }
            }
        }
        for line in 0..18 {
            let s = spots(c, &u[line], d);
            if s.len() < 2 {
                continue;
            }
            let b = 18 + (s[0] / 27) * 3 + (s[0] % 9) / 3;
            if s.iter().all(|&x| u[b].contains(&x)) {
                let step = eliminate(c, Technique::LockedCandidates, u[b].iter().copied().filter(|x| !u[line].contains(x)), |_| bit(d));
                if step.is_some() {
                    return step;
                }
            }
        }
    }
    None
}

/// All `k`-element combinations of `items`.
fn combos(items: &[usize], k: usize) -> Vec<Vec<usize>> {
    fn go(items: &[usize], k: usize, start: usize, cur: &mut Vec<usize>, out: &mut Vec<Vec<usize>>) {
        if cur.len() == k {
            out.push(cur.clone());
            return;
        }
        for i in start..items.len() {
            cur.push(items[i]);
            go(items, k, i + 1, cur, out);
            cur.pop();
        }
    }
    let mut out = Vec::new();
    go(items, k, 0, &mut Vec::new(), &mut out);
    out
}

/// `k` squares in a unit that together hold only `k` numbers: those numbers
/// leave the unit's other squares.
fn naked(c: &Cands, k: usize, tech: Technique) -> Option<Step> {
    for unit in units() {
        let small: Vec<usize> = unit.iter().copied().filter(|&x| c.grid[x] == 0 && (2..=k as u32).contains(&c.cand[x].count_ones())).collect();
        for set in combos(&small, k) {
            let mask = set.iter().fold(0u16, |m, &x| m | c.cand[x]);
            if mask.count_ones() as usize == k {
                let step = eliminate(c, tech, unit.iter().copied().filter(|x| !set.contains(x)), |_| mask);
                if step.is_some() {
                    return step;
                }
            }
        }
    }
    None
}

/// `k` numbers that, in a unit, fit only in the same `k` squares: those
/// squares can't hold anything else.
fn hidden(c: &Cands, k: usize, tech: Technique) -> Option<Step> {
    for unit in units() {
        let open: Vec<usize> = (1..=9usize).filter(|&d| !unit.iter().any(|&x| c.grid[x] == d as u8)).collect();
        for set in combos(&open, k) {
            let mut cells: Vec<usize> = Vec::new();
            let mut ok = true;
            for &d in &set {
                let s = spots(c, unit, d as u8);
                if s.is_empty() {
                    ok = false;
                    break;
                }
                for x in s {
                    if !cells.contains(&x) {
                        cells.push(x);
                    }
                }
            }
            if ok && cells.len() == k {
                let keep = set.iter().fold(0u16, |m, &d| m | bit(d as u8));
                let step = eliminate(c, tech, cells.iter().copied(), |_| !keep);
                if step.is_some() {
                    return step;
                }
            }
        }
    }
    None
}

/// A number that fits in exactly the same two columns of two rows (or the
/// same two rows of two columns) leaves the rest of those columns (rows).
fn x_wing(c: &Cands) -> Option<Step> {
    let u = units();
    for d in 1..=9u8 {
        for (base, cross) in [(0usize, 9usize), (9, 0)] {
            let lines: Vec<(usize, Vec<usize>)> = (0..9)
                .filter_map(|i| {
                    let s = spots(c, &u[base + i], d);
                    (s.len() == 2).then(|| (i, s.iter().map(|&x| if base == 0 { x % 9 } else { x / 9 }).collect()))
                })
                .collect();
            for a in 0..lines.len() {
                for b in a + 1..lines.len() {
                    if lines[a].1 == lines[b].1 {
                        let (la, lb) = (base + lines[a].0, base + lines[b].0);
                        let targets = lines[a].1.iter().flat_map(|&k| u[cross + k].iter().copied()).filter(|x| !u[la].contains(x) && !u[lb].contains(x));
                        let step = eliminate(c, Technique::XWing, targets, |_| bit(d));
                        if step.is_some() {
                            return step;
                        }
                    }
                }
            }
        }
    }
    None
}

/// The hardest step needed to solve `g` with the steps above, or None if
/// they aren't enough (or the grid is broken).
pub fn grade(g: &Grid) -> Option<Technique> {
    let mut c = Cands::new(g)?;
    let mut hardest = Technique::NakedSingle;
    while !c.solved() {
        let s = next_step(&c)?;
        hardest = hardest.max(s.tech());
        apply(&mut c, &s);
    }
    Some(hardest)
}

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Hint {
    pub cell: usize,
    pub digit: u8,
    /// None when no logic step was found and the square is simply shown.
    pub tech: Option<Technique>,
    pub reason: String,
}

/// The next square a person could work out. `view` is the givens plus the
/// player's correct numbers; `avoid` marks squares to leave alone (where
/// the player put a wrong number, so a hint never gives that away).
/// None when every open square is in `avoid`.
pub fn hint(view: &Grid, avoid: &[bool; CELLS], solution: &Grid) -> Option<Hint> {
    let mut c = Cands::new(view)?;
    let mut used: Vec<Technique> = Vec::new();
    loop {
        if let Some(Step::Place { cell, digit, tech, unit }) = first_single(&c, &|x| avoid[x]) {
            let mut reason = match unit {
                None => format!("{}: {digit} is the only number that fits. Every other number is already in its row, column or box.", capital(&square_name(cell))),
                Some(u) => format!("{} needs a {digit}, and {} is the only square in it where a {digit} can go.", capital(&unit_name(u)), square_name(cell)),
            };
            if !used.is_empty() {
                let names: Vec<&str> = used.iter().map(|t| t.name()).collect();
                reason.push_str(&format!(" (First, a {} rules out some numbers.)", names.join(" and a ")));
            }
            let tech = used.iter().copied().fold(tech, Technique::max);
            debug_assert_eq!(solution[cell], digit);
            return Some(Hint { cell, digit, tech: Some(tech), reason });
        }
        match elimination(&c) {
            Some(s) => {
                if !used.contains(&s.tech()) {
                    used.push(s.tech());
                }
                apply(&mut c, &s);
            }
            None => break,
        }
    }
    // No logic step left: show the open square with the fewest options.
    let cell = (0..CELLS).filter(|&x| c.grid[x] == 0 && !avoid[x]).min_by_key(|&x| c.cand[x].count_ones())?;
    let digit = solution[cell];
    Some(Hint { cell, digit, tech: None, reason: format!("{} is {digit}. There's no simple next step from here, so this one is a free reveal.", capital(&square_name(cell))) })
}

fn capital(s: &str) -> String {
    let mut ch = s.chars();
    ch.next().map(|f| f.to_uppercase().collect::<String>() + ch.as_str()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sudoku::rules::{code, parse};
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    // A well-known puzzle and its solution.
    const P: &str = "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";
    const S: &str = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

    #[test]
    fn exact_search_counts_and_solves() {
        let p = parse(P).unwrap();
        assert_eq!(count_solutions(&p, 10), 1);
        assert_eq!(code(&solve(&p).unwrap()), S);
        assert_eq!(count_solutions(&[0; CELLS], 2), 2);
        let mut bad = p;
        bad[2] = 5; // a second 5 in row 1
        assert_eq!(count_solutions(&bad, 2), 0);
        assert_eq!(solve(&[0; CELLS]), None, "many solutions is not one");
    }

    #[test]
    fn random_full_grids_are_valid() {
        let mut rng = ChaCha8Rng::seed_from_u64(1);
        let a = random_full(&mut rng);
        let b = random_full(&mut rng);
        assert_ne!(a, b);
        for g in [a, b] {
            assert!(g.iter().all(|&v| (1..=9).contains(&v)));
            assert!(conflicts(&g).is_empty());
        }
    }

    #[test]
    fn logic_solver_matches_the_exact_one() {
        let p = parse(P).unwrap();
        let mut c = Cands::new(&p).unwrap();
        while !c.solved() {
            let s = next_step(&c).expect("this puzzle needs only simple steps");
            apply(&mut c, &s);
        }
        assert_eq!(code(&c.grid), S);
        assert!(grade(&p).unwrap() <= Technique::HiddenSingle);
        // One hole is always a naked single.
        let mut one = parse(S).unwrap();
        one[40] = 0;
        assert_eq!(grade(&one), Some(Technique::NakedSingle));
    }

    #[test]
    fn hints_explain_and_never_touch_avoided_squares() {
        let p = parse(P).unwrap();
        let s = parse(S).unwrap();
        let h = hint(&p, &[false; CELLS], &s).unwrap();
        assert_eq!(h.digit, s[h.cell]);
        assert!(p[h.cell] == 0 && !h.reason.is_empty());
        // Avoid that square: the hint goes elsewhere.
        let mut avoid = [false; CELLS];
        avoid[h.cell] = true;
        let h2 = hint(&p, &avoid, &s).unwrap();
        assert_ne!(h2.cell, h.cell);
        assert_eq!(h2.digit, s[h2.cell]);
        // Hints alone solve the puzzle.
        let mut g = p;
        for _ in 0..81 {
            let Some(h) = hint(&g, &[false; CELLS], &s) else { break };
            g[h.cell] = h.digit;
        }
        assert_eq!(g, s);
        // Every open square avoided: no hint.
        let all: [bool; CELLS] = std::array::from_fn(|i| p[i] == 0);
        assert_eq!(hint(&p, &all, &s), None);
    }

    #[test]
    fn each_technique_does_its_job() {
        // Naked pair: two squares of row 1 that can only be {1,2}.
        let mut c = Cands { grid: [0; CELLS], cand: [ALL; CELLS] };
        c.cand[0] = bit(1) | bit(2);
        c.cand[1] = bit(1) | bit(2);
        let s = naked(&c, 2, Technique::NakedPair).unwrap();
        let Step::Eliminate { removed, .. } = &s else { panic!() };
        assert!(removed.iter().all(|&(x, m)| x != 0 && x != 1 && m == bit(1) | bit(2)));
        assert!(removed.iter().any(|&(x, _)| x == 8));
        // Hidden pair: 1 and 2 fit only in squares 0 and 1 of row 1.
        let mut c = Cands { grid: [0; CELLS], cand: [ALL; CELLS] };
        for x in 2..9 {
            c.cand[x] &= !(bit(1) | bit(2));
        }
        let s = hidden(&c, 2, Technique::HiddenPair).unwrap();
        let Step::Eliminate { removed, .. } = &s else { panic!() };
        assert_eq!(removed, &vec![(0, ALL & !(bit(1) | bit(2))), (1, ALL & !(bit(1) | bit(2)))]);
        // X-Wing on 5: rows 1 and 5 hold it only in columns 1 and 4.
        let mut c = Cands { grid: [0; CELLS], cand: [ALL; CELLS] };
        for r in [0usize, 4] {
            for k in 0..9 {
                if k != 0 && k != 3 {
                    c.cand[r * 9 + k] &= !bit(5);
                }
            }
        }
        let s = x_wing(&c).unwrap();
        let Step::Eliminate { tech, removed } = &s else { panic!() };
        assert_eq!(*tech, Technique::XWing);
        assert!(removed.iter().all(|&(x, m)| m == bit(5) && (x % 9 == 0 || x % 9 == 3) && x / 9 != 0 && x / 9 != 4));
        assert_eq!(removed.len(), 14);
    }
}
