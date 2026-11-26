//! Signal Flap rules: a tick-by-tick one-button flyer built from a seed, and
//! the replay that turns the player's flap ticks into a score.
//!
//! The frontend has a line-for-line copy in `frontend/src/games/signal-flap/
//! engine.ts`; both read their numbers from `shared/flap_rules.json` and use
//! only integer math, so the same seed and flaps always give the same result.
//! `shared/flap_vectors.json` is checked by both test suites. Change both
//! files together.
//!
//! The drone stays at a fixed x; the towers scroll left. It hovers until the
//! first flap, which starts the course. Gravity pulls it down every tick and a
//! flap sets its speed straight up. One touch of a tower, the ground or the
//! ceiling ends the run. Score = gaps passed + signal bars picked up.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::rng::Rng;

const RULES_JSON: &str = include_str!("../../../shared/flap_rules.json");

#[derive(Debug, Deserialize)]
pub struct MovingRules {
    pub from: u32,
    pub pct_start: u32,
    pub pct_step: u32,
    pub pct_max: u32,
    pub amp_min: i32,
    pub amp_max: i32,
    pub speed_min: i32,
    pub speed_max: i32,
}

#[derive(Debug, Deserialize)]
pub struct BarRules {
    pub pct: u32,
    pub r: i32,
    pub spread: i32,
}

#[derive(Debug, Deserialize)]
pub struct Rules {
    pub width: i32,
    pub height: i32,
    pub ground_h: i32,
    pub drone_x: i32,
    pub drone_r: i32,
    pub start_y: i32,
    pub gravity: i32,
    pub flap_v: i32,
    pub max_fall: i32,
    pub tower_w: i32,
    pub spacing: i32,
    pub first_x: i32,
    pub margin: i32,
    pub max_shift: i32,
    pub gap_start: i32,
    pub gap_step: i32,
    pub gap_min: i32,
    pub speed_start: i32,
    pub speed_step: i32,
    pub speed_every: u32,
    pub speed_max: i32,
    pub moving: MovingRules,
    pub bars: BarRules,
    pub max_ticks: u32,
    pub max_inputs: usize,
}

impl Rules {
    /// The top of the ground strip.
    pub fn ground_y(&self) -> i32 {
        self.height - self.ground_h
    }
}

pub fn rules() -> &'static Rules {
    static R: OnceLock<Rules> = OnceLock::new();
    R.get_or_init(|| serde_json::from_str(RULES_JSON).expect("shared/flap_rules.json is valid"))
}

/// Everyone gets the same Daily seed on the same WIB day.
pub fn daily_seed(year: i32, month: u32, day: u32) -> u32 {
    crate::rng::daily_seed(year, month, day, 0x464C_4150)
}

// ---------------------------------------------------------------------------
// Course
// ---------------------------------------------------------------------------

/// One antenna tower pair with a gap between the top and bottom parts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tower {
    /// 0-based count from the start of the course.
    pub idx: u32,
    /// Left edge.
    pub x: i32,
    /// Gap height.
    pub gap: i32,
    /// Gap centre when not moving.
    pub center: i32,
    /// How far a moving gap slides from its centre (0 = still).
    pub amp: i32,
    pub off: i32,
    pub dir: i32,
    pub mspeed: i32,
    pub passed: bool,
}

impl Tower {
    pub fn gap_y(&self) -> i32 {
        self.center + self.off
    }
    pub fn gap_top(&self) -> i32 {
        self.gap_y() - self.gap / 2
    }
    pub fn gap_bot(&self) -> i32 {
        self.gap_y() + self.gap / 2
    }
}

/// A signal bar to pick up (centre point).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bar {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum End {
    /// Hit a tower, the ground or the ceiling.
    Crash,
    /// Reached the time cap.
    Time,
    Quit,
}

impl End {
    pub fn as_str(self) -> &'static str {
        match self {
            End::Crash => "crash",
            End::Time => "time",
            End::Quit => "quit",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Summary {
    /// Gaps + bars.
    pub score: u32,
    pub gaps: u32,
    pub bars: u32,
    pub flaps: u32,
    pub ticks: u32,
    pub ended_by: Option<End>,
    pub game_ms: u64,
}

#[derive(Clone)]
pub struct Game {
    pub rng: Rng,
    pub tick: u32,
    /// False until the first flap; nothing moves before it.
    pub started: bool,
    pub y: i32,
    pub vy: i32,
    pub speed: i32,
    pub towers: Vec<Tower>,
    pub bars: Vec<Bar>,
    /// Where the next tower will be placed.
    pub next_x: i32,
    pub next_idx: u32,
    /// The gap centre of the last tower placed.
    pub last_center: i32,
    pub over: Option<End>,
    pub s: Summary,
}

/// Does a circle at (cx, cy) touch the rectangle?
fn touches(cx: i32, cy: i32, cr: i32, x: i32, y: i32, w: i32, h: i32) -> bool {
    let px = cx.clamp(x, x + w);
    let py = cy.clamp(y, y + h);
    let dx = (cx - px) as i64;
    let dy = (cy - py) as i64;
    dx * dx + dy * dy < (cr as i64) * (cr as i64)
}

impl Game {
    pub fn new(seed: u32) -> Game {
        let r = rules();
        let mut g = Game {
            rng: Rng::new(seed),
            tick: 0,
            started: false,
            y: r.start_y,
            vy: 0,
            speed: r.speed_start,
            towers: Vec::new(),
            bars: Vec::new(),
            next_x: r.first_x,
            next_idx: 0,
            last_center: r.start_y,
            over: None,
            s: Summary { score: 0, gaps: 0, bars: 0, flaps: 0, ticks: 0, ended_by: None, game_ms: 0 },
        };
        g.spawn();
        g
    }

    /// Places towers until one is waiting just past the right edge.
    fn spawn(&mut self) {
        let r = rules();
        while self.next_x <= r.width + r.spacing {
            self.add_tower();
        }
    }

    fn add_tower(&mut self) {
        let r = rules();
        let m = &r.moving;
        let idx = self.next_idx;
        let gap = (r.gap_start - idx as i32 * r.gap_step).max(r.gap_min);
        let half = gap / 2;
        // Always the same 7 draws per tower, so both engines stay in step.
        let d_center = self.rng.next_u32();
        let d_move = self.rng.below(100);
        let d_amp = self.rng.next_u32();
        let d_speed = self.rng.next_u32();
        let d_dir = self.rng.below(2);
        let d_bar = self.rng.below(100);
        let d_off = self.rng.next_u32();

        let pct = if idx >= m.from { (m.pct_start + (idx - m.from) * m.pct_step).min(m.pct_max) } else { 0 };
        let moving = d_move < pct;
        let amp = if moving { m.amp_min + (d_amp % (m.amp_max - m.amp_min + 1) as u32) as i32 } else { 0 };
        let mspeed = if moving { m.speed_min + (d_speed % (m.speed_max - m.speed_min + 1) as u32) as i32 } else { 0 };
        let dir = if d_dir == 0 { 1 } else { -1 };

        let ground = r.ground_y();
        let low = r.margin + half + amp;
        let high = ground - r.margin - half - amp;
        let lo = low.max(self.last_center - r.max_shift);
        let hi = high.min(self.last_center + r.max_shift);
        let center = if hi >= lo { lo + (d_center % (hi - lo + 1) as u32) as i32 } else { self.last_center.clamp(low, high) };

        if idx >= 1 && d_bar < r.bars.pct {
            let x = self.next_x - r.spacing / 2 + r.tower_w / 2;
            let mid = (self.last_center + center) / 2;
            let off = (d_off % (2 * r.bars.spread + 1) as u32) as i32 - r.bars.spread;
            let y = (mid + off).clamp(r.margin, ground - r.margin);
            self.bars.push(Bar { x, y });
        }

        self.towers.push(Tower { idx, x: self.next_x, gap, center, amp, off: 0, dir, mspeed, passed: false });
        self.last_center = center;
        self.next_x += r.spacing;
        self.next_idx += 1;
    }

    fn hits_tower(&self, t: &Tower) -> bool {
        let r = rules();
        let top = t.gap_top();
        let bot = t.gap_bot();
        touches(r.drone_x, self.y, r.drone_r, t.x, 0, r.tower_w, top)
            || touches(r.drone_x, self.y, r.drone_r, t.x, bot, r.tower_w, r.ground_y() - bot)
    }

    fn finish(&mut self) {
        self.s.ended_by = self.over;
        self.s.ticks = self.tick;
        self.s.game_ms = self.tick as u64 * 1000 / 60;
    }

    pub fn quit(&mut self) {
        if self.over.is_none() {
            self.over = Some(End::Quit);
            self.finish();
        }
    }

    /// One tick; `flap` = the player pressed the button on this tick.
    pub fn step(&mut self, flap: bool) {
        if self.over.is_some() {
            return;
        }
        let r = rules();
        if flap {
            self.started = true;
            self.vy = r.flap_v;
            self.s.flaps += 1;
        }
        if self.started {
            self.vy = (self.vy + r.gravity).min(r.max_fall);
            self.y += self.vy;

            let sp = self.speed;
            for t in &mut self.towers {
                t.x -= sp;
                if t.amp > 0 {
                    t.off += t.dir * t.mspeed;
                    if t.off >= t.amp {
                        t.off = t.amp;
                        t.dir = -1;
                    } else if t.off <= -t.amp {
                        t.off = -t.amp;
                        t.dir = 1;
                    }
                }
            }
            for b in &mut self.bars {
                b.x -= sp;
            }
            self.next_x -= sp;
            self.towers.retain(|t| t.x + r.tower_w >= 0);
            self.bars.retain(|b| b.x + r.bars.r >= 0);
            self.spawn();

            for t in &mut self.towers {
                if !t.passed && t.x + r.tower_w < r.drone_x {
                    t.passed = true;
                    self.s.gaps += 1;
                    self.s.score += 1;
                }
            }
            self.speed = (r.speed_start + (self.s.gaps / r.speed_every) as i32 * r.speed_step).min(r.speed_max);

            let reach = (r.drone_r + r.bars.r) as i64;
            let (dx0, y) = (r.drone_x, self.y);
            let before = self.bars.len();
            self.bars.retain(|b| {
                let dx = (b.x - dx0) as i64;
                let dy = (b.y - y) as i64;
                dx * dx + dy * dy > reach * reach
            });
            let got = (before - self.bars.len()) as u32;
            self.s.bars += got;
            self.s.score += got;

            if self.y - r.drone_r <= 0 || self.y + r.drone_r >= r.ground_y() || self.towers.iter().any(|t| self.hits_tower(t)) {
                self.over = Some(End::Crash);
            }
        }
        self.tick += 1;
        if self.over.is_none() && self.tick >= r.max_ticks {
            self.over = Some(End::Time);
        }
        if self.over.is_some() {
            self.finish();
        }
    }
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplayError {
    TooManyInputs,
    Unsorted,
    /// Two flaps on the same tick.
    Duplicate,
    /// A flap after the run was already over.
    AfterEnd,
}

impl ReplayError {
    pub fn message(self) -> &'static str {
        match self {
            ReplayError::TooManyInputs => "too many flaps",
            ReplayError::Unsorted => "flaps are out of order",
            ReplayError::Duplicate => "two flaps in one tick",
            ReplayError::AfterEnd => "flaps after the run ended",
        }
    }
}

/// Plays a whole run from the ticks the player flapped on. The run always
/// ends (a crash or the time cap), or at tick `stop_at` if the player quit.
pub fn replay(seed: u32, flaps: &[u32], stop_at: Option<u32>) -> Result<Summary, ReplayError> {
    let r = rules();
    if flaps.len() > r.max_inputs {
        return Err(ReplayError::TooManyInputs);
    }
    for w in flaps.windows(2) {
        if w[1] == w[0] {
            return Err(ReplayError::Duplicate);
        }
        if w[1] < w[0] {
            return Err(ReplayError::Unsorted);
        }
    }
    let mut g = Game::new(seed);
    let mut i = 0;
    while g.over.is_none() {
        if stop_at.is_some_and(|s| g.tick >= s) {
            g.quit();
            break;
        }
        let flap = i < flaps.len() && flaps[i] == g.tick;
        if flap {
            i += 1;
        }
        g.step(flap);
    }
    if i < flaps.len() {
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

    /// The tower the drone has to get through next.
    fn next_tower(g: &Game) -> Option<&Tower> {
        let r = rules();
        g.towers.iter().find(|t| t.x + r.tower_w > r.drone_x - r.drone_r)
    }

    /// A simple rule: flap when the drone is about to sink too close to the
    /// bottom of the next gap. `safety` is how far above the bottom edge it
    /// tries to stay. Starts the course at tick 30.
    pub fn simple_input(g: &Game, safety: i32) -> bool {
        let r = rules();
        if !g.started {
            return g.tick == 30;
        }
        let floor = match next_tower(g) {
            Some(t) => t.gap_bot() - r.drone_r - safety,
            None => r.ground_y() - r.drone_r - safety,
        };
        g.y + g.vy * 3 > floor && g.vy >= 0
    }

    /// How many ticks a copy of the game lasts (up to `h`) if it plays
    /// `first` now and then follows the simple rule.
    fn lasts(g: &Game, first: bool, h: u32, safety: i32) -> u32 {
        let mut c = g.clone();
        c.step(first);
        let mut n = 1;
        while c.over.is_none() && n < h {
            let f = simple_input(&c, safety);
            c.step(f);
            n += 1;
        }
        if c.over == Some(End::Crash) {
            n
        } else {
            h
        }
    }

    /// The test pilot: the simple rule, but it checks a second ahead and
    /// does the other thing when the rule would crash sooner.
    pub fn pilot_input(g: &Game, safety: i32) -> bool {
        const H: u32 = 70;
        let want = simple_input(g, safety);
        if !g.started {
            return want;
        }
        let a = lasts(g, want, H, safety);
        if a >= H {
            return want;
        }
        let b = lasts(g, !want, H, safety);
        if b > a {
            !want
        } else {
            want
        }
    }


    /// Proves a course can be flown: follows up to `width` different drone
    /// states (height and speed) tick by tick, both flapping and not, and
    /// drops the ones that crash. Returns the flaps of a run that passes
    /// `goal` gaps (it starts flying at tick 30), or `None` if every path
    /// crashes. The course doesn't depend on the drone, so this is exact up
    /// to the beam width.
    pub fn beam_fly(seed: u32, goal: u32, width: usize) -> Option<(Vec<u32>, Summary)> {
        let mut g = Game::new(seed);
        for _ in 0..30 {
            g.step(false);
        }
        let start = g.tick;
        let mut beam = vec![g];
        let mut trail: Vec<Vec<(u32, bool)>> = Vec::new();
        loop {
            let mut next: Vec<(Game, u32, bool)> = Vec::new();
            let mut seen = std::collections::HashSet::new();
            for (pi, g) in beam.iter().enumerate() {
                for f in [false, true] {
                    if !g.started && !f {
                        continue;
                    }
                    let mut c = g.clone();
                    c.step(f);
                    if c.over == Some(End::Crash) || !seen.insert((c.y / 100, c.vy)) {
                        continue;
                    }
                    next.push((c, pi as u32, f));
                }
            }
            if next.is_empty() {
                return None;
            }
            // Keep an even spread: per band of heights (`width` bands), the
            // slowest- and the fastest-falling drone.
            let band = (rules().height / width as i32).max(1);
            let mut best: std::collections::HashMap<i32, (usize, usize)> = std::collections::HashMap::new();
            for (i, (c, _, _)) in next.iter().enumerate() {
                let e = best.entry(c.y / band).or_insert((i, i));
                if c.vy < next[e.0].0.vy {
                    e.0 = i;
                }
                if c.vy > next[e.1].0.vy {
                    e.1 = i;
                }
            }
            let mut keep: Vec<usize> = best.values().flat_map(|&(a, b)| [a, b]).collect();
            keep.sort_unstable();
            keep.dedup();
            let mut k = 0;
            let mut i = 0;
            next.retain(|_| {
                let ok = k < keep.len() && keep[k] == i;
                if ok {
                    k += 1;
                }
                i += 1;
                ok
            });
            trail.push(next.iter().map(|(_, p, f)| (*p, *f)).collect());
            beam = next.into_iter().map(|(c, _, _)| c).collect();
            if beam[0].s.gaps >= goal {
                let mut flaps = Vec::new();
                let mut idx = 0usize;
                for t in (0..trail.len()).rev() {
                    let (p, f) = trail[t][idx];
                    if f {
                        flaps.push(start + t as u32);
                    }
                    idx = p as usize;
                }
                flaps.reverse();
                let stop = beam[0].tick;
                let s = replay(seed, &flaps, Some(stop)).unwrap();
                return Some((flaps, s));
            }
        }
    }

    /// Plays with `input` until the run ends or `max_ticks`, then quits.
    pub fn run_with(seed: u32, max_ticks: u32, input: impl Fn(&Game) -> bool) -> (Vec<u32>, Summary) {
        let mut g = Game::new(seed);
        let mut flaps = Vec::new();
        while g.over.is_none() {
            if g.tick >= max_ticks {
                g.quit();
                break;
            }
            let f = input(&g);
            if f {
                flaps.push(g.tick);
            }
            g.step(f);
        }
        (flaps, g.s)
    }

    #[test]
    fn nothing_moves_before_the_first_flap() {
        let mut g = Game::new(7);
        let x0 = g.towers[0].x;
        for _ in 0..120 {
            g.step(false);
        }
        assert_eq!(g.towers[0].x, x0);
        assert_eq!(g.y, rules().start_y);
        assert!(g.over.is_none());
        g.step(true);
        assert!(g.started);
        assert!(g.towers[0].x < x0);
        assert!(g.y < rules().start_y);
    }

    #[test]
    fn not_flapping_hits_the_ground() {
        let (_, s) = run_with(3, 10_000, |g| g.tick == 0);
        assert_eq!(s.ended_by, Some(End::Crash));
        assert_eq!(s.gaps, 0);
        assert!(s.ticks < 200);
        // and flapping every few ticks hits the ceiling
        let (_, s) = run_with(3, 10_000, |g| g.tick % 4 == 0);
        assert_eq!(s.ended_by, Some(End::Crash));
    }

    #[test]
    fn the_course_stays_inside_the_arena_and_gets_harder() {
        let r = rules();
        let mut g = Game::new(99);
        g.started = true;
        let mut seen = 0;
        // Fly a ghost: keep the drone out of the way and scroll for a long time.
        while g.next_idx < 400 {
            g.y = -100_000;
            g.step(false);
            g.over = None;
            for t in &g.towers {
                assert!(t.gap_top() >= r.margin, "tower {} top {}", t.idx, t.gap_top());
                assert!(t.gap_bot() <= r.ground_y() - r.margin, "tower {} bottom {}", t.idx, t.gap_bot());
                assert!(t.gap >= r.gap_min && t.gap <= r.gap_start);
                if t.amp > 0 {
                    assert!(t.idx >= r.moving.from);
                    seen += 1;
                }
            }
            for b in &g.bars {
                assert!(b.y >= r.margin && b.y <= r.ground_y() - r.margin);
            }
        }
        assert!(seen > 0, "some gaps move");
    }

    #[test]
    fn replay_rejects_bad_flap_lists() {
        assert_eq!(replay(1, &[5, 4], None), Err(ReplayError::Unsorted));
        assert_eq!(replay(1, &[5, 5], None), Err(ReplayError::Duplicate));
        assert_eq!(replay(1, &[5, 9_999_999], None), Err(ReplayError::AfterEnd));
        assert_eq!(replay(1, &vec![0; rules().max_inputs + 1], None), Err(ReplayError::TooManyInputs));
        let s = replay(1, &[], Some(300)).unwrap();
        assert_eq!((s.ended_by, s.ticks, s.score), (Some(End::Quit), 300, 0));
    }

    #[test]
    fn replay_matches_live_play() {
        for seed in [1u32, 2, 3] {
            let (flaps, s) = run_with(seed, 60 * 90, |g| pilot_input(g, 2500));
            let stop = (s.ended_by == Some(End::Quit)).then_some(s.ticks);
            assert_eq!(replay(seed, &flaps, stop).unwrap(), s);
        }
    }

    #[test]
    fn daily_seed_is_its_own() {
        assert_ne!(daily_seed(2026, 11, 26), crate::snake_signal::engine::daily_seed(2026, 11, 26));
        assert_eq!(daily_seed(2026, 11, 26), daily_seed(2026, 11, 26));
    }

    /// Every course can be flown for 500 gaps: no gap is impossible,
    /// including the narrowest moving ones at top speed.
    #[test]
    fn every_course_can_be_flown_500_gaps() {
        for seed in 1..=6u32 {
            let got = beam_fly(seed, 500, 128);
            assert!(got.is_some(), "seed {seed}: no path through 500 gaps");
            let (_, s) = got.unwrap();
            assert!(s.gaps >= 500 && s.ended_by == Some(End::Quit));
        }
    }

    /// Prints how the course grows and how the pilot does:
    /// `cargo test --release flap_print_course -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn flap_print_course() {
        let r = rules();
        let mut g = Game::new(5);
        g.started = true;
        let mut shown = 0;
        while g.next_idx < 120 {
            g.y = -100_000;
            g.step(false);
            g.over = None;
            while shown < g.next_idx {
                let t = g.towers.iter().find(|t| t.idx == shown).unwrap();
                if shown % 5 == 0 {
                    println!("gap {:3}: size {:5} centre {:5} amp {:4} speed {:3}", t.idx, t.gap, t.center, t.amp, t.mspeed);
                }
                shown += 1;
            }
        }
        for seed in 1..=6u32 {
            for (name, safety) in [("simple", 2500), ("pilot", 2500)] {
                let (flaps, s) = run_with(seed, 60 * 60 * 10, |g| if name == "pilot" { pilot_input(g, safety) } else { simple_input(g, safety) });
                println!(
                    "seed {seed} {name}: gaps {} bars {} score {} in {} s, {} flaps",
                    s.gaps,
                    s.bars,
                    s.score,
                    s.ticks / 60,
                    flaps.len()
                );
            }
        }
        for seed in 1..=6u32 {
            let t0 = std::time::Instant::now();
            let got = beam_fly(seed, 500, 128).map(|(f, s)| (f.len(), s.gaps, s.bars, s.ticks / 60));
            println!("seed {seed} beam: {got:?} in {:?}", t0.elapsed());
        }
        println!("ticks per gap at start {}, at top speed {}", r.spacing / r.speed_start, r.spacing / r.speed_max);
    }


    /// Prints shared/flap_vectors.json:
    /// `cargo test --release flap_print_vectors -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn flap_print_vectors() {
        let mut out = Vec::new();
        let mut push = |seed: u32, flaps: Vec<u32>, s: Summary| {
            let stop = (s.ended_by == Some(End::Quit)).then_some(s.ticks);
            assert_eq!(replay(seed, &flaps, stop).unwrap(), s);
            out.push(serde_json::json!({ "seed": seed, "stop_at": stop, "flaps": flaps, "summary": s }));
        };
        // Long pilot runs that quit (they reach moving gaps and top speed).
        let (f, s) = run_with(11, 60 * 60 * 2, |g| pilot_input(g, 2500));
        push(11, f, s);
        // A searched path through 150 gaps: top speed and many moving gaps.
        let (f, s) = beam_fly(22, 150, 128).unwrap();
        push(22, f, s);
        // The simple rule alone: flies a while, then crashes.
        for seed in [33u32, 34] {
            let (f, s) = run_with(seed, u32::MAX, |g| simple_input(g, 1200));
            push(seed, f, s);
        }
        // The pilot, then it gives up after 40 s and falls.
        let (f, s) = run_with(44, u32::MAX, |g| g.tick < 2400 && pilot_input(g, 2500));
        push(44, f, s);
        // Flaps on a beat: hits the ceiling.
        let (f, s) = run_with(55, u32::MAX, |g| g.tick % 6 == 0);
        push(55, f, s);
        // Hovers, never starts, quits.
        let (f, s) = run_with(66, 300, |_| false);
        push(66, f, s);
        println!("{}", serde_json::to_string(&serde_json::json!({ "runs": out })).unwrap());
    }

    #[test]
    fn shared_vectors_match() {
        const V: &str = include_str!("../../../shared/flap_vectors.json");
        let v: serde_json::Value = serde_json::from_str(V).unwrap();
        let runs = v["runs"].as_array().unwrap();
        assert!(runs.len() >= 7);
        for run in runs {
            let seed = run["seed"].as_u64().unwrap() as u32;
            let stop = run["stop_at"].as_u64().map(|x| x as u32);
            let flaps: Vec<u32> = run["flaps"].as_array().unwrap().iter().map(|t| t.as_u64().unwrap() as u32).collect();
            let want: Summary = serde_json::from_value(run["summary"].clone()).unwrap();
            assert_eq!(replay(seed, &flaps, stop).unwrap(), want, "seed {seed}");
        }
    }
}
