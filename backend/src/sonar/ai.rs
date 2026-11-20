//! Zero-Bot for Sonar. It only sees what a player would see: misses, hits,
//! sunk ships, the water around them and its ping counts (never the fleet).
//!
//! - Easy: random shots; follows up a hit only half the time.
//! - Medium: hunt on a checkerboard, then target around hits.
//! - Hard: a probability map of every place each ship could still be.
//! - Master: the map plus sonar pings late in the hunt, on the busiest 3×3 area.
//!
//! In Tactics games (`choose_tactics`) it also uses its ship powers and
//! Overdrive, fires at squares it has spotted and knows pings and radar
//! can't hear a silent submarine:
//! - Easy: now and then a power on a random spot.
//! - Medium: every power as soon as it's ready, with simple aim.
//! - Hard: every power aimed with the probability map.
//! - Master: Hard, plus mines near the middle, opening crates it has seen,
//!   and no radar (a shot is worth more).

use rand::Rng;
use serde::{Deserialize, Serialize};

use super::rules::{
    flare_area, line_cells, neighbours, ping_area, rules, ship_cells, torpedo_path, Duel, Edge, Fleet, Mark, Move, Ping, Placement, Sea, Sweep, CELLS, SIZE,
};
use super::tactics::{AIR_STRIKE, FLARE, POWERS, RADAR, SALVO, TORPEDO};

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
    /// Fleet indices of the ships not sunk yet (same order as `afloat`).
    pub afloat_ids: Vec<usize>,
    /// Tactics: radar sweeps so far.
    pub sweeps: Vec<Sweep>,
    /// Tactics: the afloat ship that pings and radar can't hear (the sub).
    pub silent: Option<usize>,
}

impl Sea {
    /// Only the public part of this sea (what the other side has learned).
    pub fn knowledge(&self) -> Knowledge {
        let sunk = self.sunk_ships();
        let afloat_ids: Vec<usize> = (0..rules().fleet.len()).filter(|i| !sunk.contains(&(*i as u8))).collect();
        Knowledge {
            marks: self.marks,
            pings: self.pings.clone(),
            pings_left: self.pings_left(),
            afloat: afloat_ids.iter().map(|&i| rules().fleet[i].len).collect(),
            afloat_ids,
            sweeps: self.sweeps.clone(),
            silent: self.silent_afloat().map(usize::from),
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

    /// Squares known to hold a ship (hit, sunk or spotted).
    fn found(&self, c: usize) -> bool {
        matches!(self.marks[c], Mark::Hit | Mark::Sunk(_) | Mark::Spotted)
    }

    /// Every ping and radar sweep as (squares, count).
    fn soundings(&self) -> Vec<(Vec<usize>, u8)> {
        self.pings
            .iter()
            .map(|p| (ping_area(p.center), p.count))
            .chain(self.sweeps.iter().map(|s| (line_cells(usize::from(s.line), s.row), s.count)))
            .collect()
    }

    /// Unknown cells a ping or sweep has shown to be water (count 0, or every
    /// ship square in its area already found). While a silent ship is afloat
    /// its squares aren't counted, so then only a count of 0 says anything
    /// (and not about the silent ship itself: see `density`).
    fn ping_water(&self) -> [bool; CELLS] {
        let mut w = [false; CELLS];
        for (area, count) in self.soundings() {
            let found = area.iter().filter(|&&c| self.found(c)).count() as u8;
            if count == 0 || (self.silent.is_none() && found >= count) {
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

    /// How many ways the ships still afloat could cover each cell. Spotted
    /// squares count like hits (a ship is there); a silent ship ignores what
    /// pings and radar said.
    pub fn density(&self) -> [f64; CELLS] {
        let mut d = [0.0; CELLS];
        let water = self.ping_water();
        let no_water = [false; CELLS];
        let targeting = (0..CELLS).any(|c| matches!(self.marks[c], Mark::Hit | Mark::Spotted));
        for (&len, &id) in self.afloat.iter().zip(&self.afloat_ids) {
            let len = len as usize;
            let water = if self.silent == Some(id) { &no_water } else { &water };
            for bow in 0..CELLS {
                for horizontal in [true, false] {
                    let (r, c) = (bow / SIZE, bow % SIZE);
                    if (horizontal && c + len > SIZE) || (!horizontal && r + len > SIZE) {
                        continue;
                    }
                    let cells: Vec<usize> = (0..len).map(|k| if horizontal { bow + k } else { bow + k * SIZE }).collect();
                    if cells.iter().any(|&x| !matches!(self.marks[x], Mark::Unknown | Mark::Hit | Mark::Spotted) || water[x]) {
                        continue;
                    }
                    let covered = cells.iter().filter(|&&x| matches!(self.marks[x], Mark::Hit | Mark::Spotted)).count();
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
        // Pings and sweeps that found ships make their unknown cells likelier.
        for (area, count) in self.soundings() {
            let found = area.iter().filter(|&&c| self.found(c)).count() as f64;
            let unknown: Vec<usize> = area.into_iter().filter(|&c| self.marks[c] == Mark::Unknown && !water[c]).collect();
            let left = f64::from(count) - found;
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

/// What Zero-Bot can use in a Tactics game, read from its own side of the duel.
#[derive(Debug, Clone)]
pub struct Arsenal {
    /// Powers it may use this turn (charged, and its ship is afloat).
    pub ready: [bool; POWERS],
    /// Powers Overdrive could charge (afloat, not charged yet).
    pub chargeable: [bool; POWERS],
    /// Each power's size at its Mk level.
    pub size: [u8; POWERS],
    pub overdrive: bool,
}

impl Arsenal {
    /// `side`'s arsenal, or None in a Classic duel.
    pub fn of(d: &Duel, side: usize) -> Option<Arsenal> {
        let t = d.tactics.as_ref()?;
        let mut a = Arsenal { ready: [false; POWERS], chargeable: [false; POWERS], size: [0; POWERS], overdrive: t.overdrive[side] };
        for p in 0..POWERS {
            let afloat = !d.seas[side].is_sunk(p);
            a.ready[p] = afloat && t.ready(side, p);
            a.chargeable[p] = afloat && !t.ready(side, p);
            a.size[p] = t.spec(side, p).size;
        }
        Some(a)
    }
}

/// Which power Overdrive charges first.
const OVERDRIVE_ORDER: [usize; POWERS] = [AIR_STRIKE, SALVO, TORPEDO, FLARE, RADAR];

/// Zero-Bot's next move in a Tactics duel. `d` is used only for what Zero-Bot
/// may know: its own powers (`Arsenal`) and what it has learned about the
/// other side's sea (`Knowledge`), never the hidden fleet.
pub fn choose_for(d: &Duel, side: usize, level: Level, rng: &mut impl Rng) -> Move {
    let k = d.seas[1 - side].knowledge();
    match Arsenal::of(d, side) {
        Some(a) => choose_tactics(&k, &a, level, rng),
        None => choose(&k, level, rng),
    }
}

/// Zero-Bot's next Tactics move from what it knows and what it can use.
pub fn choose_tactics(k: &Knowledge, a: &Arsenal, level: Level, rng: &mut impl Rng) -> Move {
    let fireable: Vec<usize> = (0..CELLS).filter(|&c| k.marks[c].open()).collect();
    debug_assert!(!fireable.is_empty(), "the game would be over");
    // Overdrive first: it's free and keeps the turn.
    if a.overdrive && (level != Level::Easy || rng.gen_bool(0.5)) {
        if let Some(&p) = OVERDRIVE_ORDER.iter().find(|&&p| a.chargeable[p]) {
            return Move::Overdrive(p);
        }
    }
    match level {
        Level::Easy => easy_tactics(k, a, &fireable, rng),
        Level::Medium => medium_tactics(k, a, &fireable, rng),
        Level::Hard | Level::Master => smart_tactics(k, a, &fireable, level, rng),
    }
}

fn spotted(k: &Knowledge) -> Vec<usize> {
    (0..CELLS).filter(|&c| k.marks[c] == Mark::Spotted).collect()
}

/// A legal air strike of `size` squares starting at `cell`, if it hits anything open.
fn strike_cells(k: &Knowledge, cell: usize, horizontal: bool, size: u8) -> Option<Vec<usize>> {
    let cells = ship_cells(Placement { bow: cell, horizontal }, usize::from(size))?;
    cells.iter().any(|&c| k.marks[c].open()).then_some(cells)
}

/// Torpedo edges Zero-Bot may use (Mk III adds right and bottom).
fn edges(size: u8) -> &'static [Edge] {
    if size >= 4 {
        &[Edge::Left, Edge::Right, Edge::Top, Edge::Bottom]
    } else {
        &[Edge::Left, Edge::Top]
    }
}

/// `n` different squares from `pool` (best first if it is sorted that way).
fn salvo_of(pool: &[usize], n: u8) -> Option<Move> {
    let n = usize::from(n);
    if pool.len() < n {
        return None;
    }
    let mut cells = [0; 3];
    cells[..n].copy_from_slice(&pool[..n]);
    Some(Move::Salvo { cells, n: n as u8 })
}

fn shuffled(v: &[usize], rng: &mut impl Rng) -> Vec<usize> {
    let mut v = v.to_vec();
    for i in (1..v.len()).rev() {
        v.swap(i, rng.gen_range(0..=i));
    }
    v
}

/// Any legal use of power `p`, aimed at random.
fn random_power(k: &Knowledge, a: &Arsenal, p: usize, fireable: &[usize], rng: &mut impl Rng) -> Option<Move> {
    let unknown = k.unknown();
    match p {
        AIR_STRIKE => {
            for _ in 0..50 {
                let (cell, horizontal) = (pick(fireable, rng), rng.gen_bool(0.5));
                if strike_cells(k, cell, horizontal, a.size[p]).is_some() {
                    return Some(Move::AirStrike { cell, horizontal });
                }
            }
            None
        }
        SALVO => salvo_of(&shuffled(fireable, rng), a.size[p]),
        RADAR => Some(Move::Radar { line: rng.gen_range(0..SIZE), row: rng.gen_bool(0.5) }),
        TORPEDO => {
            let e = edges(a.size[p]);
            Some(Move::Torpedo { line: rng.gen_range(0..SIZE), edge: e[rng.gen_range(0..e.len())] })
        }
        _ => (!unknown.is_empty()).then(|| Move::Flare(pick(&unknown, rng))),
    }
}

/// Easy: sometimes uses a power on a random spot, otherwise shoots like Easy.
fn easy_tactics(k: &Knowledge, a: &Arsenal, fireable: &[usize], rng: &mut impl Rng) -> Move {
    let ready: Vec<usize> = (0..POWERS).filter(|&p| a.ready[p]).collect();
    if !ready.is_empty() && rng.gen_bool(0.3) {
        if let Some(m) = random_power(k, a, pick(&ready, rng), fireable, rng) {
            return m;
        }
    }
    let s = spotted(k);
    if !s.is_empty() && rng.gen_bool(0.5) {
        return Move::Fire(pick(&s, rng));
    }
    let t = k.targets();
    if !t.is_empty() && rng.gen_bool(0.5) {
        Move::Fire(pick(&t, rng))
    } else {
        Move::Fire(pick(fireable, rng))
    }
}

/// Medium: uses each power as soon as it's ready, with simple aim.
fn medium_tactics(k: &Knowledge, a: &Arsenal, fireable: &[usize], rng: &mut impl Rng) -> Move {
    let s = spotted(k);
    let t = k.targets();
    let unknown = k.unknown();
    let parity: Vec<usize> = unknown.iter().copied().filter(|&c| (c / SIZE + c % SIZE) % 2 == 0).collect();
    // Squares worth a shot, best first: spotted, next to hits, then the hunt.
    let mut pool: Vec<usize> = shuffled(&s, rng);
    for c in shuffled(&t, rng).into_iter().chain(shuffled(&parity, rng)).chain(shuffled(fireable, rng)) {
        if !pool.contains(&c) {
            pool.push(c);
        }
    }
    if a.ready[SALVO] {
        if let Some(m) = salvo_of(&pool, a.size[SALVO]) {
            return m;
        }
    }
    if !s.is_empty() {
        return Move::Fire(s[0]);
    }
    if a.ready[AIR_STRIKE] {
        // Over the first target if there is one, else anywhere new.
        let at = t.first().copied().unwrap_or_else(|| pick(fireable, rng));
        for (cell, horizontal) in [(at, true), (at, false), (at.saturating_sub(1), true), (at.saturating_sub(SIZE), false)] {
            if strike_cells(k, cell, horizontal, a.size[AIR_STRIKE]).is_some() {
                return Move::AirStrike { cell, horizontal };
            }
        }
    }
    if t.is_empty() {
        if a.ready[TORPEDO] {
            let lines: Vec<(usize, bool)> = (0..SIZE).flat_map(|l| [(l, true), (l, false)]).filter(|&(l, row)| line_cells(l, row).iter().any(|&c| k.marks[c] == Mark::Unknown)).collect();
            if !lines.is_empty() {
                let (line, row) = lines[rng.gen_range(0..lines.len())];
                return Move::Torpedo { line, edge: if row { Edge::Left } else { Edge::Top } };
            }
        }
        if a.ready[FLARE] {
            let good: Vec<usize> = (0..CELLS).filter(|&c| flare_area(c, a.size[FLARE]).iter().filter(|&&x| k.marks[x] == Mark::Unknown).count() >= 4).collect();
            if !good.is_empty() {
                return Move::Flare(pick(&good, rng));
            }
        }
        if a.ready[RADAR] {
            return Move::Radar { line: rng.gen_range(0..SIZE), row: rng.gen_bool(0.5) };
        }
    }
    Move::Fire(pool[0])
}

/// Hard and Master: every power aimed with the probability map.
fn smart_tactics(k: &Knowledge, a: &Arsenal, fireable: &[usize], level: Level, rng: &mut impl Rng) -> Move {
    let d = k.density();
    let s = spotted(k);
    let targeting = (0..CELLS).any(|c| matches!(k.marks[c], Mark::Hit | Mark::Spotted));
    let top_d = (0..CELLS).filter(|&c| k.marks[c] == Mark::Unknown).map(|c| d[c]).fold(0.0, f64::max);
    // How good a shot at each square is.
    let mut score = [f64::MIN; CELLS];
    for &c in fireable {
        score[c] = match k.marks[c] {
            Mark::Spotted => 1e9,
            // Master opens crates it has seen when it isn't chasing a ship.
            Mark::CrateSeen if level == Level::Master && !targeting => top_d * 0.8 + 1.0,
            Mark::CrateSeen => 0.0,
            _ => d[c],
        };
    }
    let mut by_score = shuffled(fireable, rng);
    by_score.sort_by(|&x, &y| score[y].total_cmp(&score[x]));
    let best_shot = score[by_score[0]];
    if a.ready[SALVO] {
        if let Some(m) = salvo_of(&by_score, a.size[SALVO]) {
            return m;
        }
    }
    if !s.is_empty() {
        return Move::Fire(by_score[0]);
    }
    // Air strike: the line of squares with the most chances.
    if a.ready[AIR_STRIKE] {
        let mut best: Option<(f64, Move)> = None;
        for cell in 0..CELLS {
            for horizontal in [true, false] {
                if let Some(cells) = strike_cells(k, cell, horizontal, a.size[AIR_STRIKE]) {
                    let v: f64 = cells.iter().filter(|&&c| k.marks[c].open()).map(|&c| score[c].max(0.0)).sum();
                    if best.as_ref().map_or(true, |(b, _)| v > *b) {
                        best = Some((v, Move::AirStrike { cell, horizontal }));
                    }
                }
            }
        }
        if let Some((v, m)) = best {
            if v >= 1.5 * best_shot.max(1e-9) {
                return m;
            }
        }
    }
    if !targeting {
        // Torpedo: the line most likely to hold a ship (it hits the first one).
        if a.ready[TORPEDO] {
            let mut best: Option<(f64, Move)> = None;
            for line in 0..SIZE {
                for &edge in edges(a.size[TORPEDO]) {
                    let path = torpedo_path(line, edge);
                    let v: f64 = path.iter().filter(|&&c| k.marks[c] == Mark::Unknown).map(|&c| d[c]).sum();
                    if best.as_ref().map_or(true, |(b, _)| v > *b) {
                        best = Some((v, Move::Torpedo { line, edge }));
                    }
                }
            }
            if let Some((v, m)) = best {
                if v >= 3.0 * best_shot.max(1e-9) {
                    return m;
                }
            }
        }
        // Flare: light up the busiest area.
        if a.ready[FLARE] {
            let mut best: Option<(f64, usize)> = None;
            for c in 0..CELLS {
                let area = flare_area(c, a.size[FLARE]);
                if area.iter().filter(|&&x| k.marks[x] == Mark::Unknown).count() < 3 {
                    continue;
                }
                let v: f64 = area.iter().filter(|&&x| k.marks[x] == Mark::Unknown).map(|&x| d[x]).sum();
                if best.map_or(true, |(b, _)| v > b) {
                    best = Some((v, c));
                }
            }
            if let Some((_, c)) = best {
                return Move::Flare(c);
            }
        }
        // Radar: sweep the line with the most unknown chances (Master would
        // rather shoot: in testing a sweep wasn't worth a turn).
        if a.ready[RADAR] && level != Level::Master {
            let mut best: Option<(f64, Move)> = None;
            for line in 0..SIZE {
                for row in [true, false] {
                    let cells = line_cells(line, row);
                    if cells.iter().filter(|&&c| k.marks[c] == Mark::Unknown).count() < 5 {
                        continue;
                    }
                    let v: f64 = cells.iter().filter(|&&c| k.marks[c] == Mark::Unknown).map(|&c| d[c]).sum();
                    if best.as_ref().map_or(true, |(b, _)| v > *b) {
                        best = Some((v, Move::Radar { line, row }));
                    }
                }
            }
            if let Some((_, m)) = best {
                return m;
            }
        }
        if level == Level::Master && !k.unknown().is_empty() {
            if let Move::Ping(c) = choose(k, level, rng) {
                return Move::Ping(c);
            }
        }
    }
    Move::Fire(by_score[0])
}

/// Up to `n` mines for Zero-Bot's fleet: open water, not next to a ship.
/// Master hides them near the middle, where hunters like to shoot first.
pub fn bot_mines(fleet: &Fleet, n: u8, level: Level, rng: &mut impl Rng) -> Vec<usize> {
    let occ = fleet.occupancy();
    let mut spots = shuffled(&(0..CELLS).filter(|&c| occ[c].is_none() && neighbours(c).all(|x| occ[x].is_none())).collect::<Vec<_>>(), rng);
    if level == Level::Master {
        let off_centre = |c: usize| {
            let (r, col) = ((c / SIZE) as f64 - 4.5, (c % SIZE) as f64 - 4.5);
            r * r + col * col
        };
        spots.sort_by(|&a, &b| off_centre(a).total_cmp(&off_centre(b)));
        spots.truncate(8);
        spots = shuffled(&spots, rng);
    }
    spots.into_iter().take(usize::from(n)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sonar::rules::{random_fleet, Fleet, ShotResult};
    use crate::sonar::tactics::MK1;
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

    /// One Tactics game between two Zero-Bots (`levels[side]`); returns the
    /// winner and how many power moves each side made. Every move must be legal.
    fn tactics_game(levels: [Level; 2], mk: [crate::sonar::tactics::Levels; 2], seed: u64) -> (usize, [usize; 2]) {
        let mut rng = ChaCha8Rng::seed_from_u64(seed);
        let fleets: Vec<Fleet> = (0..2)
            .map(|side| {
                let mut f = random_fleet(&mut rng);
                f.mines = bot_mines(&f, 2, levels[side], &mut rng);
                assert_eq!(f.validate(), Ok(()));
                f
            })
            .collect();
        let setup = crate::sonar::tactics::Setup::new(mk, rng.gen());
        let mut d = Duel::new_tactics([&fleets[0], &fleets[1]], (seed % 2) as usize, setup);
        let mut powers = [0; 2];
        for _ in 0..600 {
            if let Some(w) = d.winner() {
                return (w, powers);
            }
            let side = d.to_move();
            let m = choose_for(&d, side, levels[side], &mut rng);
            if m.power().is_some() || matches!(m, Move::Overdrive(_)) {
                powers[side] += 1;
            }
            d.play(m).unwrap_or_else(|e| panic!("{:?} made a bad move {} ({}) after {}", levels[side], m.code(), e.text(), d.move_string()));
        }
        panic!("the game never ended: {}", d.move_string());
    }

    /// How often `a` (side 0 or 1, taking turns) beats `b` in `n` Tactics games.
    fn win_rate(a: Level, b: Level, n: u64) -> f64 {
        let wins = (0..n)
            .filter(|&i| {
                let (w, _) = if i % 2 == 0 { tactics_game([a, b], [MK1, MK1], i) } else { tactics_game([b, a], [MK1, MK1], i) };
                w == (i % 2) as usize
            })
            .count();
        wins as f64 / n as f64
    }

    #[test]
    fn tactics_bots_play_legal_games_at_every_level_and_mk() {
        for (i, &a) in Level::ALL.iter().enumerate() {
            for &b in &Level::ALL {
                for mk in [[MK1, MK1], [[3; 5], [2; 5]]] {
                    tactics_game([a, b], mk, i as u64 * 31 + 7);
                }
            }
        }
    }

    #[test]
    fn tactics_bots_use_their_powers() {
        for level in [Level::Medium, Level::Hard, Level::Master] {
            let (_, p) = tactics_game([level, level], [MK1, MK1], 3);
            assert!(p[0] >= 3 && p[1] >= 3, "{level:?} used powers {p:?} times");
        }
    }

    #[test]
    fn harder_tactics_levels_win_more() {
        let medium = win_rate(Level::Medium, Level::Easy, 80);
        let hard = win_rate(Level::Hard, Level::Medium, 80);
        // Master's edge is small, so it needs more games to show.
        let master = win_rate(Level::Master, Level::Hard, 600);
        eprintln!("win rates: medium vs easy {medium:.2}, hard vs medium {hard:.2}, master vs hard {master:.2}");
        assert!(medium >= 0.7, "medium beat easy {medium}");
        assert!(hard >= 0.6, "hard beat medium {hard}");
        assert!(master >= 0.52, "master beat hard {master}");
    }

    #[test]
    fn it_fires_at_spotted_squares() {
        let f = Fleet::parse("a1h a3h a5h a7h a9h").unwrap();
        let mut k = Sea::new(&f).knowledge();
        k.marks[42] = Mark::Spotted;
        let a = Arsenal { ready: [false; POWERS], chargeable: [false; POWERS], size: [3, 2, 1, 2, 5], overdrive: false };
        let mut rng = ChaCha8Rng::seed_from_u64(9);
        for level in [Level::Medium, Level::Hard, Level::Master] {
            assert_eq!(choose_tactics(&k, &a, level, &mut rng), Move::Fire(42), "{level:?}");
        }
    }

    #[test]
    fn it_spends_overdrive_on_the_air_strike_first() {
        let f = Fleet::parse("a1h a3h a5h a7h a9h").unwrap();
        let k = Sea::new(&f).knowledge();
        let a = Arsenal { ready: [false; POWERS], chargeable: [true; POWERS], size: [3, 2, 1, 2, 5], overdrive: true };
        let mut rng = ChaCha8Rng::seed_from_u64(9);
        assert_eq!(choose_tactics(&k, &a, Level::Hard, &mut rng), Move::Overdrive(AIR_STRIKE));
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
