//! Snake Signal rules: a tick-by-tick snake game built from a seed, and the
//! replay that turns a list of turns into a score.
//!
//! The frontend has a line-for-line copy in `frontend/src/games/snake-signal/
//! engine.ts`; both read their numbers from `shared/snake_rules.json` and use
//! only integer math, so the same seed and turns always give the same result.
//! `shared/snake_vectors.json` is checked by both test suites. Change both
//! files together.

use std::collections::VecDeque;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::rng::Rng;

const RULES_JSON: &str = include_str!("../../../shared/snake_rules.json");

#[derive(Debug, Deserialize)]
pub struct Sizes {
    pub small: u32,
    pub medium: u32,
    pub large: u32,
}

#[derive(Debug, Deserialize)]
pub struct Rules {
    pub start_len: u32,
    pub sizes: Sizes,
    pub size_pct: Sizes,
    pub tick_start_ms: u32,
    pub tick_min_ms: u32,
    pub tick_step_ms: u32,
    pub slow_pct: u32,
    pub signal_max: i32,
    pub signal_drain: i32,
    pub signal_food: i32,
    pub signal_golden: i32,
    pub food_base: u32,
    pub food_per_level: u32,
    pub level_every: u32,
    pub level_max: u32,
    pub golden_points: u32,
    pub golden_chance: u32,
    pub golden_ticks: u32,
    pub golden_grow: u32,
    pub combo_window: u32,
    pub combo_mults: Vec<u32>,
    pub close_call_points: u32,
    pub close_call_gap: u32,
    pub power_every: u32,
    pub power_ticks: u32,
    pub boost_ticks: u32,
    pub phase_ticks: u32,
    pub magnet_ticks: u32,
    pub slow_ticks: u32,
    pub magnet_range: i32,
    pub snip_points: u32,
    pub hazard_start: u32,
    pub hazard_every: u32,
    pub hazard_warn: u32,
    pub hazard_life: u32,
    pub hazard_max: usize,
    pub hazard_safe: i32,
    pub bug_start: u32,
    pub bug_every: u32,
    pub bug_step: u32,
    pub bug_life: u32,
    pub bug_points: u32,
    pub bug_safe: i32,
    pub max_ticks: u32,
}

pub fn rules() -> &'static Rules {
    static R: OnceLock<Rules> = OnceLock::new();
    R.get_or_init(|| serde_json::from_str(RULES_JSON).expect("shared/snake_rules.json is valid"))
}

/// Everyone gets the same Daily seed on the same WIB day.
pub fn daily_seed(year: i32, month: u32, day: u32) -> u32 {
    crate::rng::daily_seed(year, month, day, 0x5A4E_5161)
}

// ---------------------------------------------------------------------------
// Modes, sizes, pieces
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Classic,
    Wrap,
    Daily,
}

impl Mode {
    pub const ALL: [Mode; 3] = [Mode::Classic, Mode::Wrap, Mode::Daily];

    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Classic => "classic",
            Mode::Wrap => "wrap",
            Mode::Daily => "daily",
        }
    }

    pub fn parse(s: &str) -> Option<Mode> {
        Mode::ALL.into_iter().find(|m| m.as_str() == s)
    }

    /// Stored in `scores.level` so each mode has its own leaderboard.
    pub fn board_id(self) -> i32 {
        match self {
            Mode::Classic => 1,
            Mode::Wrap => 2,
            Mode::Daily => 4,
        }
    }

    /// Edges are portals in Wrap; walls everywhere else.
    pub fn wraps(self) -> bool {
        self == Mode::Wrap
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Size {
    Small,
    Medium,
    Large,
}

impl Size {
    pub const ALL: [Size; 3] = [Size::Small, Size::Medium, Size::Large];

    pub fn as_str(self) -> &'static str {
        match self {
            Size::Small => "small",
            Size::Medium => "medium",
            Size::Large => "large",
        }
    }

    pub fn parse(s: &str) -> Option<Size> {
        Size::ALL.into_iter().find(|m| m.as_str() == s)
    }

    /// Cells per side.
    pub fn n(self) -> u32 {
        let s = &rules().sizes;
        match self {
            Size::Small => s.small,
            Size::Medium => s.medium,
            Size::Large => s.large,
        }
    }

    /// Final score multiplier in %.
    pub fn pct(self) -> u32 {
        let s = &rules().size_pct;
        match self {
            Size::Small => s.small,
            Size::Medium => s.medium,
            Size::Large => s.large,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Power {
    Boost,
    Phase,
    Magnet,
    Slow,
    Snip,
}

pub const POWERS: [Power; 5] = [Power::Boost, Power::Phase, Power::Magnet, Power::Slow, Power::Snip];

/// Why a run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum End {
    Wall,
    #[serde(rename = "self")]
    Body,
    Glitch,
    Bug,
    Signal,
    Full,
    Time,
}

impl End {
    pub fn as_str(self) -> &'static str {
        match self {
            End::Wall => "wall",
            End::Body => "self",
            End::Glitch => "glitch",
            End::Bug => "bug",
            End::Signal => "signal",
            End::Full => "full",
            End::Time => "time",
        }
    }
}

/// Directions: 0 up, 1 right, 2 down, 3 left.
const DX: [i32; 4] = [0, 1, 0, -1];
const DY: [i32; 4] = [-1, 0, 1, 0];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Block {
    pub cell: u32,
    pub born: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bug {
    pub cell: u32,
    pub born: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Golden {
    pub cell: u32,
    pub until: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PowerItem {
    pub kind: Power,
    pub cell: u32,
    pub until: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Summary {
    /// Final score (after the board-size multiplier).
    pub score: u32,
    /// Points before the board-size multiplier.
    pub raw: u32,
    pub length: u32,
    pub max_length: u32,
    pub eaten: u32,
    pub golden: u32,
    pub powers: u32,
    pub close_calls: u32,
    pub bugs_eaten: u32,
    /// Highest combo multiplier reached (1, 2, 3 or 5).
    pub best_combo: u32,
    pub ticks: u32,
    /// Game time in ms (sum of every tick's length).
    pub game_ms: u64,
    pub ended_by: Option<End>,
}

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct Game {
    pub mode: Mode,
    pub size: Size,
    pub n: u32,
    rng: Rng,
    /// Head first.
    pub snake: VecDeque<u32>,
    /// How many snake parts sit on each cell (Phase lets them overlap).
    occ: Vec<u8>,
    pub dir: u8,
    grow: u32,
    pub food: u32,
    pub golden: Option<Golden>,
    pub power: Option<PowerItem>,
    pub blocks: Vec<Block>,
    pub bug: Option<Bug>,
    pub boost_until: u32,
    pub phase_until: u32,
    pub magnet_until: u32,
    pub slow_until: u32,
    pub signal: i32,
    /// Index into `combo_mults`.
    pub combo: usize,
    pub last_eat: Option<u32>,
    last_close: Option<u32>,
    pub tick: u32,
    pub over: Option<End>,
    pub s: Summary,
}

impl Game {
    pub fn new(seed: u32, mode: Mode, size: Size) -> Game {
        let r = rules();
        let n = size.n();
        let mid = n / 2;
        let mut snake = VecDeque::new();
        let mut occ = vec![0u8; (n * n) as usize];
        for i in 0..r.start_len {
            let c = mid * n + (mid - i);
            snake.push_back(c);
            occ[c as usize] += 1;
        }
        let mut g = Game {
            mode,
            size,
            n,
            rng: Rng::new(seed),
            snake,
            occ,
            dir: 1,
            grow: 0,
            food: 0,
            golden: None,
            power: None,
            blocks: Vec::new(),
            bug: None,
            boost_until: 0,
            phase_until: 0,
            magnet_until: 0,
            slow_until: 0,
            signal: r.signal_max,
            combo: 0,
            last_eat: None,
            last_close: None,
            tick: 0,
            over: None,
            s: Summary { length: r.start_len, max_length: r.start_len, best_combo: 1, ..Summary::default() },
        };
        g.food = g.pick_free(2).expect("an empty board has room");
        g
    }

    pub fn head(&self) -> u32 {
        self.snake[0]
    }

    /// Length of the current tick in ms (gets faster as you grow).
    pub fn tick_ms(&self) -> u32 {
        let r = rules();
        let grown = self.snake.len() as u32 - r.start_len.min(self.snake.len() as u32);
        let base = r.tick_start_ms.saturating_sub(grown * r.tick_step_ms).max(r.tick_min_ms);
        if self.tick < self.slow_until {
            base * r.slow_pct / 100
        } else {
            base
        }
    }

    /// Current points multiplier (combo × Boost).
    pub fn mult(&self) -> u32 {
        let r = rules();
        r.combo_mults[self.combo] * if self.tick < self.boost_until { 2 } else { 1 }
    }

    fn xy(&self, c: u32) -> (i32, i32) {
        ((c % self.n) as i32, (c / self.n) as i32)
    }

    /// The cell one step from `c` in `dir`; None = through a wall.
    pub fn next(&self, c: u32, dir: u8) -> Option<u32> {
        let n = self.n as i32;
        let (x, y) = self.xy(c);
        let mut nx = x + DX[dir as usize];
        let mut ny = y + DY[dir as usize];
        if nx < 0 || ny < 0 || nx >= n || ny >= n {
            if !self.mode.wraps() {
                return None;
            }
            nx = (nx + n) % n;
            ny = (ny + n) % n;
        }
        Some((ny * n + nx) as u32)
    }

    fn cheb(&self, a: u32, b: u32) -> i32 {
        let (ax, ay) = self.xy(a);
        let (bx, by) = self.xy(b);
        (ax - bx).abs().max((ay - by).abs())
    }

    /// A glitch block that is solid right now (after its warning flicker).
    pub fn solid_at(&self, c: u32) -> bool {
        let w = rules().hazard_warn;
        self.blocks.iter().any(|b| b.cell == c && self.tick >= b.born + w)
    }

    /// Would moving the head into this cell end the run?
    fn deadly(&self, c: Option<u32>) -> bool {
        let Some(c) = c else { return true };
        if self.solid_at(c) {
            return true;
        }
        if self.bug.is_some_and(|b| b.cell == c) && self.tick >= self.boost_until {
            return true;
        }
        let tail = *self.snake.back().expect("snake is never empty");
        let leaving = c == tail && self.grow == 0 && self.occ[c as usize] == 1;
        self.occ[c as usize] > 0 && !leaving && self.tick >= self.phase_until
    }

    /// Empty for spawning: no snake, block, item or bug there.
    fn free(&self, c: u32) -> bool {
        self.occ[c as usize] == 0
            && c != self.food
            && !self.blocks.iter().any(|b| b.cell == c)
            && !self.golden.is_some_and(|g| g.cell == c)
            && !self.power.is_some_and(|p| p.cell == c)
            && !self.bug.is_some_and(|b| b.cell == c)
    }

    /// A random free cell at least `away` (Chebyshev) from the head.
    fn pick_free(&mut self, away: i32) -> Option<u32> {
        let head = self.head();
        let total = self.n * self.n;
        let mut count = 0;
        for c in 0..total {
            if self.free(c) && self.cheb(c, head) >= away {
                count += 1;
            }
        }
        if count == 0 {
            return None;
        }
        let mut k = self.rng.below(count);
        for c in 0..total {
            if self.free(c) && self.cheb(c, head) >= away {
                if k == 0 {
                    return Some(c);
                }
                k -= 1;
            }
        }
        None
    }

    fn end(&mut self, why: End) {
        self.over = Some(why);
        self.tick += 1;
        self.s.ticks = self.tick;
        self.s.length = self.snake.len() as u32;
        self.s.ended_by = Some(why);
        self.s.score = (self.s.raw as u64 * self.size.pct() as u64 / 100) as u32;
    }

    fn add_points(&mut self, base: u32) {
        let m = self.mult();
        self.s.raw += base * m;
    }

    /// Eating food or a golden packet keeps the combo chain going.
    fn chain(&mut self) {
        let r = rules();
        let t = self.tick;
        self.combo = match self.last_eat {
            Some(l) if t - l <= r.combo_window => (self.combo + 1).min(r.combo_mults.len() - 1),
            _ => 0,
        };
        self.last_eat = Some(t);
        self.s.best_combo = self.s.best_combo.max(r.combo_mults[self.combo]);
    }

    /// One tick. `turn` (if any) must not be the current direction or its
    /// reverse; `replay` rejects those.
    pub fn step(&mut self, turn: Option<u8>) {
        if self.over.is_some() {
            return;
        }
        let r = rules();
        let t = self.tick;
        self.s.game_ms += self.tick_ms() as u64;

        // Things that run out.
        if self.golden.is_some_and(|g| g.until <= t) {
            self.golden = None;
        }
        if self.power.is_some_and(|p| p.until <= t) {
            self.power = None;
        }
        self.blocks.retain(|b| t < b.born + r.hazard_warn + r.hazard_life);
        if self.bug.is_some_and(|b| b.born + r.bug_life <= t) {
            self.bug = None;
        }
        if self.last_eat.is_some_and(|l| t - l > r.combo_window) {
            self.combo = 0;
        }

        let old = self.dir;
        if let Some(d) = turn {
            self.dir = d;
        }
        let head = self.head();

        // Close call: you turned away one step before something deadly.
        if turn.is_some()
            && self.deadly(self.next(head, old))
            && self.last_close.map_or(true, |l| t - l >= r.close_call_gap)
        {
            self.add_points(r.close_call_points);
            self.s.close_calls += 1;
            self.last_close = Some(t);
        }

        let Some(c) = self.next(head, self.dir) else {
            return self.end(End::Wall);
        };
        if self.solid_at(c) {
            return self.end(End::Glitch);
        }
        if self.bug.is_some_and(|b| b.cell == c) {
            if t < self.boost_until {
                self.bug = None;
                self.add_points(r.bug_points);
                self.s.bugs_eaten += 1;
            } else {
                return self.end(End::Bug);
            }
        }
        let tail = *self.snake.back().expect("snake is never empty");
        let leaving = c == tail && self.grow == 0 && self.occ[c as usize] == 1;
        if self.occ[c as usize] > 0 && !leaving && t >= self.phase_until {
            return self.end(End::Body);
        }

        // Move.
        let len_before = self.snake.len() as u32;
        self.snake.push_front(c);
        self.occ[c as usize] += 1;
        if self.grow > 0 {
            self.grow -= 1;
        } else {
            let gone = self.snake.pop_back().expect("snake is never empty");
            self.occ[gone as usize] -= 1;
        }

        // Magnet pulls the food one cell closer.
        if t < self.magnet_until && self.food != c {
            let (hx, hy) = self.xy(c);
            let (fx, fy) = self.xy(self.food);
            let (dx, dy) = (hx - fx, hy - fy);
            if dx.abs() + dy.abs() <= r.magnet_range {
                let (mx, my) = if dx.abs() >= dy.abs() { (dx.signum(), 0) } else { (0, dy.signum()) };
                let to = ((fy + my) * self.n as i32 + fx + mx) as u32;
                if to == c || self.free(to) {
                    self.food = to;
                }
            }
        }

        // Eat.
        if c == self.food {
            self.chain();
            let level = ((len_before - r.start_len.min(len_before)) / r.level_every).min(r.level_max);
            self.add_points(r.food_base + level * r.food_per_level);
            self.s.eaten += 1;
            self.grow += 1;
            self.signal = (self.signal + r.signal_food).min(r.signal_max);
            match self.pick_free(0) {
                Some(f) => self.food = f,
                None => return self.end(End::Full),
            }
            if self.golden.is_none() && self.rng.below(r.golden_chance) == 0 {
                if let Some(g) = self.pick_free(0) {
                    self.golden = Some(Golden { cell: g, until: t + 1 + r.golden_ticks });
                }
            }
            if self.power.is_none() && self.s.eaten % r.power_every == 0 {
                let kind = POWERS[self.rng.below(POWERS.len() as u32) as usize];
                if let Some(p) = self.pick_free(0) {
                    self.power = Some(PowerItem { kind, cell: p, until: t + 1 + r.power_ticks });
                }
            }
        }
        if self.golden.is_some_and(|g| g.cell == c) {
            self.golden = None;
            self.chain();
            self.add_points(r.golden_points);
            self.s.golden += 1;
            self.grow += r.golden_grow;
            self.signal = (self.signal + r.signal_golden).min(r.signal_max);
        }
        if let Some(p) = self.power.filter(|p| p.cell == c) {
            self.power = None;
            self.s.powers += 1;
            let until = t + 1;
            match p.kind {
                Power::Boost => self.boost_until = until + r.boost_ticks,
                Power::Phase => self.phase_until = until + r.phase_ticks,
                Power::Magnet => self.magnet_until = until + r.magnet_ticks,
                Power::Slow => self.slow_until = until + r.slow_ticks,
                Power::Snip => {
                    let keep = (self.snake.len() as u32 / 2).max(r.start_len);
                    while self.snake.len() as u32 > keep {
                        let gone = self.snake.pop_back().expect("snake is never empty");
                        self.occ[gone as usize] -= 1;
                    }
                    self.grow = 0;
                    self.add_points(r.snip_points);
                }
            }
        }
        self.s.max_length = self.s.max_length.max(self.snake.len() as u32);

        // Glitch blocks: a short line appears away from the head.
        if t >= r.hazard_start && (t - r.hazard_start) % r.hazard_every == 0 && self.blocks.len() < r.hazard_max {
            if let Some(first) = self.pick_free(r.hazard_safe) {
                let len = 1 + self.rng.below(3);
                let dir = if self.rng.below(2) == 0 { 1 } else { 2 };
                let mut cell = Some(first);
                for _ in 0..len {
                    let Some(b) = cell else { break };
                    if self.blocks.len() >= r.hazard_max || !self.free(b) || self.cheb(b, c) < r.hazard_safe {
                        break;
                    }
                    self.blocks.push(Block { cell: b, born: t });
                    let (x, y) = self.xy(b);
                    cell = if (dir == 1 && x + 1 < self.n as i32) || (dir == 2 && y + 1 < self.n as i32) {
                        Some((y * self.n as i32 + x + DX[dir] + DY[dir] * self.n as i32) as u32)
                    } else {
                        None
                    };
                }
            }
        }

        // The glitch bug: appears now and then and wanders around.
        if self.bug.is_none() && t >= r.bug_start && (t - r.bug_start) % r.bug_every == 0 {
            if let Some(b) = self.pick_free(r.bug_safe) {
                self.bug = Some(Bug { cell: b, born: t });
            }
        } else if let Some(bug) = self.bug {
            if (t - bug.born) % r.bug_step == r.bug_step - 1 {
                let start = self.rng.below(4);
                let (x, y) = self.xy(bug.cell);
                for k in 0..4 {
                    let d = ((start + k) % 4) as usize;
                    let (nx, ny) = (x + DX[d], y + DY[d]);
                    if nx < 0 || ny < 0 || nx >= self.n as i32 || ny >= self.n as i32 {
                        continue;
                    }
                    let to = (ny * self.n as i32 + nx) as u32;
                    if self.free(to) {
                        self.bug = Some(Bug { cell: to, born: bug.born });
                        break;
                    }
                }
            }
        }

        // Signal drains every tick; food refills it.
        self.signal -= r.signal_drain;
        if self.signal <= 0 {
            self.signal = 0;
            return self.end(End::Signal);
        }

        self.tick += 1;
        self.s.ticks = self.tick;
        self.s.length = self.snake.len() as u32;
        if self.tick >= r.max_ticks {
            self.tick -= 1;
            self.end(End::Time);
        }
    }
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/// One turn: at `tick`, start heading `dir` (0 up, 1 right, 2 down, 3 left).
pub type Turn = (u32, u8);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplayError {
    TooManyTurns,
    Unsorted,
    BadDir,
    /// Same direction, or a U-turn into your own neck.
    BadTurn,
    /// A turn after the run was already over.
    AfterEnd,
}

impl ReplayError {
    pub fn message(self) -> &'static str {
        match self {
            ReplayError::TooManyTurns => "too many turns",
            ReplayError::Unsorted => "turns are out of order",
            ReplayError::BadDir => "unknown direction",
            ReplayError::BadTurn => "impossible turn",
            ReplayError::AfterEnd => "turns after the run ended",
        }
    }
}

/// Plays a whole run; the run always ends (crash, signal lost or time cap).
pub fn replay(seed: u32, mode: Mode, size: Size, turns: &[Turn]) -> Result<Summary, ReplayError> {
    if turns.len() as u32 > rules().max_ticks {
        return Err(ReplayError::TooManyTurns);
    }
    if turns.windows(2).any(|w| w[1].0 <= w[0].0) {
        return Err(ReplayError::Unsorted);
    }
    if turns.iter().any(|t| t.1 > 3) {
        return Err(ReplayError::BadDir);
    }
    let mut g = Game::new(seed, mode, size);
    let mut i = 0;
    while g.over.is_none() {
        let turn = match turns.get(i) {
            Some(&(tick, d)) if tick == g.tick => {
                i += 1;
                if d == g.dir || d == (g.dir + 2) % 4 {
                    return Err(ReplayError::BadTurn);
                }
                Some(d)
            }
            _ => None,
        };
        g.step(turn);
    }
    if i < turns.len() {
        return Err(ReplayError::AfterEnd);
    }
    Ok(g.s)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::collections::VecDeque as Queue;

    /// A simple test bot: walks the shortest safe path to the food (BFS),
    /// otherwise any safe direction. Deterministic, so its runs make good
    /// shared test vectors.
    pub fn bot_turn(g: &Game) -> Option<u8> {
        let head = g.head();
        let total = (g.n * g.n) as usize;
        let mut prev: Vec<i32> = vec![-1; total];
        let mut first: Vec<u8> = vec![0; total];
        let mut q = Queue::new();
        for d in 0..4u8 {
            if d == (g.dir + 2) % 4 {
                continue;
            }
            if let Some(c) = g.next(head, d) {
                if !g.deadly(Some(c)) && prev[c as usize] < 0 {
                    prev[c as usize] = head as i32;
                    first[c as usize] = d;
                    q.push_back(c);
                }
            }
        }
        let mut fallback = None;
        while let Some(c) = q.pop_front() {
            if fallback.is_none() {
                fallback = Some(first[c as usize]);
            }
            if c == g.food {
                return want(g, first[c as usize]);
            }
            for d in 0..4u8 {
                if let Some(nc) = g.next(c, d) {
                    let busy = g.occ[nc as usize] > 0 || g.blocks.iter().any(|b| b.cell == nc);
                    if !busy && prev[nc as usize] < 0 && nc != head {
                        prev[nc as usize] = c as i32;
                        first[nc as usize] = first[c as usize];
                        q.push_back(nc);
                    }
                }
            }
        }
        fallback.and_then(|d| want(g, d))
    }

    fn want(g: &Game, d: u8) -> Option<u8> {
        if d == g.dir {
            None
        } else {
            Some(d)
        }
    }

    pub fn bot_run(seed: u32, mode: Mode, size: Size, max_turns: usize) -> (Vec<Turn>, Summary) {
        let mut g = Game::new(seed, mode, size);
        let mut turns = Vec::new();
        while g.over.is_none() {
            let t = if turns.len() < max_turns { bot_turn(&g) } else { None };
            if let Some(d) = t {
                turns.push((g.tick, d));
            }
            g.step(t);
        }
        (turns, g.s)
    }

    #[test]
    fn rules_load() {
        let r = rules();
        assert_eq!(r.combo_mults.len(), 4);
        assert_eq!(Size::Medium.n(), 20);
    }

    #[test]
    fn going_straight_hits_the_wall() {
        let s = replay(1, Mode::Classic, Size::Medium, &[]).unwrap();
        assert_eq!(s.ended_by, Some(End::Wall));
        // Head starts in the middle (x = 10) and moves right until x = 19.
        assert_eq!(s.ticks, 10);
    }

    #[test]
    fn wrap_mode_runs_until_the_signal_is_lost() {
        let s = replay(1, Mode::Wrap, Size::Medium, &[]).unwrap();
        // No walls: going straight only ends by losing the signal or a glitch.
        assert_ne!(s.ended_by, Some(End::Wall), "{s:?}");
        assert!(s.ticks > 20);
    }

    #[test]
    fn u_turns_and_repeats_are_rejected() {
        assert_eq!(replay(1, Mode::Classic, Size::Medium, &[(0, 3)]), Err(ReplayError::BadTurn));
        assert_eq!(replay(1, Mode::Classic, Size::Medium, &[(0, 1)]), Err(ReplayError::BadTurn));
        assert_eq!(replay(1, Mode::Classic, Size::Medium, &[(2, 0), (1, 1)]), Err(ReplayError::Unsorted));
        assert_eq!(replay(1, Mode::Classic, Size::Medium, &[(0, 7)]), Err(ReplayError::BadDir));
        assert_eq!(replay(1, Mode::Classic, Size::Medium, &[(500, 0)]), Err(ReplayError::AfterEnd));
    }

    #[test]
    fn chasing_your_own_tail_is_legal_but_the_signal_fades() {
        // A 4-long snake circling a 2x2 square never bites itself, but it
        // never eats either, so the signal runs out after 1000 / 4 ticks.
        let cycle = [0u8, 3, 2, 1];
        let turns: Vec<Turn> = (0..250u32).map(|t| (t, cycle[(t % 4) as usize])).collect();
        let s = replay(9, Mode::Classic, Size::Medium, &turns).unwrap();
        assert_eq!(s.ended_by, Some(End::Signal));
        assert_eq!(s.ticks, 250);
        assert_eq!(s.score, 0);
    }

    #[test]
    fn biting_your_body_ends_the_run() {
        // Grow first (bot), then force a U-turn-ish loop into the body.
        let (_, s) = bot_run(5, Mode::Classic, Size::Small, usize::MAX);
        assert!(s.max_length > 4);
        let mut g = Game::new(5, Mode::Classic, Size::Medium);
        g.snake = [210u32, 211, 231, 230, 229, 209, 189].into_iter().collect();
        g.occ = vec![0; 400];
        for &c in &g.snake {
            g.occ[c as usize] += 1;
        }
        g.dir = 0; // head 210 = (10,10) going up; turning right hits 211.
        g.step(Some(1));
        assert_eq!(g.over, Some(End::Body));
    }

    #[test]
    fn the_bot_plays_long_runs_and_replays_match() {
        for seed in 1..6u32 {
            for (mode, size) in [(Mode::Classic, Size::Medium), (Mode::Wrap, Size::Small), (Mode::Classic, Size::Large)] {
                let (turns, s) = bot_run(seed, mode, size, usize::MAX);
                assert!(s.eaten >= 10, "seed {seed} {mode:?}: {s:?}");
                assert_eq!(replay(seed, mode, size, &turns).unwrap(), s);
            }
        }
    }

    #[test]
    fn combo_and_signal_behave() {
        let (_, s) = bot_run(3, Mode::Classic, Size::Small, usize::MAX);
        assert!(s.best_combo >= 2);
        assert!(s.game_ms >= s.ticks as u64 * rules().tick_min_ms as u64);
    }

    /// Run with `cargo test --release snake_print_balance -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn snake_print_balance() {
        for (mode, size) in [(Mode::Classic, Size::Small), (Mode::Classic, Size::Medium), (Mode::Wrap, Size::Medium), (Mode::Classic, Size::Large)] {
            let mut scores = Vec::new();
            for seed in 1..40u32 {
                let (_, s) = bot_run(seed, mode, size, usize::MAX);
                scores.push((s.score, s.eaten, s.max_length, s.best_combo, s.ended_by, s.game_ms / 1000, s.bugs_eaten));
            }
            scores.sort_by_key(|x| x.0);
            println!("{mode:?} {size:?}: median {:?}", scores[scores.len() / 2]);
            println!("   min {:?} max {:?}", scores[0], scores[scores.len() - 1]);
        }
    }

    /// Prints shared/snake_vectors.json.
    #[test]
    #[ignore]
    fn snake_print_vectors() {
        let mut out = Vec::new();
        for (seed, mode, size, cut) in [
            (11u32, Mode::Classic, Size::Medium, usize::MAX),
            (22, Mode::Wrap, Size::Small, usize::MAX),
            (33, Mode::Classic, Size::Large, 40),
            (44, Mode::Daily, Size::Medium, usize::MAX),
        ] {
            let (turns, s) = bot_run(seed, mode, size, cut);
            out.push(serde_json::json!({
                "seed": seed, "mode": mode, "size": size,
                "turns": turns.iter().map(|t| [t.0, t.1 as u32]).collect::<Vec<_>>(),
                "summary": s,
            }));
        }
        // Runs that use power-ups, golden packets and the bug a lot.
        for (mode, size) in [(Mode::Classic, Size::Large), (Mode::Wrap, Size::Medium)] {
            let seed = (1..500u32)
                .find(|&seed| {
                    let (_, s) = bot_run(seed, mode, size, usize::MAX);
                    s.powers >= 4 && s.golden >= 2 && (mode == Mode::Classic || s.bugs_eaten >= 1)
                })
                .expect("some seed uses every feature");
            let (turns, s) = bot_run(seed, mode, size, usize::MAX);
            out.push(serde_json::json!({
                "seed": seed, "mode": mode, "size": size,
                "turns": turns.iter().map(|t| [t.0, t.1 as u32]).collect::<Vec<_>>(),
                "summary": s,
            }));
        }
        println!("{}", serde_json::to_string(&serde_json::json!({ "runs": out })).unwrap());
    }

    #[test]
    fn shared_vectors_match() {
        const V: &str = include_str!("../../../shared/snake_vectors.json");
        let v: serde_json::Value = serde_json::from_str(V).unwrap();
        for run in v["runs"].as_array().unwrap() {
            let seed = run["seed"].as_u64().unwrap() as u32;
            let mode: Mode = serde_json::from_value(run["mode"].clone()).unwrap();
            let size: Size = serde_json::from_value(run["size"].clone()).unwrap();
            let turns: Vec<Turn> = run["turns"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| (t[0].as_u64().unwrap() as u32, t[1].as_u64().unwrap() as u8))
                .collect();
            let want: Summary = serde_json::from_value(run["summary"].clone()).unwrap();
            assert_eq!(replay(seed, mode, size, &turns).unwrap(), want, "seed {seed}");
        }
    }
}
