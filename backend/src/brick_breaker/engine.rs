//! Brick Breaker rules: a tick-by-tick ball-and-paddle game built from a seed
//! and a brick layout, and the replay that turns the player's paddle inputs
//! into a score.
//!
//! The frontend has a line-for-line copy in `frontend/src/games/brick-breaker/
//! engine.ts`; both read their numbers from `shared/brick_rules.json` and use
//! only integer math (no floats, no trig: bounce directions come from a
//! table), so the same seed, layout and inputs always give the same result.
//! `shared/brick_vectors.json` is checked by both test suites. Change both
//! files together.

use std::collections::VecDeque;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::rng::Rng;

const RULES_JSON: &str = include_str!("../../../shared/brick_rules.json");

#[derive(Debug, Deserialize)]
pub struct Points {
    pub normal: u32,
    pub tough: u32,
    pub explosive: u32,
    pub moving_bonus: u32,
    pub hit: u32,
}

#[derive(Debug, Deserialize)]
pub struct WaveRules {
    pub rows_start: u32,
    pub rows_max: u32,
    pub tough_start: u32,
    pub tough_step: u32,
    pub tough_max: u32,
    pub tough3_from: u32,
    pub steel_from: u32,
    pub steel_pct: u32,
    pub explosive_pct: u32,
    pub moving_from: u32,
    pub moving_speed: i32,
    pub drop_chance: u32,
    pub drop_weights: Vec<u32>,
}

#[derive(Debug, Deserialize)]
pub struct Rules {
    pub width: i32,
    pub height: i32,
    pub cols: i32,
    pub brick_w: i32,
    pub brick_h: i32,
    pub top: i32,
    pub paddle_y: i32,
    pub paddle_h: i32,
    pub paddle_w: i32,
    pub paddle_wide_w: i32,
    pub paddle_speed: i32,
    pub ball_r: i32,
    pub max_step: i32,
    pub angles: Vec<[i32; 2]>,
    pub serve_angle: usize,
    pub serve_hold: u32,
    pub sticky_hold: u32,
    pub speed_start: i32,
    pub speed_step: i32,
    pub speed_every: u32,
    pub speed_max: i32,
    pub wave_speed_step: i32,
    pub slow_pct: i32,
    pub lives: u32,
    pub lives_max: u32,
    pub max_balls: usize,
    pub drop_speed: i32,
    pub drop_w: i32,
    pub drop_h: i32,
    pub drop_points: u32,
    pub wide_ticks: u32,
    pub slow_ticks: u32,
    pub laser_ticks: u32,
    pub sticky_ticks: u32,
    pub laser_cooldown: u32,
    pub laser_speed: i32,
    pub laser_w: i32,
    pub laser_h: i32,
    pub points: Points,
    pub combo_steps: Vec<u32>,
    pub combo_mults: Vec<u32>,
    pub clear_bonus: u32,
    pub life_bonus: u32,
    pub wave_bonus: u32,
    pub stall_ticks: u32,
    pub waves: WaveRules,
    pub max_ticks: u32,
    pub max_inputs: usize,
}

pub fn rules() -> &'static Rules {
    static R: OnceLock<Rules> = OnceLock::new();
    R.get_or_init(|| serde_json::from_str(RULES_JSON).expect("shared/brick_rules.json is valid"))
}

/// Everyone gets the same Daily seed on the same WIB day.
pub fn daily_seed(year: i32, month: u32, day: u32) -> u32 {
    crate::rng::daily_seed(year, month, day, 0x4252_4B31)
}

// ---------------------------------------------------------------------------
// Bricks, drops and layouts
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Kind {
    #[serde(rename = "n")]
    Normal,
    #[serde(rename = "t")]
    Tough,
    #[serde(rename = "s")]
    Steel,
    #[serde(rename = "e")]
    Explosive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Drop {
    Wide,
    Multi,
    Slow,
    Life,
    Laser,
    Sticky,
}

/// In the order of `waves.drop_weights`.
pub const DROPS: [Drop; 6] = [Drop::Wide, Drop::Multi, Drop::Slow, Drop::Life, Drop::Laser, Drop::Sticky];

/// One brick in a layout: column, row, kind, hit points (tough bricks),
/// the drop it holds, and for moving bricks `[min_col, max_col, speed]`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrickSpec {
    pub c: i32,
    pub r: i32,
    pub t: Kind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hp: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub d: Option<Drop>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub m: Option<[i32; 3]>,
}

/// A hand-made Campaign level.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Level {
    pub id: u32,
    pub name: String,
    /// Starting ball speed; the rules' `speed_start` when missing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed: Option<i32>,
    pub bricks: Vec<BrickSpec>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Move {
    pub min_x: i32,
    pub max_x: i32,
    pub speed: i32,
    pub dir: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Brick {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub kind: Kind,
    pub hp: u32,
    pub max_hp: u32,
    pub drop: Option<Drop>,
    pub mv: Option<Move>,
    pub alive: bool,
}

pub fn build(specs: &[BrickSpec]) -> Vec<Brick> {
    let r = rules();
    specs
        .iter()
        .map(|s| {
            let hp = match s.t {
                Kind::Tough => s.hp.unwrap_or(2).clamp(2, 3),
                _ => 1,
            };
            Brick {
                x: s.c * r.brick_w,
                y: r.top + s.r * r.brick_h,
                w: r.brick_w,
                h: r.brick_h,
                kind: s.t,
                hp,
                max_hp: hp,
                drop: if s.t == Kind::Steel { None } else { s.d },
                mv: s.m.map(|m| Move { min_x: m[0] * r.brick_w, max_x: m[1] * r.brick_w, speed: m[2], dir: 1 }),
                alive: true,
            }
        })
        .collect()
}

fn pick_drop(rng: &mut Rng) -> Drop {
    let w = &rules().waves.drop_weights;
    let total: u32 = w.iter().sum();
    let mut x = rng.below(total);
    for (i, &wt) in w.iter().enumerate() {
        if x < wt {
            return DROPS[i];
        }
        x -= wt;
    }
    DROPS[0]
}

/// The wall for Endless / Daily wave `wave` (1-based). Harder every wave:
/// more rows, more tough bricks, then steel, then moving rows.
pub fn wave_layout(rng: &mut Rng, wave: u32) -> Vec<BrickSpec> {
    let r = rules();
    let w = &r.waves;
    let rows = (w.rows_start + (wave - 1) / 2).min(w.rows_max) as i32;
    let tough = (w.tough_start + (wave - 1) * w.tough_step).min(w.tough_max);
    let steel = if wave >= w.steel_from { w.steel_pct } else { 0 };
    let expl = steel + w.explosive_pct;
    let tough = expl + tough;
    let mut out = Vec::new();
    for row in 0..rows {
        if wave >= w.moving_from && row == rows - 1 && rng.below(2) == 0 {
            let half = r.cols / 2;
            for lane in 0..2 {
                let lo = lane * half;
                let t = if rng.below(2) == 0 { Kind::Tough } else { Kind::Normal };
                let d = if rng.below(100) < w.drop_chance { Some(pick_drop(rng)) } else { None };
                out.push(BrickSpec {
                    c: lo,
                    r: row,
                    t,
                    hp: if t == Kind::Tough { Some(2) } else { None },
                    d,
                    m: Some([lo, lo + half - 1, w.moving_speed]),
                });
            }
            continue;
        }
        let pattern = rng.below(4);
        for c in 0..r.cols {
            let keep = match pattern {
                0 => true,
                1 => (c + row) % 2 == 0,
                2 => rng.below(5) != 0,
                _ => (2..r.cols - 2).contains(&c),
            };
            if !keep {
                continue;
            }
            let roll = rng.below(100);
            let t = if roll < steel {
                Kind::Steel
            } else if roll < expl {
                Kind::Explosive
            } else if roll < tough {
                Kind::Tough
            } else {
                Kind::Normal
            };
            let hp = if t == Kind::Tough {
                Some(if wave >= w.tough3_from && rng.below(3) == 0 { 3 } else { 2 })
            } else {
                None
            };
            let d = if t != Kind::Steel && rng.below(100) < w.drop_chance { Some(pick_drop(rng)) } else { None };
            out.push(BrickSpec { c, r: row, t, hp, d, m: None });
        }
    }
    if !out.iter().any(|b| b.t != Kind::Steel) {
        out.push(BrickSpec { c: r.cols / 2, r: 0, t: Kind::Normal, hp: None, d: None, m: None });
    }
    out
}

// ---------------------------------------------------------------------------
// Pieces in play
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stuck {
    /// Ball x minus paddle x.
    pub off: i32,
    /// Ticks until it launches by itself.
    pub hold: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ball {
    pub x: i32,
    pub y: i32,
    /// Index into `rules().angles`.
    pub a: usize,
    pub sx: i32,
    pub sy: i32,
    pub stuck: Option<Stuck>,
    pub dead: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Falling {
    pub kind: Drop,
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bolt {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum End {
    /// Every breakable brick of a Campaign level is gone.
    Clear,
    /// No lives left.
    Out,
    /// Hit the `max_ticks` cap.
    Time,
    Quit,
}

impl End {
    pub fn as_str(self) -> &'static str {
        match self {
            End::Clear => "clear",
            End::Out => "out",
            End::Time => "time",
            End::Quit => "quit",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Summary {
    pub score: u32,
    /// Bricks broken (steel never breaks).
    pub bricks: u32,
    pub cleared: bool,
    /// Campaign: lives left when cleared (1..=3), else 0.
    pub stars: u32,
    pub lives: u32,
    /// Endless / Daily: the wave you reached (1-based). Campaign: 1.
    pub wave: u32,
    pub best_combo: u32,
    /// Most bricks broken by one explosion chain.
    pub best_chain: u32,
    pub drops: u32,
    /// Lives lost.
    pub lost: u32,
    pub ticks: u32,
    pub ended_by: Option<End>,
    pub game_ms: u64,
}

#[derive(Clone)]
pub struct Game {
    pub rng: Rng,
    /// Endless / Daily (waves) rather than a Campaign level.
    pub waves: bool,
    pub tick: u32,
    pub bricks: Vec<Brick>,
    pub balls: Vec<Ball>,
    pub drops: Vec<Falling>,
    pub bolts: Vec<Bolt>,
    pub paddle_x: i32,
    pub target: i32,
    pub lives: u32,
    pub base_speed: i32,
    pub speed: i32,
    pub paddle_hits: u32,
    pub wide: u32,
    pub slow: u32,
    pub laser: u32,
    pub sticky: u32,
    pub cooldown: u32,
    pub combo: u32,
    pub stall: u32,
    pub over: Option<End>,
    pub s: Summary,
}

#[allow(clippy::too_many_arguments)]
fn overlap(ax: i32, ay: i32, aw: i32, ah: i32, bx: i32, by: i32, bw: i32, bh: i32) -> bool {
    ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
}

impl Game {
    /// A Campaign level, or Endless / Daily waves when `level` is `None`.
    pub fn new(seed: u32, level: Option<&Level>) -> Game {
        let r = rules();
        let mut rng = Rng::new(seed);
        let (bricks, base_speed) = match level {
            Some(l) => (build(&l.bricks), l.speed.unwrap_or(r.speed_start)),
            None => (build(&wave_layout(&mut rng, 1)), r.speed_start),
        };
        let mut g = Game {
            rng,
            waves: level.is_none(),
            tick: 0,
            bricks,
            balls: Vec::new(),
            drops: Vec::new(),
            bolts: Vec::new(),
            paddle_x: r.width / 2,
            target: r.width / 2,
            lives: r.lives,
            base_speed,
            speed: base_speed,
            paddle_hits: 0,
            wide: 0,
            slow: 0,
            laser: 0,
            sticky: 0,
            cooldown: 0,
            combo: 0,
            stall: 0,
            over: None,
            s: Summary {
                score: 0,
                bricks: 0,
                cleared: false,
                stars: 0,
                lives: r.lives,
                wave: 1,
                best_combo: 0,
                best_chain: 0,
                drops: 0,
                lost: 0,
                ticks: 0,
                ended_by: None,
                game_ms: 0,
            },
        };
        g.serve();
        g
    }

    pub fn paddle_w(&self) -> i32 {
        let r = rules();
        if self.wide > 0 {
            r.paddle_wide_w
        } else {
            r.paddle_w
        }
    }

    pub fn cur_speed(&self) -> i32 {
        if self.slow > 0 {
            self.speed * rules().slow_pct / 100
        } else {
            self.speed
        }
    }

    /// Velocity per tick of a free ball.
    pub fn vel(&self, b: &Ball) -> (i32, i32) {
        let a = rules().angles[b.a];
        let sp = self.cur_speed();
        (b.sx * (a[0] * sp / 1000), b.sy * (a[1] * sp / 1000))
    }

    fn mult(&self) -> u32 {
        let r = rules();
        let mut m = r.combo_mults[0];
        for (i, &st) in r.combo_steps.iter().enumerate() {
            if self.combo >= st {
                m = r.combo_mults[i];
            }
        }
        m
    }

    fn serve(&mut self) {
        let r = rules();
        self.balls = vec![Ball {
            x: self.paddle_x,
            y: r.paddle_y - r.ball_r,
            a: r.serve_angle,
            sx: 1,
            sy: -1,
            stuck: Some(Stuck { off: 0, hold: r.serve_hold }),
            dead: false,
        }];
    }

    fn clamp_paddle(&self, x: i32) -> i32 {
        let half = self.paddle_w() / 2;
        x.clamp(half, rules().width - half)
    }

    /// Breaks brick `j` for sure (not steel): points, combo, its drop.
    /// Returns whether it was explosive.
    fn destroy(&mut self, j: usize) -> bool {
        let r = rules();
        let b = &mut self.bricks[j];
        b.alive = false;
        b.hp = 0;
        let kind = b.kind;
        let moving = b.mv.is_some();
        let drop = b.drop;
        let (cx, cy) = (b.x + b.w / 2, b.y + b.h / 2);
        self.s.bricks += 1;
        self.stall = 0;
        self.combo += 1;
        self.s.best_combo = self.s.best_combo.max(self.combo);
        let mut base = match kind {
            Kind::Tough => r.points.tough,
            Kind::Explosive => r.points.explosive,
            _ => r.points.normal,
        };
        if moving {
            base += r.points.moving_bonus;
        }
        self.s.score += base * self.mult();
        if let Some(d) = drop {
            self.drops.push(Falling { kind: d, x: cx, y: cy });
        }
        kind == Kind::Explosive
    }

    /// Breaks every non-steel brick next to brick `j`, and next to every
    /// explosive brick that goes off in turn.
    fn explode(&mut self, j: usize) {
        let mut queue = VecDeque::from([j]);
        let mut chain = 0;
        while let Some(k) = queue.pop_front() {
            let b = &self.bricks[k];
            let (ex, ey, ew, eh) = (b.x - b.w / 2, b.y - b.h / 2, b.w * 2, b.h * 2);
            for m in 0..self.bricks.len() {
                let o = &self.bricks[m];
                if !o.alive || o.kind == Kind::Steel || !overlap(ex, ey, ew, eh, o.x, o.y, o.w, o.h) {
                    continue;
                }
                chain += 1;
                if self.destroy(m) {
                    queue.push_back(m);
                }
            }
        }
        self.s.best_chain = self.s.best_chain.max(chain);
    }

    fn hit_brick(&mut self, j: usize) {
        if self.bricks[j].kind == Kind::Steel {
            return;
        }
        self.bricks[j].hp -= 1;
        if self.bricks[j].hp == 0 {
            if self.destroy(j) {
                self.explode(j);
            }
        } else {
            self.s.score += rules().points.hit;
        }
    }

    /// Alive bricks the ball (as a square) overlaps.
    fn touching(&self, b: &Ball) -> Vec<usize> {
        let rr = rules().ball_r;
        (0..self.bricks.len())
            .filter(|&j| {
                let o = &self.bricks[j];
                o.alive && overlap(b.x - rr, b.y - rr, rr * 2, rr * 2, o.x, o.y, o.w, o.h)
            })
            .collect()
    }

    fn ball_x(&mut self, i: usize, dx: i32) {
        if dx == 0 {
            return;
        }
        let r = rules();
        let rr = r.ball_r;
        self.balls[i].x += dx;
        let b = self.balls[i];
        let hits: Vec<usize> = self
            .touching(&b)
            .into_iter()
            .filter(|&j| {
                let cx = self.bricks[j].x + self.bricks[j].w / 2;
                (dx > 0 && b.x < cx) || (dx < 0 && b.x > cx)
            })
            .collect();
        if !hits.is_empty() {
            if dx > 0 {
                let edge = hits.iter().map(|&j| self.bricks[j].x).min().unwrap();
                self.balls[i].x = edge - rr;
                self.balls[i].sx = -1;
            } else {
                let edge = hits.iter().map(|&j| self.bricks[j].x + self.bricks[j].w).max().unwrap();
                self.balls[i].x = edge + rr;
                self.balls[i].sx = 1;
            }
            for j in hits {
                self.hit_brick(j);
            }
        }
        let b = &mut self.balls[i];
        if b.x - rr < 0 {
            b.x = rr;
            b.sx = 1;
        } else if b.x + rr > r.width {
            b.x = r.width - rr;
            b.sx = -1;
        }
    }

    /// Moves ball `i` up or down; returns true when it got stuck on the paddle.
    fn ball_y(&mut self, i: usize, dy: i32) -> bool {
        if dy == 0 {
            return false;
        }
        let r = rules();
        let rr = r.ball_r;
        self.balls[i].y += dy;
        let b = self.balls[i];
        let hits: Vec<usize> = self
            .touching(&b)
            .into_iter()
            .filter(|&j| {
                let cy = self.bricks[j].y + self.bricks[j].h / 2;
                (dy > 0 && b.y < cy) || (dy < 0 && b.y > cy)
            })
            .collect();
        if !hits.is_empty() {
            if dy > 0 {
                let edge = hits.iter().map(|&j| self.bricks[j].y).min().unwrap();
                self.balls[i].y = edge - rr;
                self.balls[i].sy = -1;
            } else {
                let edge = hits.iter().map(|&j| self.bricks[j].y + self.bricks[j].h).max().unwrap();
                self.balls[i].y = edge + rr;
                self.balls[i].sy = 1;
            }
            for j in hits {
                self.hit_brick(j);
            }
        }
        if self.balls[i].y - rr < 0 {
            self.balls[i].y = rr;
            self.balls[i].sy = 1;
        }
        // The paddle.
        let b = self.balls[i];
        let pw = self.paddle_w();
        let px = self.paddle_x - pw / 2;
        if dy > 0
            && b.y <= r.paddle_y + r.paddle_h / 2
            && overlap(b.x - rr, b.y - rr, rr * 2, rr * 2, px, r.paddle_y, pw, r.paddle_h)
        {
            let off = b.x - self.paddle_x;
            let n = r.angles.len() as i32;
            let a = (off.abs() * n / (pw / 2 + rr)).min(n - 1) as usize;
            let sx = if off > 0 {
                1
            } else if off < 0 {
                -1
            } else {
                b.sx
            };
            let ball = &mut self.balls[i];
            ball.a = a;
            ball.sx = sx;
            ball.sy = -1;
            ball.y = r.paddle_y - rr;
            self.combo = 0;
            self.stall = 0;
            self.paddle_hits += 1;
            if self.paddle_hits.is_multiple_of(r.speed_every) {
                self.speed = (self.speed + r.speed_step).min(r.speed_max);
            }
            if self.sticky > 0 {
                let half = pw / 2;
                self.balls[i].stuck = Some(Stuck { off: off.clamp(-half, half), hold: r.sticky_hold });
                return true;
            }
        }
        if self.balls[i].y - rr > r.height {
            self.balls[i].dead = true;
            return true;
        }
        false
    }

    fn move_ball(&mut self, i: usize) {
        let r = rules();
        let (vx, vy) = self.vel(&self.balls[i]);
        let n = 1 + vx.abs().max(vy.abs()) / r.max_step;
        for k in 0..n {
            let (vx, vy) = self.vel(&self.balls[i]);
            let dx = vx * (k + 1) / n - vx * k / n;
            let dy = vy * (k + 1) / n - vy * k / n;
            self.ball_x(i, dx);
            if self.ball_y(i, dy) {
                break;
            }
        }
    }

    fn apply(&mut self, d: Drop) {
        let r = rules();
        self.s.drops += 1;
        self.s.score += r.drop_points;
        match d {
            Drop::Wide => self.wide = r.wide_ticks,
            Drop::Slow => self.slow = r.slow_ticks,
            Drop::Life => self.lives = (self.lives + 1).min(r.lives_max),
            Drop::Laser => self.laser = r.laser_ticks,
            Drop::Sticky => self.sticky = r.sticky_ticks,
            Drop::Multi => {
                let src = self.balls.iter().find(|b| b.stuck.is_none()).or(self.balls.first()).copied();
                if let Some(b) = src {
                    let top = r.angles.len() - 1;
                    for (a, sx) in [((b.a + 2).min(top), b.sx), (b.a.saturating_sub(2), -b.sx)] {
                        if self.balls.len() < r.max_balls {
                            let sy = if b.stuck.is_some() { -1 } else { b.sy };
                            self.balls.push(Ball { x: b.x, y: b.y, a, sx, sy, stuck: None, dead: false });
                        }
                    }
                }
            }
        }
    }

    fn lose_life(&mut self) {
        self.s.lost += 1;
        self.lives -= 1;
        if self.lives == 0 {
            self.over = Some(End::Out);
            return;
        }
        self.wide = 0;
        self.slow = 0;
        self.laser = 0;
        self.sticky = 0;
        self.cooldown = 0;
        self.drops.clear();
        self.bolts.clear();
        self.speed = self.base_speed;
        self.paddle_hits = 0;
        self.combo = 0;
        self.stall = 0;
        self.paddle_x = self.clamp_paddle(self.paddle_x);
        self.serve();
    }

    fn next_wave(&mut self) {
        let r = rules();
        self.s.score += r.wave_bonus * self.s.wave;
        self.s.wave += 1;
        let specs = wave_layout(&mut self.rng, self.s.wave);
        self.bricks = build(&specs);
        self.drops.clear();
        self.bolts.clear();
        self.base_speed = (r.speed_start + (self.s.wave as i32 - 1) * r.wave_speed_step).min(r.speed_max);
        self.speed = self.base_speed;
        self.paddle_hits = 0;
        self.combo = 0;
        self.stall = 0;
        self.serve();
    }

    fn finish(&mut self) {
        self.s.ended_by = self.over;
        self.s.ticks = self.tick;
        self.s.game_ms = self.tick as u64 * 1000 / 60;
        self.s.lives = self.lives;
    }

    pub fn quit(&mut self) {
        if self.over.is_none() {
            self.over = Some(End::Quit);
            self.finish();
        }
    }

    /// One tick. `target` = where the player wants the paddle (arena x),
    /// `launch` releases stuck balls, `fire` shoots the laser.
    pub fn step(&mut self, target: Option<i32>, launch: bool, fire: bool) {
        if self.over.is_some() {
            return;
        }
        let r = rules();
        self.wide = self.wide.saturating_sub(1);
        self.slow = self.slow.saturating_sub(1);
        self.laser = self.laser.saturating_sub(1);
        self.sticky = self.sticky.saturating_sub(1);
        self.cooldown = self.cooldown.saturating_sub(1);

        // Paddle.
        if let Some(t) = target {
            self.target = t;
        }
        let goal = self.clamp_paddle(self.target);
        let d = (goal - self.paddle_x).clamp(-r.paddle_speed, r.paddle_speed);
        self.paddle_x = self.clamp_paddle(self.paddle_x + d);

        // Laser.
        if fire && self.laser > 0 && self.cooldown == 0 {
            let off = self.paddle_w() / 2 - r.ball_r;
            self.bolts.push(Bolt { x: self.paddle_x - off, y: r.paddle_y });
            self.bolts.push(Bolt { x: self.paddle_x + off, y: r.paddle_y });
            self.cooldown = r.laser_cooldown;
        }

        // Moving bricks.
        for b in self.bricks.iter_mut() {
            if let (true, Some(m)) = (b.alive, b.mv.as_mut()) {
                b.x += m.dir * m.speed;
                if b.x >= m.max_x {
                    b.x = m.max_x;
                    m.dir = -1;
                } else if b.x <= m.min_x {
                    b.x = m.min_x;
                    m.dir = 1;
                }
            }
        }

        // Balls stuck on the paddle ride along, then launch.
        let half = self.paddle_w() / 2;
        for b in self.balls.iter_mut() {
            if let Some(st) = b.stuck.as_mut() {
                st.off = st.off.clamp(-half, half);
                b.x = (self.paddle_x + st.off).clamp(r.ball_r, r.width - r.ball_r);
                b.y = r.paddle_y - r.ball_r;
                st.hold = st.hold.saturating_sub(1);
                if launch || st.hold == 0 {
                    b.stuck = None;
                }
            }
        }

        // Free balls.
        let mut free = false;
        for i in 0..self.balls.len() {
            if self.balls[i].stuck.is_none() && !self.balls[i].dead {
                free = true;
                self.move_ball(i);
            }
        }
        self.balls.retain(|b| !b.dead);

        // Drops fall; catch them with the paddle.
        let pw = self.paddle_w();
        let px = self.paddle_x - pw / 2;
        let mut caught = Vec::new();
        self.drops.retain_mut(|d| {
            d.y += r.drop_speed;
            if overlap(d.x - r.drop_w / 2, d.y - r.drop_h / 2, r.drop_w, r.drop_h, px, r.paddle_y, pw, r.paddle_h) {
                caught.push(d.kind);
                return false;
            }
            d.y - r.drop_h / 2 <= r.height
        });
        for d in caught {
            self.apply(d);
        }

        // Laser bolts hit the lowest brick in their path.
        let mut i = 0;
        while i < self.bolts.len() {
            let bo = self.bolts[i];
            let ny = bo.y - r.laser_speed;
            let span = r.laser_speed + r.laser_h;
            let mut best: Option<usize> = None;
            for j in 0..self.bricks.len() {
                let o = &self.bricks[j];
                if o.alive
                    && overlap(bo.x - r.laser_w / 2, ny, r.laser_w, span, o.x, o.y, o.w, o.h)
                    && best.is_none_or(|k| o.y + o.h > self.bricks[k].y + self.bricks[k].h)
                {
                    best = Some(j);
                }
            }
            if let Some(j) = best {
                self.hit_brick(j);
                self.bolts.remove(i);
                continue;
            }
            if ny + r.laser_h < 0 {
                self.bolts.remove(i);
                continue;
            }
            self.bolts[i].y = ny;
            i += 1;
        }

        // A ball that never reaches the paddle or a brick gets nudged.
        if free {
            self.stall += 1;
            if self.stall >= r.stall_ticks {
                let top = r.angles.len() - 1;
                for b in self.balls.iter_mut().filter(|b| b.stuck.is_none()) {
                    b.a = if b.a < top { b.a + 1 } else { b.a - 1 };
                }
                self.stall = 0;
            }
        }

        if !self.bricks.iter().any(|b| b.alive && b.kind != Kind::Steel) {
            if self.waves {
                self.next_wave();
            } else {
                self.s.cleared = true;
                self.s.stars = self.lives.min(3);
                self.s.score += r.clear_bonus + r.life_bonus * self.s.stars;
                self.over = Some(End::Clear);
            }
        } else if self.balls.is_empty() {
            self.lose_life();
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

/// One input: at `tick`, either a paddle target x (0..=width) or an action.
pub type Input = (u32, i32);
pub const LAUNCH: i32 = -1;
pub const FIRE: i32 = -2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplayError {
    TooManyInputs,
    Unsorted,
    BadInput,
    /// Two targets, two launches or two shots on the same tick.
    Duplicate,
    /// An input after the run was already over.
    AfterEnd,
}

impl ReplayError {
    pub fn message(self) -> &'static str {
        match self {
            ReplayError::TooManyInputs => "too many inputs",
            ReplayError::Unsorted => "inputs are out of order",
            ReplayError::BadInput => "unknown input",
            ReplayError::Duplicate => "the same input twice in one tick",
            ReplayError::AfterEnd => "inputs after the run ended",
        }
    }
}

/// Plays a whole run (a Campaign `level`, or waves when `None`); the run
/// always ends (cleared, out of lives or the time cap), or at tick `stop_at`
/// if the player quit there.
pub fn replay(seed: u32, level: Option<&Level>, inputs: &[Input], stop_at: Option<u32>) -> Result<Summary, ReplayError> {
    let r = rules();
    if inputs.len() > r.max_inputs {
        return Err(ReplayError::TooManyInputs);
    }
    if inputs.windows(2).any(|w| w[1].0 < w[0].0) {
        return Err(ReplayError::Unsorted);
    }
    if inputs.iter().any(|&(_, v)| v < FIRE || v > r.width) {
        return Err(ReplayError::BadInput);
    }
    let mut g = Game::new(seed, level);
    let mut i = 0;
    while g.over.is_none() {
        if stop_at.is_some_and(|s| g.tick >= s) {
            g.quit();
            break;
        }
        let (mut target, mut launch, mut fire) = (None, false, false);
        while i < inputs.len() && inputs[i].0 == g.tick {
            match inputs[i].1 {
                LAUNCH if launch => return Err(ReplayError::Duplicate),
                LAUNCH => launch = true,
                FIRE if fire => return Err(ReplayError::Duplicate),
                FIRE => fire = true,
                _ if target.is_some() => return Err(ReplayError::Duplicate),
                x => target = Some(x),
            }
            i += 1;
        }
        g.step(target, launch, fire);
    }
    if i < inputs.len() {
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

    /// A simple test bot: keeps the paddle under the lowest falling ball
    /// (aiming a little off-centre to vary the bounce; `style` shifts the
    /// pattern), chases drops while
    /// every ball is going up, launches soon and fires whenever it can.
    /// Deterministic, so its runs make good shared test vectors.
    pub fn bot_input(g: &Game, style: u32) -> (Option<i32>, bool, bool) {
        let r = rules();
        let aim = (((g.tick / 211 + style) % 5) as i32 - 2) * 1500;
        let falling = g.balls.iter().filter(|b| b.stuck.is_none() && b.sy > 0).max_by_key(|b| b.y);
        let want = if let Some(b) = falling {
            Some(b.x + aim)
        } else if let Some(d) = g.drops.iter().max_by_key(|d| d.y) {
            Some(d.x)
        } else {
            g.balls.iter().find(|b| b.stuck.is_none()).map(|b| b.x)
        };
        let target = want.map(|x| (x.clamp(0, r.width) / 100) * 100).filter(|&x| x != g.target);
        let launch = g.balls.iter().any(|b| b.stuck.is_some()) && g.tick.is_multiple_of(7);
        let fire = g.laser > 0 && g.cooldown == 0;
        (target, launch, fire)
    }

    pub fn bot_run(seed: u32, level: Option<&Level>, max_ticks: u32) -> (Vec<Input>, Summary) {
        let mut g = Game::new(seed, level);
        let mut inputs = Vec::new();
        while g.over.is_none() {
            if g.tick >= max_ticks {
                g.quit();
                break;
            }
            let (t, l, f) = bot_input(&g, seed % 5);
            if let Some(x) = t {
                inputs.push((g.tick, x));
            }
            if l {
                inputs.push((g.tick, LAUNCH));
            }
            if f {
                inputs.push((g.tick, FIRE));
            }
            g.step(t, l, f);
        }
        (inputs, g.s)
    }

    fn b(c: i32, r: i32, t: Kind) -> BrickSpec {
        BrickSpec { c, r, t, hp: None, d: None, m: None }
    }

    /// Test layouts. The real 24 levels live in `shared/brick_levels.json`.
    pub fn test_levels() -> Vec<Level> {
        let mut rows = Vec::new();
        for c in 0..12 {
            rows.push(b(c, 0, Kind::Normal));
            rows.push(b(c, 1, Kind::Normal));
        }
        let simple = Level { id: 901, name: "Two Rows".into(), speed: None, bricks: rows };

        let mut all = Vec::new();
        for c in 0..12 {
            let t = if c % 4 == 0 { Kind::Steel } else { Kind::Tough };
            all.push(BrickSpec { hp: if t == Kind::Tough { Some(2 + (c % 2) as u32) } else { None }, ..b(c, 0, t) });
        }
        // An explosive cluster.
        for c in 3..9 {
            all.push(b(c, 2, if c == 5 { Kind::Explosive } else { Kind::Normal }));
            all.push(b(c, 3, if c == 6 { Kind::Explosive } else { Kind::Normal }));
        }
        // One drop of every kind.
        for (i, d) in DROPS.iter().enumerate() {
            all.push(BrickSpec { d: Some(*d), ..b(i as i32 * 2, 5, Kind::Normal) });
        }
        // A moving lane.
        all.push(BrickSpec { m: Some([0, 5, 60]), ..b(0, 7, Kind::Normal) });
        all.push(BrickSpec { hp: Some(2), m: Some([6, 11, 45]), ..b(6, 7, Kind::Tough) });
        let mixed = Level { id: 902, name: "Everything".into(), speed: Some(760), bricks: all };
        vec![simple, mixed]
    }

    #[test]
    fn rules_load() {
        let r = rules();
        assert_eq!(r.angles.len(), 8);
        assert_eq!(r.waves.drop_weights.len(), DROPS.len());
        assert_eq!(r.width / r.brick_w, r.cols);
        // A sub-step never moves further than half a brick.
        assert!(r.max_step * 2 <= r.brick_h);
        // The paddle outruns the fastest sideways ball.
        assert!(r.paddle_speed > r.angles[7][0] * r.speed_max / 1000);
    }

    #[test]
    fn doing_nothing_loses_three_balls() {
        let lv = &test_levels()[0];
        let s = replay(1, Some(lv), &[], None).unwrap();
        assert_eq!(s.ended_by, Some(End::Out));
        assert_eq!(s.lost, 3);
        assert_eq!(s.lives, 0);
        assert!(!s.cleared);
        assert!(s.bricks > 0, "the served balls still hit bricks on the way: {s:?}");
    }

    #[test]
    fn the_bot_clears_the_test_levels_with_three_stars() {
        for lv in test_levels() {
            for seed in 1..4u32 {
                let (inputs, s) = bot_run(seed, Some(&lv), u32::MAX);
                assert!(s.cleared, "level {} seed {seed}: {s:?}", lv.id);
                assert_eq!(s.ended_by, Some(End::Clear));
                assert_eq!(s.stars, s.lives.min(3));
                assert_eq!(replay(seed, Some(&lv), &inputs, None).unwrap(), s);
            }
        }
    }

    #[test]
    fn every_brick_kind_and_drop_shows_up() {
        let lv = &test_levels()[1];
        let (_, s) = bot_run(2, Some(lv), u32::MAX);
        assert!(s.cleared, "{s:?}");
        let breakable = lv.bricks.iter().filter(|b| b.t != Kind::Steel).count() as u32;
        assert_eq!(s.bricks, breakable);
        assert!(s.best_chain >= 2, "{s:?}");
        assert!(s.drops >= 1, "{s:?}");
    }

    #[test]
    fn steel_never_breaks_and_tough_takes_hits() {
        let lv = &test_levels()[1];
        let mut g = Game::new(3, Some(lv));
        let steel = g.bricks.iter().position(|b| b.kind == Kind::Steel).unwrap();
        g.hit_brick(steel);
        assert!(g.bricks[steel].alive);
        let tough = g.bricks.iter().position(|b| b.kind == Kind::Tough && b.max_hp == 3).unwrap();
        g.hit_brick(tough);
        g.hit_brick(tough);
        assert!(g.bricks[tough].alive);
        assert_eq!(g.bricks[tough].hp, 1);
        assert_eq!(g.s.score, 2 * rules().points.hit);
        g.hit_brick(tough);
        assert!(!g.bricks[tough].alive);
    }

    #[test]
    fn explosions_chain() {
        let lv = &test_levels()[1];
        let mut g = Game::new(3, Some(lv));
        let e = g.bricks.iter().position(|b| b.kind == Kind::Explosive).unwrap();
        g.hit_brick(e);
        // Both explosive bricks go off and take their whole neighbourhood.
        assert!(g.bricks.iter().filter(|b| b.kind == Kind::Explosive).all(|b| !b.alive));
        assert!(g.s.best_chain >= 6, "{:?}", g.s);
        assert!(g.bricks.iter().filter(|b| b.kind == Kind::Steel).all(|b| b.alive));
    }

    #[test]
    fn drops_do_what_they_say() {
        let lv = &test_levels()[0];
        let mut g = Game::new(1, Some(lv));
        g.apply(Drop::Wide);
        assert_eq!(g.paddle_w(), rules().paddle_wide_w);
        g.apply(Drop::Life);
        assert_eq!(g.lives, 4);
        g.apply(Drop::Multi);
        assert_eq!(g.balls.len(), 3);
        g.apply(Drop::Slow);
        assert!(g.cur_speed() < g.speed);
        g.apply(Drop::Laser);
        g.step(None, true, true);
        assert_eq!(g.bolts.len(), 2);
        g.apply(Drop::Sticky);
        assert_eq!(g.s.drops, 6);
        for _ in 0..rules().wide_ticks {
            g.step(None, false, false);
        }
        assert_eq!(g.paddle_w(), rules().paddle_w);
    }

    #[test]
    fn the_paddle_cannot_teleport() {
        let lv = &test_levels()[0];
        let mut g = Game::new(1, Some(lv));
        let x0 = g.paddle_x;
        g.step(Some(0), false, false);
        assert_eq!(g.paddle_x, x0 - rules().paddle_speed);
    }

    #[test]
    fn waves_get_harder_and_keep_going() {
        let (inputs, s) = bot_run(7, None, 60 * 60 * 6);
        assert!(s.wave >= 3, "{s:?}");
        assert_eq!(replay(7, None, &inputs, Some(60 * 60 * 6)).unwrap(), s);
        let mut rng = Rng::new(1);
        let w1 = wave_layout(&mut rng, 1);
        let w9 = wave_layout(&mut rng, 9);
        assert!(w9.len() > w1.len());
        assert!(w1.iter().all(|b| b.t != Kind::Steel && b.m.is_none()));
        assert!(w9.iter().any(|b| b.t == Kind::Tough));
    }

    #[test]
    fn bad_input_lists_are_rejected() {
        let lv = &test_levels()[0];
        assert_eq!(replay(1, Some(lv), &[(5, 100), (4, 200)], None), Err(ReplayError::Unsorted));
        assert_eq!(replay(1, Some(lv), &[(5, 100), (5, 200)], None), Err(ReplayError::Duplicate));
        assert_eq!(replay(1, Some(lv), &[(5, LAUNCH), (5, LAUNCH)], None), Err(ReplayError::Duplicate));
        assert_eq!(replay(1, Some(lv), &[(5, -3)], None), Err(ReplayError::BadInput));
        assert_eq!(replay(1, Some(lv), &[(5, rules().width + 1)], None), Err(ReplayError::BadInput));
        assert_eq!(replay(1, Some(lv), &[(999_999, 100)], None), Err(ReplayError::AfterEnd));
        // A target, a launch and a shot on the same tick are fine.
        assert!(replay(1, Some(lv), &[(5, 100), (5, LAUNCH), (5, FIRE)], None).is_ok());
    }

    #[test]
    fn quitting_banks_the_points_so_far() {
        let (inputs, _) = bot_run(11, None, 3000);
        let s = replay(11, None, &inputs, Some(3000)).unwrap();
        assert_eq!(s.ended_by, Some(End::Quit));
        assert_eq!(s.ticks, 3000);
        assert!(s.score > 0);
        assert_eq!(replay(1, None, &[(5, 100)], Some(5)), Err(ReplayError::AfterEnd));
        assert_eq!(replay(1, None, &[], Some(0)).unwrap().score, 0);
    }

    /// `cargo test --release brick_print_waves -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn brick_print_waves() {
        let mut rng = Rng::new(5);
        for wave in 1..=14 {
            let l = wave_layout(&mut rng, wave);
            let count = |k: Kind| l.iter().filter(|b| b.t == k).count();
            println!(
                "wave {wave:>2}: {:>3} bricks  tough {:>2} steel {:>2} expl {:>2} moving {} drops {:>2}",
                l.len(),
                count(Kind::Tough),
                count(Kind::Steel),
                count(Kind::Explosive),
                l.iter().filter(|b| b.m.is_some()).count(),
                l.iter().filter(|b| b.d.is_some()).count()
            );
        }
        for seed in 1..=4u32 {
            let mut g = Game::new(seed, None);
            let mut at = vec![0u32];
            while g.over.is_none() && g.tick < 60 * 60 * 20 {
                let w = g.s.wave;
                let (t, l, f) = bot_input(&g, seed);
                g.step(t, l, f);
                if g.s.wave != w {
                    at.push(g.tick / 60);
                }
            }
            let gaps: Vec<u32> = at.windows(2).map(|w| w[1] - w[0]).collect();
            println!("seed {seed}: secs per wave {gaps:?} score {} after 20 min", g.s.score);
        }
    }

    /// Prints shared/brick_vectors.json:
    /// `cargo test --release brick_print_vectors -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn brick_print_vectors() {
        let levels = test_levels();
        let mut out = Vec::new();
        for (seed, lv, cut) in [
            (11u32, Some(&levels[0]), u32::MAX),
            (22, Some(&levels[1]), u32::MAX),
            (33, Some(&levels[1]), 900),
            (44, None, 60 * 60 * 4),
            (55, None, 60 * 45),
        ] {
            let (inputs, s) = bot_run(seed, lv, cut);
            let stop = if s.ended_by == Some(End::Quit) { Some(s.ticks) } else { None };
            out.push(serde_json::json!({
                "seed": seed, "level": lv, "stop_at": stop,
                "inputs": inputs.iter().map(|t| [t.0 as i64, t.1 as i64]).collect::<Vec<_>>(),
                "summary": s,
            }));
        }
        // Real Campaign levels, by id, so both sides also read the level file alike.
        for (seed, id) in [(77u32, 8u32), (81, 20)] {
            let lv = super::super::levels::level(id).unwrap();
            let (inputs, s) = bot_run(seed, Some(lv), u32::MAX);
            out.push(serde_json::json!({
                "seed": seed, "level": null, "level_id": id, "stop_at": null,
                "inputs": inputs.iter().map(|t| [t.0 as i64, t.1 as i64]).collect::<Vec<_>>(),
                "summary": s,
            }));
        }
        // A run where the ball is lost a few times (the bot stops after a while).
        let lv = &levels[0];
        let mut g = Game::new(66, Some(lv));
        let mut inputs = Vec::new();
        while g.over.is_none() {
            let (t, l, f) = if g.tick < 1500 { bot_input(&g, 0) } else { (None, g.tick.is_multiple_of(50), false) };
            if let Some(x) = t {
                inputs.push((g.tick, x));
            }
            if l {
                inputs.push((g.tick, LAUNCH));
            }
            if f {
                inputs.push((g.tick, FIRE));
            }
            g.step(t, l, f);
        }
        out.push(serde_json::json!({
            "seed": 66, "level": lv, "stop_at": null,
            "inputs": inputs.iter().map(|t| [t.0 as i64, t.1 as i64]).collect::<Vec<_>>(),
            "summary": g.s,
        }));
        println!("{}", serde_json::to_string(&serde_json::json!({ "runs": out })).unwrap());
    }

    #[test]
    fn shared_vectors_match() {
        const V: &str = include_str!("../../../shared/brick_vectors.json");
        let v: serde_json::Value = serde_json::from_str(V).unwrap();
        let runs = v["runs"].as_array().unwrap();
        assert!(runs.len() >= 8);
        for run in runs {
            let seed = run["seed"].as_u64().unwrap() as u32;
            let mut level: Option<Level> = serde_json::from_value(run["level"].clone()).unwrap();
            if let Some(id) = run["level_id"].as_u64() {
                level = super::super::levels::level(id as u32).cloned();
                assert!(level.is_some(), "level {id}");
            }
            let stop = run["stop_at"].as_u64().map(|x| x as u32);
            let inputs: Vec<Input> = run["inputs"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| (t[0].as_u64().unwrap() as u32, t[1].as_i64().unwrap() as i32))
                .collect();
            let want: Summary = serde_json::from_value(run["summary"].clone()).unwrap();
            assert_eq!(replay(seed, level.as_ref(), &inputs, stop).unwrap(), want, "seed {seed}");
        }
    }
}
