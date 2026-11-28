//! Zero-Bot for Echo Rally. It only looks at the court (as a player would)
//! and uses its own seeded random numbers, so a match against it replays
//! exactly from the seed and the player's inputs. `frontend/src/games/
//! echo-rally/bot.ts` is a line-for-line copy; change both together.
//!
//! For every new shot coming its way it waits a few ticks (its reaction),
//! picks an aiming error, and moves its paddle toward where the ball will
//! arrive, at its own top speed. Better levels react sooner, err less, move
//! faster and hit off-centre on purpose to send the ball at an angle. It
//! can't see a Ghost ball across the middle, or anything in Fog, and Echo
//! takes its error away. In Chaos, Easy and Medium fire their powers at
//! random moments; Hard and Master wait for a good moment.

use super::engine::{predict_y, rules, Ball, Control, Game, Power};
use crate::rng::Rng;

const KIT_SALT: u32 = 0x4B49_5421;
const BOT_SALT: u32 = 0x424F_5452;
/// Ticks a smart bot waits between two powers.
const COOLDOWN: u32 = 240;

/// The powers Zero-Bot brings at `level` (Echo never: it doesn't need it).
pub fn bot_kit(seed: u32, level: usize) -> Vec<Power> {
    let n = rules().bot[level].powers;
    let pool: Vec<Power> = Power::ALL.into_iter().filter(|&p| p != Power::Echo).collect();
    let mut rng = Rng::new(seed ^ KIT_SALT);
    let mut out = Vec::new();
    while out.len() < n {
        let p = pool[rng.below(pool.len() as u32) as usize];
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

#[derive(Clone)]
pub struct Bot {
    pub side: usize,
    pub level: usize,
    rng: Rng,
    /// Where it thinks the ball will arrive.
    plan: i32,
    /// The shot it is reacting to (points x 1000 + returns).
    shot: Option<u32>,
    react: u32,
    err: i32,
    aim: i32,
    /// Easy and Medium: (point, ticks into it) to fire each kit slot.
    moments: Vec<(u32, u32)>,
    points_seen: u32,
    point_start: u32,
    cooldown: u32,
}

impl Bot {
    pub fn new(seed: u32, side: usize, level: usize, g: &Game) -> Bot {
        let r = rules();
        let lv = &r.bot[level];
        let mut rng = Rng::new(seed ^ BOT_SALT ^ side as u32);
        let mut moments = Vec::new();
        if !lv.smart {
            for _ in 0..g.pads[side].kit.len() {
                let point = rng.below(g.target.max(1));
                let ticks = 60 + rng.below(480);
                moments.push((point, ticks));
            }
        }
        Bot {
            side,
            level,
            rng,
            plan: r.height / 2,
            shot: None,
            react: 0,
            err: 0,
            aim: 0,
            moments,
            points_seen: 0,
            point_start: 0,
            cooldown: 0,
        }
    }

    /// The nearest ball flying toward `side`'s paddle.
    fn nearest<'a>(g: &'a Game, side: usize) -> Option<&'a Ball> {
        let x = rules().contact_x(side);
        let mut best: Option<&Ball> = None;
        for b in &g.balls {
            let toward = if side == 0 { b.vx < 0 } else { b.vx > 0 };
            if toward && best.map_or(true, |o| (b.x - x).abs() < (o.x - x).abs()) {
                best = Some(b);
            }
        }
        best
    }

    fn sees(&self, g: &Game, b: &Ball) -> bool {
        let r = rules();
        if b.hidden() {
            return false;
        }
        if g.pads[self.side].fog > 0 {
            let clear = r.powers.fog_clear;
            let near = if self.side == 0 { b.x < clear } else { b.x > r.width - clear };
            if !near {
                return false;
            }
        }
        true
    }

    pub fn control(&mut self, g: &Game) -> Control {
        let r = rules();
        let lv = &r.bot[self.level];
        let me = &g.pads[self.side];
        let rival = &g.pads[1 - self.side];
        if g.points() != self.points_seen {
            self.points_seen = g.points();
            self.point_start = g.tick;
        }
        self.cooldown = self.cooldown.saturating_sub(1);
        let mut desired = me.y;
        match Bot::nearest(g, self.side) {
            Some(b) => {
                let shot = g.points() * 1000 + g.rally;
                if self.shot != Some(shot) {
                    self.shot = Some(shot);
                    self.react = lv.react;
                    // The faster the ball, the bigger the error.
                    let range = lv.error * b.flight / 1000;
                    self.err = if range > 0 { self.rng.below((2 * range + 1) as u32) as i32 - range } else { 0 };
                    self.aim = 0;
                    if lv.aim_pct > 0 {
                        let pct = lv.aim_pct / 2 + self.rng.below((lv.aim_pct / 2 + 1) as u32) as i32;
                        let mag = me.h() / 2 * pct / 100;
                        // Master sends it away from the rival; Hard picks a side.
                        let down = if self.level == 3 { rival.y < r.height / 2 } else { self.rng.below(2) == 0 };
                        self.aim = if down { mag } else { -mag };
                    }
                }
                if self.sees(g, b) {
                    self.plan = predict_y(b, r.contact_x(self.side));
                }
                if self.react > 0 {
                    self.react -= 1;
                } else {
                    let err = if me.echo > 0 { 0 } else { self.err };
                    desired = self.plan + err - self.aim;
                }
            }
            None => {
                if lv.center {
                    desired = r.height / 2;
                }
            }
        }
        let max = r.pad_speed * lv.speed_pct / 100;
        let target = (me.y + (desired - me.y).clamp(-max, max)).clamp(0, r.height);
        let fire = self.pick_fire(g);
        Control { target: Some(target), fire }
    }

    fn pick_fire(&mut self, g: &Game) -> Option<u8> {
        let r = rules();
        let lv = &r.bot[self.level];
        let me = &g.pads[self.side];
        if me.kit.is_empty() || g.over.is_some() {
            return None;
        }
        if !lv.smart {
            let pts = g.points();
            for (k, &(point, ticks)) in self.moments.iter().enumerate() {
                if !me.used[k] && (pts > point || (pts == point && g.tick - self.point_start >= ticks)) {
                    return Some(k as u8);
                }
            }
            return None;
        }
        if self.cooldown > 0 {
            return None;
        }
        let rs = 1 - self.side;
        let rival = &g.pads[rs];
        let rx = r.contact_x(rs);
        let inc = Bot::nearest(g, self.side);
        let out = Bot::nearest(g, rs);
        for (k, &p) in me.kit.iter().enumerate() {
            if me.used[k] {
                continue;
            }
            let ok = match p {
                Power::Grow | Power::Shield | Power::Echo => {
                    inc.is_some_and(|b| b.flight >= 800 || rival.score + 1 >= g.target)
                }
                Power::Smash | Power::Curve | Power::Ghost => inc.is_some() && g.rally >= 2,
                Power::Shrink | Power::MultiBall => out.is_some_and(|b| (b.x - rx).abs() < r.width / 2),
                Power::Freeze => out.is_some_and(|b| {
                    (b.x - rx).abs() < r.width * 3 / 10 && (predict_y(b, rx) - rival.y).abs() > rival.h() / 2
                }),
                Power::Fog => out.is_some_and(|b| (b.x - rx).abs() > r.width / 2),
            };
            if ok {
                // Hard hesitates; Master fires at once.
                if self.level < 3 && self.rng.below(100) >= 4 {
                    return None;
                }
                self.cooldown = COOLDOWN;
                return Some(k as u8);
            }
        }
        None
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::echo_rally::engine::{End, Summary};

    /// Zero-Bot `a` (left) against Zero-Bot `b` (right).
    pub fn duel(seed: u32, a: usize, b: usize, target: u32, chaos: bool) -> Summary {
        let kits = if chaos { [bot_kit(seed ^ 0x77, a), bot_kit(seed, b)] } else { [Vec::new(), Vec::new()] };
        let mut g = Game::new(seed, target, kits);
        let mut left = Bot::new(seed ^ 0x5151, 0, a, &g);
        let mut right = Bot::new(seed, 1, b, &g);
        while g.over.is_none() {
            let c = [left.control(&g), right.control(&g)];
            g.step(c);
        }
        g.s
    }

    /// How often `hi` beats `lo` over `n` matches, swapping sides each time.
    fn win_rate(hi: usize, lo: usize, n: u32, target: u32, chaos: bool) -> u32 {
        let mut wins = 0;
        for s in 0..n {
            let seed = 1000 + s * 7919;
            let (a, b, hi_side) = if s % 2 == 0 { (hi, lo, 0) } else { (lo, hi, 1) };
            if duel(seed, a, b, target, chaos).winner == Some(hi_side) {
                wins += 1;
            }
        }
        wins * 100 / n
    }

    #[test]
    fn bot_kits_are_different_powers_without_echo() {
        for seed in 0..50u32 {
            for level in 0..4 {
                let k = bot_kit(seed, level);
                assert_eq!(k.len(), rules().bot[level].powers);
                assert!(!k.contains(&Power::Echo));
                assert!(k.iter().enumerate().all(|(i, p)| !k[..i].contains(p)));
            }
        }
    }

    #[test]
    fn every_level_beats_the_one_below() {
        for lo in 0..3 {
            for chaos in [false, true] {
                let rate = win_rate(lo + 1, lo, 40, 5, chaos);
                assert!(rate >= 70, "{} beats {} only {rate}% (chaos {chaos})", lo + 1, lo);
            }
        }
    }

    #[test]
    fn matches_end_well_before_the_time_cap() {
        for seed in 0..12u32 {
            let s = duel(seed, 3, 3, 11, seed % 2 == 0);
            assert_eq!(s.ended_by, Some(End::Win), "seed {seed}");
            assert!(s.ticks < 60 * 60 * 20, "seed {seed}: {} s", s.ticks / 60);
        }
    }

    #[test]
    fn bots_fire_their_whole_kit_in_long_matches() {
        let s = duel(5, 0, 3, 11, true);
        assert_eq!(s.powers[1], 3);
        let s = duel(6, 1, 2, 11, true);
        assert!(s.powers[0] >= 1 && s.powers[1] >= 1);
    }

    /// Prints win rates and match lengths for tuning:
    /// `cargo test --release rally_print_ladder -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn rally_print_ladder() {
        for chaos in [false, true] {
            for hi in 1..4 {
                for lo in 0..hi {
                    println!("chaos {chaos}: {hi} vs {lo}: {}%", win_rate(hi, lo, 100, 5, chaos));
                }
            }
        }
        for level in 0..4 {
            let (mut ticks, mut rally, mut hits) = (0u64, 0u32, 0u32);
            for seed in 0..20u32 {
                let s = duel(seed, level, level, 7, false);
                ticks += s.ticks as u64;
                rally = rally.max(s.longest_rally);
                hits += s.hits[0] + s.hits[1];
            }
            println!("level {level} mirror to 7: avg {} s, {} returns per point, longest rally {rally}", ticks / 20 / 60, hits / 20 / 13);
        }
    }
}
