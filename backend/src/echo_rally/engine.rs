//! Echo Rally rules: a tick-by-tick two-paddle court built from a seed, and
//! the replay that turns a player's inputs against Zero-Bot into a result.
//!
//! The frontend has a line-for-line copy in `frontend/src/games/echo-rally/
//! engine.ts`; both read their numbers from `shared/rally_rules.json` and use
//! only integer math, so the same seed and inputs always give the same match.
//! `shared/rally_vectors.json` is checked by both test suites. Change both
//! files together.
//!
//! Side 0 is the left paddle, side 1 the right. Each point starts with a
//! serve toward the player who lost the last one. Every return makes the ball
//! a little faster, and where it meets the paddle sets the angle back. First
//! to the target wins. In Chaos each side brings a kit of powers and can fire
//! each one once per match.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::rng::Rng;

const RULES_JSON: &str = include_str!("../../../shared/rally_rules.json");

#[derive(Debug, Deserialize)]
pub struct PowerRules {
    pub grow_ticks: u32,
    pub grow_pct: i32,
    pub shrink_ticks: u32,
    pub shrink_pct: i32,
    pub smash_pct: i32,
    pub smash_max: i32,
    pub shield_ticks: u32,
    pub shield_w: i32,
    pub echo_ticks: u32,
    pub curve_acc: i32,
    pub curve_ticks: u32,
    pub freeze_ticks: u32,
    pub multi_ticks: u32,
    pub fog_ticks: u32,
    pub fog_clear: i32,
}

#[derive(Debug, Deserialize)]
pub struct BotLevel {
    pub name: String,
    pub react: u32,
    pub error: i32,
    pub speed_pct: i32,
    pub aim_pct: i32,
    pub powers: usize,
    pub smart: bool,
    pub center: bool,
}

#[derive(Debug, Deserialize)]
pub struct Rules {
    pub width: i32,
    pub height: i32,
    pub pad_inset: i32,
    pub pad_w: i32,
    pub pad_h: i32,
    pub pad_speed: i32,
    pub ball_r: i32,
    pub speed_start: i32,
    pub speed_step: i32,
    pub speed_max: i32,
    pub cos: Vec<i32>,
    pub sin: Vec<i32>,
    pub serve_delay: u32,
    pub serve_angle: i32,
    pub targets: Vec<u32>,
    pub kit_size: usize,
    pub max_ticks: u32,
    pub max_inputs: usize,
    pub power_ids: Vec<String>,
    pub powers: PowerRules,
    pub bot: Vec<BotLevel>,
}

impl Rules {
    /// The x of the paddle's front face on `side`.
    pub fn face_x(&self, side: usize) -> i32 {
        if side == 0 {
            self.pad_inset + self.pad_w
        } else {
            self.width - self.pad_inset - self.pad_w
        }
    }
    /// The x of the ball's centre when it touches `side`'s paddle face.
    pub fn contact_x(&self, side: usize) -> i32 {
        if side == 0 {
            self.face_x(0) + self.ball_r
        } else {
            self.face_x(1) - self.ball_r
        }
    }
    /// The steepest angle index.
    pub fn last_angle(&self) -> i32 {
        self.cos.len() as i32 - 1
    }
}

pub fn rules() -> &'static Rules {
    static R: OnceLock<Rules> = OnceLock::new();
    R.get_or_init(|| {
        let r: Rules = serde_json::from_str(RULES_JSON).expect("shared/rally_rules.json is valid");
        assert_eq!(r.cos.len(), r.sin.len());
        assert_eq!(r.power_ids.len(), Power::ALL.len());
        for (p, id) in Power::ALL.iter().zip(&r.power_ids) {
            assert_eq!(p.id(), id, "power order in shared/rally_rules.json");
        }
        assert_eq!(r.bot.len(), 4);
        r
    })
}

// ---------------------------------------------------------------------------
// Powers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Power {
    Grow,
    Shrink,
    Smash,
    Shield,
    Echo,
    Curve,
    Freeze,
    MultiBall,
    Ghost,
    Fog,
}

impl Power {
    pub const ALL: [Power; 10] = [
        Power::Grow,
        Power::Shrink,
        Power::Smash,
        Power::Shield,
        Power::Echo,
        Power::Curve,
        Power::Freeze,
        Power::MultiBall,
        Power::Ghost,
        Power::Fog,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Power::Grow => "grow",
            Power::Shrink => "shrink",
            Power::Smash => "smash",
            Power::Shield => "shield",
            Power::Echo => "echo",
            Power::Curve => "curve",
            Power::Freeze => "freeze",
            Power::MultiBall => "multi-ball",
            Power::Ghost => "ghost",
            Power::Fog => "fog",
        }
    }

    pub fn parse(s: &str) -> Option<Power> {
        Power::ALL.into_iter().find(|p| p.id() == s)
    }
}

/// A Chaos kit is fine: `kit_size` different powers.
pub fn kit_ok(kit: &[Power]) -> bool {
    kit.len() == rules().kit_size && kit.iter().enumerate().all(|(i, p)| !kit[..i].contains(p))
}

// ---------------------------------------------------------------------------
// Court
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paddle {
    /// Centre.
    pub y: i32,
    /// Where it is heading (the player's last input).
    pub target: i32,
    pub score: u32,
    pub kit: Vec<Power>,
    pub used: Vec<bool>,
    /// Ticks left on timed effects. `shrink`, `freeze` and `fog` are effects
    /// the rival put on this paddle.
    pub grow: u32,
    pub shrink: u32,
    pub freeze: u32,
    pub shield: u32,
    pub echo: u32,
    pub fog: u32,
    /// Armed for this paddle's next return.
    pub smash: bool,
    pub curve: bool,
    pub ghost: bool,
}

impl Paddle {
    fn new(kit: Vec<Power>) -> Paddle {
        let r = rules();
        let used = vec![false; kit.len()];
        Paddle {
            y: r.height / 2,
            target: r.height / 2,
            score: 0,
            kit,
            used,
            grow: 0,
            shrink: 0,
            freeze: 0,
            shield: 0,
            echo: 0,
            fog: 0,
            smash: false,
            curve: false,
            ghost: false,
        }
    }

    /// Current height (Grow and Shrink change it).
    pub fn h(&self) -> i32 {
        let r = rules();
        let mut h = r.pad_h;
        if self.grow > 0 {
            h = h * r.powers.grow_pct / 100;
        }
        if self.shrink > 0 {
            h = h * r.powers.shrink_pct / 100;
        }
        h
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ball {
    pub x: i32,
    pub y: i32,
    pub vx: i32,
    pub vy: i32,
    /// The rally speed (grows with every return).
    pub speed: i32,
    /// This flight's speed (the rally speed, or more after a Smash).
    pub flight: i32,
    /// Who hit it last.
    pub owner: Option<u8>,
    /// Curve: bends once it crosses the net.
    pub curve: bool,
    pub bend: i32,
    pub bend_ticks: u32,
    /// Ghost: invisible across the middle third.
    pub ghost: bool,
}

impl Ball {
    /// Hidden by Ghost right now?
    pub fn hidden(&self) -> bool {
        let w = rules().width;
        self.ghost && self.x > w / 3 && self.x < 2 * w / 3
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum End {
    /// Someone reached the target.
    Win,
    /// The time cap: the leader wins, a tie has no winner.
    Time,
    /// Someone left: the other side wins.
    Quit,
}

impl End {
    pub fn as_str(self) -> &'static str {
        match self {
            End::Win => "win",
            End::Time => "time",
            End::Quit => "quit",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Summary {
    pub score: [u32; 2],
    pub winner: Option<u8>,
    pub ended_by: Option<End>,
    pub ticks: u32,
    pub game_ms: u64,
    /// Returns by each side.
    pub hits: [u32; 2],
    /// Most returns (both sides) in one point.
    pub longest_rally: u32,
    /// Powers fired by each side.
    pub powers: [u32; 2],
}

/// One side's input for one tick.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Control {
    /// A new paddle target (centre y).
    pub target: Option<i32>,
    /// Fire kit slot 0, 1 or 2.
    pub fire: Option<u8>,
}

#[derive(Clone)]
pub struct Game {
    pub rng: Rng,
    pub tick: u32,
    /// Points to win.
    pub target: u32,
    pub pads: [Paddle; 2],
    pub balls: Vec<Ball>,
    /// Ticks until the next serve (0 = in play).
    pub serve_wait: u32,
    /// The side the next serve flies toward.
    pub serve_to: u8,
    /// Ticks left on Multi-ball.
    pub multi: u32,
    /// Returns in the current point.
    pub rally: u32,
    pub over: Option<End>,
    pub s: Summary,
}

/// Where a ball will be (its centre y) when it reaches `x`, bouncing off the
/// top and bottom walls; its current y if it is moving away.
pub fn predict_y(b: &Ball, x: i32) -> i32 {
    let r = rules();
    let dx = x - b.x;
    if b.vx == 0 || (dx > 0) != (b.vx > 0) {
        return b.y;
    }
    let raw = b.y + (b.vy as i64 * dx as i64 / b.vx as i64) as i32;
    let span = r.height - 2 * r.ball_r;
    let mut p = (raw - r.ball_r) % (2 * span);
    if p < 0 {
        p += 2 * span;
    }
    if p > span {
        p = 2 * span - p;
    }
    p + r.ball_r
}

impl Game {
    /// A new match to `target` points. `kits` are empty in Classic.
    pub fn new(seed: u32, target: u32, kits: [Vec<Power>; 2]) -> Game {
        let r = rules();
        let mut rng = Rng::new(seed);
        let serve_to = rng.below(2) as u8;
        let [k0, k1] = kits;
        Game {
            rng,
            tick: 0,
            target,
            pads: [Paddle::new(k0), Paddle::new(k1)],
            balls: Vec::new(),
            serve_wait: r.serve_delay,
            serve_to,
            multi: 0,
            rally: 0,
            over: None,
            s: Summary {
                score: [0, 0],
                winner: None,
                ended_by: None,
                ticks: 0,
                game_ms: 0,
                hits: [0, 0],
                longest_rally: 0,
                powers: [0, 0],
            },
        }
    }

    /// Points played so far.
    pub fn points(&self) -> u32 {
        self.s.score[0] + self.s.score[1]
    }

    /// Can `side` fire kit slot `slot` now?
    pub fn can_fire(&self, side: usize, slot: usize) -> bool {
        let p = &self.pads[side];
        self.over.is_none() && slot < p.kit.len() && !p.used[slot]
    }

    /// A copy of `b` going the other way up or down (Multi-ball).
    fn mirror(b: &Ball) -> Ball {
        let r = rules();
        let mut m = b.clone();
        if b.vy == 0 {
            let vy = b.flight * r.sin[3] / 1000;
            m.vy = vy;
        } else {
            m.vy = -b.vy;
        }
        m
    }

    fn fire(&mut self, side: usize, slot: usize) {
        if !self.can_fire(side, slot) {
            return;
        }
        let pr = &rules().powers;
        let q = 1 - side;
        self.pads[side].used[slot] = true;
        self.s.powers[side] += 1;
        match self.pads[side].kit[slot] {
            Power::Grow => self.pads[side].grow = pr.grow_ticks,
            Power::Shrink => self.pads[q].shrink = pr.shrink_ticks,
            Power::Smash => self.pads[side].smash = true,
            Power::Shield => self.pads[side].shield = pr.shield_ticks,
            Power::Echo => self.pads[side].echo = pr.echo_ticks,
            Power::Curve => self.pads[side].curve = true,
            Power::Freeze => self.pads[q].freeze = pr.freeze_ticks,
            Power::MultiBall => {
                self.multi = pr.multi_ticks;
                if self.balls.len() == 1 {
                    let m = Game::mirror(&self.balls[0]);
                    if self.balls[0].vy == 0 {
                        self.balls[0].vy = -m.vy;
                    }
                    self.balls.push(m);
                }
            }
            Power::Ghost => self.pads[side].ghost = true,
            Power::Fog => self.pads[q].fog = pr.fog_ticks,
        }
    }

    fn launch(&mut self) {
        let r = rules();
        let a = self.rng.below((2 * r.serve_angle + 1) as u32) as i32 - r.serve_angle;
        let i = a.unsigned_abs() as usize;
        let dir = if self.serve_to == 0 { -1 } else { 1 };
        let flight = r.speed_start;
        let b = Ball {
            x: r.width / 2,
            y: r.height / 2,
            vx: dir * flight * r.cos[i] / 1000,
            vy: a.signum() * flight * r.sin[i] / 1000,
            speed: flight,
            flight,
            owner: None,
            curve: false,
            bend: 0,
            bend_ticks: 0,
            ghost: false,
        };
        if self.multi > 0 {
            let mut b = b;
            let m = Game::mirror(&b);
            if b.vy == 0 {
                b.vy = -m.vy;
            }
            self.balls.push(b);
            self.balls.push(m);
        } else {
            self.balls.push(b);
        }
    }

    /// The paddle on `side` meets the ball at height `cy` (if it reaches).
    fn try_hit(&mut self, side: usize, b: &mut Ball, cy: i32) -> bool {
        let r = rules();
        let pr = &r.powers;
        let pad = &mut self.pads[side];
        let reach = pad.h() / 2 + r.ball_r;
        let rel = cy - pad.y;
        if rel.abs() > reach {
            return false;
        }
        let last = r.last_angle();
        let idx = (rel * last / reach).clamp(-last, last);
        b.x = r.contact_x(side);
        b.y = cy.clamp(r.ball_r, r.height - r.ball_r);
        b.speed = (b.speed + r.speed_step).min(r.speed_max);
        let mut flight = b.speed;
        if pad.smash {
            flight = (flight * pr.smash_pct / 100).min(pr.smash_max);
            pad.smash = false;
        }
        b.flight = flight;
        let a = idx.unsigned_abs() as usize;
        let dir = if side == 0 { 1 } else { -1 };
        b.vx = dir * (flight * r.cos[a] / 1000).max(1);
        b.vy = idx.signum() * flight * r.sin[a] / 1000;
        b.owner = Some(side as u8);
        b.bend = 0;
        b.bend_ticks = 0;
        b.curve = pad.curve;
        pad.curve = false;
        b.ghost = pad.ghost;
        pad.ghost = false;
        self.rally += 1;
        self.s.hits[side] += 1;
        self.s.longest_rally = self.s.longest_rally.max(self.rally);
        true
    }

    /// Moves ball `i` one tick; returns the side that scored, if it got past.
    fn move_ball(&mut self, i: usize) -> Option<usize> {
        let r = rules();
        let pr = &r.powers;
        let rad = r.ball_r;
        let mut b = self.balls[i].clone();
        if b.bend_ticks > 0 {
            b.vy += b.bend;
            b.bend_ticks -= 1;
            let lim = b.flight * r.sin[r.last_angle() as usize] / 1000;
            b.vy = b.vy.clamp(-lim, lim);
        }
        let (px, py) = (b.x, b.y);
        b.x += b.vx;
        b.y += b.vy;
        if b.y - rad < 0 {
            b.y = 2 * rad - b.y;
            b.vy = -b.vy;
        } else if b.y + rad > r.height {
            b.y = 2 * (r.height - rad) - b.y;
            b.vy = -b.vy;
        }
        let mid = r.width / 2;
        if b.curve && (px < mid) != (b.x < mid) {
            b.curve = false;
            b.bend = if b.vy > 0 { -pr.curve_acc } else { pr.curve_acc };
            b.bend_ticks = pr.curve_ticks;
        }
        if b.vx < 0 {
            let face = r.face_x(0);
            if px - rad >= face && b.x - rad < face {
                let cy = py + (b.y - py) * (px - rad - face) / (px - b.x);
                self.try_hit(0, &mut b, cy);
            }
        } else {
            let face = r.face_x(1);
            if px + rad <= face && b.x + rad > face {
                let cy = py + (b.y - py) * (face - px - rad) / (b.x - px);
                self.try_hit(1, &mut b, cy);
            }
        }
        if b.vx < 0 && self.pads[0].shield > 0 && b.x - rad < pr.shield_w {
            b.x = pr.shield_w + rad;
            b.vx = -b.vx;
            self.pads[0].shield = 0;
        } else if b.vx > 0 && self.pads[1].shield > 0 && b.x + rad > r.width - pr.shield_w {
            b.x = r.width - pr.shield_w - rad;
            b.vx = -b.vx;
            self.pads[1].shield = 0;
        }
        let scored = if b.x + rad < 0 {
            Some(1)
        } else if b.x - rad > r.width {
            Some(0)
        } else {
            None
        };
        self.balls[i] = b;
        scored
    }

    fn score_point(&mut self, side: usize) {
        let r = rules();
        self.pads[side].score += 1;
        self.s.score[side] += 1;
        self.balls.clear();
        self.multi = 0;
        self.rally = 0;
        self.serve_to = (1 - side) as u8;
        self.serve_wait = r.serve_delay;
        if self.pads[side].score >= self.target {
            self.over = Some(End::Win);
            self.s.winner = Some(side as u8);
        }
    }

    fn finish(&mut self) {
        self.s.ended_by = self.over;
        self.s.ticks = self.tick;
        self.s.game_ms = self.tick as u64 * 1000 / 60;
    }

    /// `side` leaves: the other side wins.
    pub fn quit(&mut self, side: usize) {
        if self.over.is_none() {
            self.over = Some(End::Quit);
            self.s.winner = Some((1 - side) as u8);
            self.finish();
        }
    }

    /// One tick with both sides' inputs.
    pub fn step(&mut self, ctl: [Control; 2]) {
        if self.over.is_some() {
            return;
        }
        let r = rules();
        for (side, c) in ctl.iter().enumerate() {
            if let Some(slot) = c.fire {
                self.fire(side, slot as usize);
            }
            if let Some(t) = c.target {
                self.pads[side].target = t.clamp(0, r.height);
            }
        }
        for p in &mut self.pads {
            p.grow = p.grow.saturating_sub(1);
            p.shrink = p.shrink.saturating_sub(1);
            p.freeze = p.freeze.saturating_sub(1);
            p.shield = p.shield.saturating_sub(1);
            p.echo = p.echo.saturating_sub(1);
            p.fog = p.fog.saturating_sub(1);
        }
        if self.multi > 0 {
            self.multi -= 1;
            if self.multi == 0 && self.balls.len() > 1 {
                self.balls.truncate(1);
            }
        }
        for p in &mut self.pads {
            let h = p.h();
            if p.freeze == 0 {
                p.y += (p.target - p.y).clamp(-r.pad_speed, r.pad_speed);
            }
            p.y = p.y.clamp(h / 2, r.height - h / 2);
        }
        if self.serve_wait > 0 {
            self.serve_wait -= 1;
            if self.serve_wait == 0 {
                self.launch();
            }
        }
        for i in 0..self.balls.len() {
            if let Some(side) = self.move_ball(i) {
                self.score_point(side);
                break;
            }
        }
        self.tick += 1;
        if self.over.is_none() && self.tick >= r.max_ticks {
            self.over = Some(End::Time);
            let [a, b] = self.s.score;
            self.s.winner = if a > b {
                Some(0)
            } else if b > a {
                Some(1)
            } else {
                None
            };
        }
        if self.over.is_some() {
            self.finish();
        }
    }
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/// One input: at `tick`, either a paddle target y (0..=height) or a power
/// fire (`FIRE_0` = slot 0, -2 = slot 1, -3 = slot 2).
pub type Input = (u32, i32);
pub const FIRE_0: i32 = -1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplayError {
    BadMatch,
    BadKit,
    TooManyInputs,
    Unsorted,
    BadInput,
    /// Two targets or two fires on the same tick.
    Duplicate,
    /// A kit slot fired twice, or one that doesn't exist.
    BadFire,
    /// An input after the match was already over.
    AfterEnd,
}

impl ReplayError {
    pub fn message(self) -> &'static str {
        match self {
            ReplayError::BadMatch => "unknown target or level",
            ReplayError::BadKit => "a Chaos kit needs 3 different powers",
            ReplayError::TooManyInputs => "too many inputs",
            ReplayError::Unsorted => "inputs are out of order",
            ReplayError::BadInput => "unknown input",
            ReplayError::Duplicate => "the same input twice in one tick",
            ReplayError::BadFire => "a power fired twice",
            ReplayError::AfterEnd => "inputs after the match ended",
        }
    }
}

/// A match against Zero-Bot: the player is side 0 (left), the bot side 1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BotMatch {
    pub seed: u32,
    pub target: u32,
    /// 0 easy .. 3 master.
    pub level: usize,
    pub chaos: bool,
    /// The player's kit (empty in Classic).
    pub kit: Vec<Power>,
}

impl BotMatch {
    pub fn check(&self) -> Result<(), ReplayError> {
        let r = rules();
        if !r.targets.contains(&self.target) || self.level >= r.bot.len() {
            return Err(ReplayError::BadMatch);
        }
        let ok = if self.chaos { kit_ok(&self.kit) } else { self.kit.is_empty() };
        if !ok {
            return Err(ReplayError::BadKit);
        }
        Ok(())
    }

    /// The court at tick 0 and the bot that plays side 1.
    pub fn start(&self) -> (Game, crate::echo_rally::bot::Bot) {
        let bot_kit = if self.chaos { crate::echo_rally::bot::bot_kit(self.seed, self.level) } else { Vec::new() };
        let g = Game::new(self.seed, self.target, [self.kit.clone(), bot_kit]);
        let bot = crate::echo_rally::bot::Bot::new(self.seed, 1, self.level, &g);
        (g, bot)
    }
}

/// Plays a whole match from the player's inputs. It always ends (someone
/// reaches the target or the time cap), or at tick `stop_at` if the player
/// quit there (a loss).
pub fn replay(m: &BotMatch, inputs: &[Input], stop_at: Option<u32>) -> Result<Summary, ReplayError> {
    let r = rules();
    m.check()?;
    if inputs.len() > r.max_inputs {
        return Err(ReplayError::TooManyInputs);
    }
    if inputs.windows(2).any(|w| w[1].0 < w[0].0) {
        return Err(ReplayError::Unsorted);
    }
    let min = FIRE_0 - (r.kit_size as i32 - 1);
    if inputs.iter().any(|&(_, v)| v < min || v > r.height) {
        return Err(ReplayError::BadInput);
    }
    let mut fired = vec![false; r.kit_size];
    for &(_, v) in inputs {
        if v < 0 {
            let slot = (FIRE_0 - v) as usize;
            if slot >= m.kit.len() || fired[slot] {
                return Err(ReplayError::BadFire);
            }
            fired[slot] = true;
        }
    }
    let (mut g, mut bot) = m.start();
    let mut i = 0;
    while g.over.is_none() {
        if stop_at.is_some_and(|s| g.tick >= s) {
            g.quit(0);
            break;
        }
        let mut me = Control::default();
        while i < inputs.len() && inputs[i].0 == g.tick {
            match inputs[i].1 {
                v if v < 0 => {
                    if me.fire.is_some() {
                        return Err(ReplayError::Duplicate);
                    }
                    me.fire = Some((FIRE_0 - v) as u8);
                }
                y => {
                    if me.target.is_some() {
                        return Err(ReplayError::Duplicate);
                    }
                    me.target = Some(y);
                }
            }
            i += 1;
        }
        let them = bot.control(&g);
        g.step([me, them]);
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
    use crate::echo_rally::bot::Bot;

    fn classic(seed: u32, target: u32) -> Game {
        Game::new(seed, target, [Vec::new(), Vec::new()])
    }

    /// Steps until a ball is in play.
    fn until_served(g: &mut Game) {
        while g.balls.is_empty() {
            g.step([Control::default(); 2]);
        }
    }

    /// A paddle that always sits where the ball will arrive.
    fn tracker(g: &Game, side: usize) -> Control {
        let r = rules();
        let x = r.contact_x(side);
        let toward = |b: &&Ball| if side == 0 { b.vx < 0 } else { b.vx > 0 };
        let target = g.balls.iter().filter(toward).map(|b| predict_y(b, x)).next().unwrap_or(r.height / 2);
        Control { target: Some(target), fire: None }
    }

    #[test]
    fn serves_after_the_delay_toward_the_drawn_side() {
        let r = rules();
        let mut g = classic(5, 5);
        for _ in 0..r.serve_delay - 1 {
            g.step([Control::default(); 2]);
            assert!(g.balls.is_empty());
        }
        g.step([Control::default(); 2]);
        assert_eq!(g.balls.len(), 1);
        let b = &g.balls[0];
        assert_eq!(b.vx < 0, g.serve_to == 0);
        assert_eq!(b.speed, r.speed_start);
    }

    #[test]
    fn a_missed_ball_scores_and_the_next_serve_goes_to_the_loser() {
        let mut g = classic(1, 5);
        until_served(&mut g);
        let loser = g.serve_to as usize;
        // Park both paddles at the top: a serve (at most 22.5 degrees from
        // the middle) can't reach them there, so it goes in.
        let park = Control { target: Some(0), fire: None };
        while g.points() == 0 {
            g.step([park, park]);
        }
        let scorer = if g.s.score[0] == 1 { 0 } else { 1 };
        assert_eq!(1 - scorer, loser);
        assert_eq!(g.serve_to as usize, loser);
        assert!(g.balls.is_empty());
    }

    #[test]
    fn trackers_never_miss_and_the_ball_speeds_up_to_the_cap() {
        let r = rules();
        let mut g = classic(9, 5);
        for _ in 0..60 * 60 {
            let c = [tracker(&g, 0), tracker(&g, 1)];
            g.step(c);
        }
        assert_eq!(g.points(), 0, "perfect trackers keep the rally going");
        assert!(g.rally > 20);
        assert_eq!(g.balls[0].speed, r.speed_max);
    }

    #[test]
    fn the_hit_spot_sets_the_angle() {
        let r = rules();
        let mut g = classic(2, 5);
        until_served(&mut g);
        // Send it to side 0 straight, and meet it with the paddle edge.
        g.balls[0].vx = -r.speed_start;
        g.balls[0].vy = 0;
        g.balls[0].y = r.height / 2;
        let edge = r.height / 2 - r.pad_h / 2;
        g.pads[0].y = edge;
        g.pads[0].target = edge;
        while g.s.hits[0] == 0 {
            g.step([Control::default(); 2]);
            assert_eq!(g.points(), 0);
        }
        let b = &g.balls[0];
        assert!(b.vx > 0 && b.vy > 0, "hit below the centre goes down: {b:?}");
        assert!(b.vy * 1000 / b.flight >= r.sin[5]);
    }

    #[test]
    fn first_to_the_target_wins() {
        let mut g = classic(3, 5);
        let park = Control { target: Some(0), fire: None };
        while g.over.is_none() {
            let c = [tracker(&g, 0), park];
            g.step(c);
        }
        assert_eq!(g.s.ended_by, Some(End::Win));
        assert_eq!(g.s.winner, Some(0));
        assert_eq!(g.s.score, [5, 0]);
        g.step([Control::default(); 2]);
        assert_eq!(g.s.score, [5, 0]);
    }

    #[test]
    fn powers_fire_once_and_do_their_thing() {
        let r = rules();
        let pr = &r.powers;
        let kit0 = vec![Power::Grow, Power::Shrink, Power::Shield];
        let kit1 = vec![Power::Freeze, Power::Fog, Power::MultiBall];
        let mut g = Game::new(4, 5, [kit0, kit1]);
        until_served(&mut g);
        let fire = |s: u8| Control { target: None, fire: Some(s) };
        g.step([fire(0), fire(0)]);
        assert_eq!(g.pads[0].h(), r.pad_h * pr.grow_pct / 100);
        assert!(g.pads[0].freeze > 0);
        g.step([fire(0), fire(1)]);
        assert_eq!(g.s.powers, [1, 2], "slot 0 can't fire twice");
        assert!(g.pads[0].fog > 0);
        g.step([fire(1), fire(2)]);
        assert_eq!(g.pads[1].h(), r.pad_h * pr.shrink_pct / 100);
        assert_eq!(g.balls.len(), 2);
        assert_eq!(g.balls[0].vy, -g.balls[1].vy);
        g.step([fire(2), Control::default()]);
        assert!(g.pads[0].shield > 0);
        assert!(!g.can_fire(0, 0) && !g.can_fire(0, 2) && !g.can_fire(1, 1));
        // Frozen: the left paddle doesn't move.
        let y = g.pads[0].y;
        g.step([Control { target: Some(0), fire: None }, Control::default()]);
        assert_eq!(g.pads[0].y, y);
        for _ in 0..pr.multi_ticks {
            g.step([Control::default(); 2]);
        }
        assert!(g.balls.len() <= 1, "multi-ball runs out");
    }

    #[test]
    fn a_shield_saves_one_goal() {
        let kit = vec![Power::Shield, Power::Grow, Power::Echo];
        let mut g = Game::new(8, 5, [kit, Vec::new()]);
        g.step([Control { target: Some(0), fire: Some(0) }, Control::default()]);
        let park = Control { target: Some(0), fire: None };
        until_served(&mut g);
        // Aim the ball at the left goal; the parked paddle is out of the way.
        let r = rules();
        g.balls[0].vx = -r.speed_start;
        g.balls[0].vy = 0;
        g.balls[0].y = r.height - 2000;
        let mut bounced = false;
        while g.points() == 0 {
            g.step([park, park]);
            if g.balls.first().is_some_and(|b| b.vx > 0) && g.s.hits[0] == 0 {
                bounced = true;
            }
        }
        assert!(bounced, "the shield sent it back");
        assert_eq!(g.pads[0].shield, 0);
    }

    #[test]
    fn smash_curve_and_ghost_ride_on_the_next_return() {
        let r = rules();
        let kit = vec![Power::Smash, Power::Curve, Power::Ghost];
        let mut g = Game::new(6, 5, [kit, Vec::new()]);
        g.step([Control { target: None, fire: Some(0) }, Control::default()]);
        g.step([Control { target: None, fire: Some(1) }, Control::default()]);
        g.step([Control { target: None, fire: Some(2) }, Control::default()]);
        while g.s.hits[0] == 0 {
            let c = [tracker(&g, 0), tracker(&g, 1)];
            g.step(c);
            assert_eq!(g.points(), 0);
        }
        let b = &g.balls[0];
        assert_eq!(b.flight, (b.speed * r.powers.smash_pct / 100).min(r.powers.smash_max));
        assert!(b.curve && b.ghost);
        assert!(!g.pads[0].smash && !g.pads[0].curve && !g.pads[0].ghost);
        let (mut seen_hidden, mut bent) = (false, false);
        let h1 = g.s.hits[1];
        while g.s.hits[1] == h1 && g.points() == 0 {
            let c = [tracker(&g, 0), Control::default()];
            g.step(c);
            if let Some(b) = g.balls.first() {
                seen_hidden |= b.hidden();
                bent |= b.bend_ticks > 0;
            }
        }
        assert!(seen_hidden && bent);
    }

    #[test]
    fn predict_matches_the_ball_path() {
        let r = rules();
        let mut g = classic(12, 5);
        until_served(&mut g);
        g.balls[0].vx = -700;
        g.balls[0].vy = 640;
        let side = 0;
        let want = predict_y(&g.balls[0], r.contact_x(side));
        let park = Control { target: Some(r.height), fire: None };
        while g.balls[0].x > r.contact_x(side) + 700 {
            g.step([park, park]);
        }
        assert!((g.balls[0].y - want).abs() < 1200, "{} vs {want}", g.balls[0].y);
    }

    #[test]
    fn kits_must_be_three_different_powers() {
        assert!(kit_ok(&[Power::Grow, Power::Fog, Power::Echo]));
        assert!(!kit_ok(&[Power::Grow, Power::Grow, Power::Echo]));
        assert!(!kit_ok(&[Power::Grow, Power::Fog]));
        for p in Power::ALL {
            assert_eq!(Power::parse(p.id()), Some(p));
        }
    }

    /// Plays side 0 with a Zero-Bot of `me` level and records its inputs the
    /// way the browser does (only changes), against `m.level`.
    pub fn bot_as_player(m: &BotMatch, me: usize, max_ticks: u32) -> (Vec<Input>, Summary) {
        let (mut g, mut them) = m.start();
        let mut mine = Bot::new(m.seed ^ 0x5151, 0, me, &g);
        let mut inputs = Vec::new();
        let mut last = g.pads[0].target;
        while g.over.is_none() {
            if g.tick >= max_ticks {
                g.quit(0);
                break;
            }
            let mut c = mine.control(&g);
            if let Some(t) = c.target {
                if t == last {
                    c.target = None;
                } else {
                    last = t;
                    inputs.push((g.tick, t));
                }
            }
            if let Some(s) = c.fire {
                inputs.push((g.tick, FIRE_0 - s as i32));
            }
            let b = them.control(&g);
            g.step([c, b]);
        }
        (inputs, g.s)
    }

    fn bot_match(seed: u32, target: u32, level: usize, chaos: bool) -> BotMatch {
        let kit = if chaos { crate::echo_rally::bot::bot_kit(seed ^ 77, 2) } else { Vec::new() };
        BotMatch { seed, target, level, chaos, kit }
    }

    #[test]
    fn replay_rejects_bad_matches_and_inputs() {
        let m = bot_match(1, 5, 0, false);
        assert_eq!(replay(&BotMatch { target: 6, ..m.clone() }, &[], None), Err(ReplayError::BadMatch));
        assert_eq!(replay(&BotMatch { level: 4, ..m.clone() }, &[], None), Err(ReplayError::BadMatch));
        assert_eq!(replay(&BotMatch { kit: vec![Power::Grow], ..m.clone() }, &[], None), Err(ReplayError::BadKit));
        assert_eq!(replay(&BotMatch { chaos: true, ..m.clone() }, &[], None), Err(ReplayError::BadKit));
        assert_eq!(replay(&m, &[(5, 10), (4, 10)], None), Err(ReplayError::Unsorted));
        assert_eq!(replay(&m, &[(5, rules().height + 1)], None), Err(ReplayError::BadInput));
        assert_eq!(replay(&m, &[(5, -4)], None), Err(ReplayError::BadInput));
        assert_eq!(replay(&m, &[(5, -1)], None), Err(ReplayError::BadFire), "no kit in Classic");
        assert_eq!(replay(&m, &[(5, 10), (5, 20)], None), Err(ReplayError::Duplicate));
        assert_eq!(replay(&m, &[(5, 10), (9_999_999, 20)], None), Err(ReplayError::AfterEnd));
        assert_eq!(replay(&m, &vec![(0, 0); rules().max_inputs + 1], None), Err(ReplayError::TooManyInputs));
        let c = bot_match(1, 5, 0, true);
        assert_eq!(replay(&c, &[(5, -1), (9, -1)], None), Err(ReplayError::BadFire));
        assert_eq!(replay(&c, &[(5, -1), (5, -2)], None), Err(ReplayError::Duplicate));
        let s = replay(&m, &[], Some(300)).unwrap();
        assert_eq!((s.ended_by, s.ticks, s.winner), (Some(End::Quit), 300, Some(1)));
    }

    #[test]
    fn replay_matches_live_play() {
        for (seed, level, chaos) in [(1u32, 0usize, false), (2, 1, true), (3, 2, true), (4, 3, false)] {
            let m = bot_match(seed, 5, level, chaos);
            let (inputs, s) = bot_as_player(&m, 2, 60 * 60 * 6);
            let stop = (s.ended_by == Some(End::Quit)).then_some(s.ticks);
            assert_eq!(replay(&m, &inputs, stop).unwrap(), s, "seed {seed}");
        }
    }

    /// Prints shared/rally_vectors.json:
    /// `cargo test --release rally_print_vectors -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn rally_print_vectors() {
        let mut out = Vec::new();
        let mut push = |m: BotMatch, inputs: Vec<Input>, s: Summary| {
            let stop = (s.ended_by == Some(End::Quit)).then_some(s.ticks);
            assert_eq!(replay(&m, &inputs, stop).unwrap(), s);
            let kit: Vec<&str> = m.kit.iter().map(|p| p.id()).collect();
            out.push(serde_json::json!({
                "seed": m.seed, "target": m.target, "level": m.level, "chaos": m.chaos, "kit": kit,
                "stop_at": stop, "inputs": inputs, "summary": s,
            }));
        };
        for (seed, target, level, chaos, me) in [
            (11u32, 5u32, 0usize, false, 1usize),
            (12, 7, 1, false, 2),
            (13, 5, 2, true, 2),
            (14, 7, 3, true, 3),
            (15, 11, 3, false, 3),
            (16, 5, 1, true, 0),
        ] {
            let m = bot_match(seed, target, level, chaos);
            let (i, s) = bot_as_player(&m, me, u32::MAX);
            push(m, i, s);
        }
        // Quits after 20 s.
        let m = bot_match(17, 5, 2, true);
        let (i, s) = bot_as_player(&m, 2, 1200);
        push(m, i, s);
        println!("{}", serde_json::to_string(&serde_json::json!({ "matches": out })).unwrap());
    }

    #[test]
    fn shared_vectors_match() {
        const V: &str = include_str!("../../../shared/rally_vectors.json");
        let v: serde_json::Value = serde_json::from_str(V).unwrap();
        let matches = v["matches"].as_array().unwrap();
        assert!(matches.len() >= 7);
        for x in matches {
            let m = BotMatch {
                seed: x["seed"].as_u64().unwrap() as u32,
                target: x["target"].as_u64().unwrap() as u32,
                level: x["level"].as_u64().unwrap() as usize,
                chaos: x["chaos"].as_bool().unwrap(),
                kit: x["kit"].as_array().unwrap().iter().map(|p| Power::parse(p.as_str().unwrap()).unwrap()).collect(),
            };
            let stop = x["stop_at"].as_u64().map(|t| t as u32);
            let inputs: Vec<Input> = x["inputs"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| (p[0].as_u64().unwrap() as u32, p[1].as_i64().unwrap() as i32))
                .collect();
            let want: Summary = serde_json::from_value(x["summary"].clone()).unwrap();
            assert_eq!(replay(&m, &inputs, stop).unwrap(), want, "seed {}", m.seed);
        }
    }
}
