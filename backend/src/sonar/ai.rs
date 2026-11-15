//! Zero-Bot for Sonar. It only sees what a player would see: misses, hits,
//! sunk ships, the water around them and its ping counts (never the fleet).
//!
//! - Easy: random shots; follows up a hit only half the time.
//! - Medium: hunt on a checkerboard, then target around hits.
//! - Hard: a probability map of every place each ship could still be.
//! - Master: the map plus sonar pings late in the hunt, on the busiest 3×3 area.

use rand::Rng;
use serde::{Deserialize, Serialize};

use super::rules::{neighbours, ping_area, rules, Mark, Move, Ping, Sea, CELLS, SIZE};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Easy,
    Medium,
    Hard,
    Master,
}

impl Level {
    pub const ALL: [Level; 4] = [Level::Easy, Level::Medium, Level::Hard, Level::Master];

    pub fn parse(s: &str) -> Option<Level> {
        Level::ALL.into_iter().find(|l| l.as_str() == s)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Level::Easy => "easy",
            Level::Medium => "medium",
            Level::Hard => "hard",
            Level::Master => "master",
        }
    }

    /// 1 (Easy) … 4 (Master): scales rewards like the other AI games.
    pub fn mult(self) -> i64 {
        match self {
            Level::Easy => 1,
            Level::Medium => 2,
            Level::Hard => 3,
            Level::Master => 4,
        }
    }
}

/// What the shooter knows about the other sea.
pub struct Knowledge {
    pub marks: [Mark; CELLS],
    pub pings: Vec<Ping>,
    pub pings_left: u8,
    /// Lengths of the ships not sunk yet.
    pub afloat: Vec<u8>,
}

impl Sea {
    /// Only the public part of this sea (what the other side has learned).
    pub fn knowledge(&self) -> Knowledge {
        let sunk = self.sunk_ships();
        Knowledge {
            marks: self.marks,
            pings: self.pings.clone(),
            pings_left: self.pings_left(),
            afloat: rules()
                .fleet
                .iter()
                .enumerate()
                .filter(|(i, _)| !sunk.contains(&(*i as u8)))
                .map(|(_, s)| s.len)
                .collect(),
        }
    }
}

impl Knowledge {
    fn unknown(&self) -> Vec<usize> {
        (0..CELLS).filter(|&c| self.marks[c] == Mark::Unknown).collect()
    }

    /// Hits on ships that aren't sunk yet.
    fn open_hits(&self) -> Vec<usize> {
        (0..CELLS).filter(|&c| self.marks[c] == Mark::Hit).collect()
    }

    /// Unknown cells a ping has shown to be water (count 0, or every ship
    /// square in its area already found).
    fn ping_water(&self) -> [bool; CELLS] {
        let mut w = [false; CELLS];
        for p in &self.pings {
            let area = ping_area(p.center);
            let found = area.iter().filter(|&&c| matches!(self.marks[c], Mark::Hit | Mark::Sunk(_))).count() as u8;
            if found >= p.count {
                for c in area {
                    if self.marks[c] == Mark::Unknown {
                        w[c] = true;
                    }
                }
            }
        }
        w
    }

    /// Cells next to an open hit, in line with other hits when there are some.
    fn targets(&self) -> Vec<usize> {
        let hits = self.open_hits();
        let water = self.ping_water();
        let ok = |c: usize| self.marks[c] == Mark::Unknown && !water[c];
        let mut out = Vec::new();
        // Two or more hits in a row: try the two ends of the line first.
        for &h in &hits {
            for (step, horizontal) in [(1usize, true), (SIZE, false)] {
                let next = h + step;
                let same_line = |a: usize, b: usize| if horizontal { a / SIZE == b / SIZE } else { true };
                if next < CELLS && same_line(h, next) && self.marks[next] == Mark::Hit {
                    // Walk to both ends of this run of hits.
                    let mut lo = h;
                    while lo >= step && same_line(lo, lo - step) && self.marks[lo - step] == Mark::Hit {
                        lo -= step;
                    }
                    let mut hi = next;
                    while hi + step < CELLS && same_line(hi, hi + step) && self.marks[hi + step] == Mark::Hit {
                        hi += step;
                    }
                    if lo >= step && same_line(lo, lo - step) && ok(lo - step) {
                        out.push(lo - step);
                    }
                    if hi + step < CELLS && same_line(hi, hi + step) && ok(hi + step) {
                        out.push(hi + step);
                    }
                }
            }
        }
        if !out.is_empty() {
            out.sort_unstable();
            out.dedup();
            return out;
        }
        for &h in &hits {
            for n in orthogonal(h) {
                if ok(n) {
                    out.push(n);
                }
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }

    /// How many ways the ships still afloat could cover each cell.
    pub fn density(&self) -> [f64; CELLS] {
        let mut d = [0.0; CELLS];
        let water = self.ping_water();
        let hits = self.open_hits();
        let targeting = !hits.is_empty();
        for &len in &self.afloat {
            let len = len as usize;
            for bow in 0..CELLS {
                for horizontal in [true, false] {
                    let (r, c) = (bow / SIZE, bow % SIZE);
                    if (horizontal && c + len > SIZE) || (!horizontal && r + len > SIZE) {
                        continue;
                    }
                    let cells: Vec<usize> = (0..len).map(|k| if horizontal { bow + k } else { bow + k * SIZE }).collect();
                    if cells.iter().any(|&x| !matches!(self.marks[x], Mark::Unknown | Mark::Hit) || water[x]) {
                        continue;
                    }
                    let covered = cells.iter().filter(|&&x| self.marks[x] == Mark::Hit).count();
                    if targeting && covered == 0 {
                        continue;
                    }
                    let w = if covered > 0 { 1.0 + 30.0 * covered as f64 } else { 1.0 };
                    for &x in &cells {
                        if self.marks[x] == Mark::Unknown {
                            d[x] += w;
                        }
                    }
                }
            }
        }
        // Pings that found ships make their unknown cells likelier.
        for p in &self.pings {
            let area = ping_area(p.center);
            let found = area.iter().filter(|&&c| matches!(self.marks[c], Mark::Hit | Mark::Sunk(_))).count() as f64;
            let unknown: Vec<usize> = area.into_iter().filter(|&c| self.marks[c] == Mark::Unknown && !water[c]).collect();
            let left = f64::from(p.count) - found;
            if left > 0.0 && !unknown.is_empty() {
                let boost = 1.0 + 3.0 * left / unknown.len() as f64;
                for c in unknown {
                    d[c] *= boost;
                }
            }
        }
        d
    }
}

fn orthogonal(cell: usize) -> impl Iterator<Item = usize> {
    neighbours(cell).filter(move |&n| n / SIZE == cell / SIZE || n % SIZE == cell % SIZE)
}

fn pick(v: &[usize], rng: &mut impl Rng) -> usize {
    v[rng.gen_range(0..v.len())]
}

/// The best cells by score (ties broken at random).
fn best(scores: &[f64; CELLS], allowed: &[usize], rng: &mut impl Rng) -> usize {
    let top = allowed.iter().map(|&c| scores[c]).fold(f64::MIN, f64::max);
    let ties: Vec<usize> = allowed.iter().copied().filter(|&c| scores[c] >= top - 1e-9).collect();
    pick(&ties, rng)
}

/// Zero-Bot's next move against the sea it knows `k` about.
pub fn choose(k: &Knowledge, level: Level, rng: &mut impl Rng) -> Move {
    let unknown = k.unknown();
    debug_assert!(!unknown.is_empty(), "the game would be over");
    let water = k.ping_water();
    let open: Vec<usize> = unknown.iter().copied().filter(|&c| !water[c]).collect();
    let open = if open.is_empty() { unknown.clone() } else { open };
    match level {
        Level::Easy => {
            let t = k.targets();
            if !t.is_empty() && rng.gen_bool(0.5) {
                Move::Fire(pick(&t, rng))
            } else {
                Move::Fire(pick(&unknown, rng))
            }
        }
        Level::Medium => {
            let t = k.targets();
            if !t.is_empty() {
                return Move::Fire(pick(&t, rng));
            }
            // Hunts on a checkerboard most of the time (every ship covers one of its squares).
            let parity: Vec<usize> = open.iter().copied().filter(|&c| (c / SIZE + c % SIZE) % 2 == 0).collect();
            Move::Fire(pick(if parity.is_empty() || rng.gen_bool(0.4) { &open } else { &parity }, rng))
        }
        Level::Hard | Level::Master => {
            let d = k.density();
            // Master pings late in the hunt, when only small ships are left and a
            // ping can rule out (or pin down) 9 squares at once.
            let smallest = k.afloat.iter().copied().min().unwrap_or(0);
            if level == Level::Master && k.pings_left > 0 && k.open_hits().is_empty() && k.afloat.len() <= 2 && smallest <= 3 && open.len() > 20 {
                let mut best_c = None;
                let mut best_v = 0.0;
                for c in 0..CELLS {
                    let area = ping_area(c);
                    if area.iter().filter(|&&x| k.marks[x] == Mark::Unknown && !water[x]).count() < 7 {
                        continue;
                    }
                    let v: f64 = area.iter().map(|&x| d[x]).sum();
                    if v > best_v {
                        best_v = v;
                        best_c = Some(c);
                    }
                }
                if let Some(c) = best_c {
                    return Move::Ping(c);
                }
            }
            Move::Fire(best(&d, &open, rng))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sonar::rules::{random_fleet, Fleet, ShotResult};
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    /// Moves Zero-Bot needs to sink a fleet (pings count).
    fn moves_to_win(fleet: &Fleet, level: Level, rng: &mut ChaCha8Rng) -> usize {
        let mut sea = Sea::new(fleet);
        let mut seen = std::collections::HashSet::new();
        while !sea.all_sunk() {
            let m = choose(&sea.knowledge(), level, rng);
            if let Move::Fire(c) = m {
                assert!(seen.insert(c), "{level:?} fired at {c} twice");
            }
            sea.play(m).unwrap_or_else(|e| panic!("{level:?} made a bad move {m:?}: {}", e.text()));
            assert!(sea.shots() <= CELLS + 2);
        }
        sea.shots()
    }

    #[test]
    fn harder_levels_need_fewer_shots() {
        let mut rng = ChaCha8Rng::seed_from_u64(11);
        let fleets: Vec<Fleet> = (0..40).map(|_| random_fleet(&mut rng)).collect();
        let avg = |level: Level, rng: &mut ChaCha8Rng| fleets.iter().map(|f| moves_to_win(f, level, rng)).sum::<usize>() as f64 / fleets.len() as f64;
        let easy = avg(Level::Easy, &mut rng);
        let medium = avg(Level::Medium, &mut rng);
        let hard = avg(Level::Hard, &mut rng);
        let master = avg(Level::Master, &mut rng);
        eprintln!("avg moves: easy {easy:.1}, medium {medium:.1}, hard {hard:.1}, master {master:.1}");
        assert!(easy > medium + 4.0, "easy {easy} medium {medium}");
        assert!(medium > hard + 4.0, "medium {medium} hard {hard}");
        assert!(master <= hard + 0.5, "master {master} hard {hard}");
    }

    #[test]
    fn it_finishes_a_hit_ship() {
        // A hit on the destroyer at a9 (cell 80): Medium and up shoot next to it.
        let f = Fleet::parse("a1h a3h a5h a7h a9h").unwrap();
        let mut sea = Sea::new(&f);
        assert_eq!(sea.play(Move::Fire(80)).unwrap(), ShotResult::Hit);
        let mut rng = ChaCha8Rng::seed_from_u64(3);
        for level in [Level::Medium, Level::Hard, Level::Master] {
            let Move::Fire(c) = choose(&sea.knowledge(), level, &mut rng) else { panic!("{level:?} pinged instead of finishing the ship") };
            assert!([70, 81, 90].contains(&c), "{level:?} shot {c}");
        }
    }

    #[test]
    fn zero_pings_rule_out_their_area() {
        let f = Fleet::parse("a1h a3h a5h a7h a9h").unwrap();
        let mut sea = Sea::new(&f);
        // j10 area (88, 89, 98, 99) is empty water.
        assert_eq!(sea.play(Move::Ping(99)).unwrap(), ShotResult::Ping { count: 0 });
        let k = sea.knowledge();
        let d = k.density();
        assert_eq!(d[99], 0.0);
        let mut rng = ChaCha8Rng::seed_from_u64(5);
        for _ in 0..50 {
            assert_ne!(choose(&k, Level::Hard, &mut rng), Move::Fire(99));
        }
    }
}
