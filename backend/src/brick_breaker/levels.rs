//! The 24 Campaign levels from `shared/brick_levels.json`: small ASCII maps
//! turned into brick layouts for the engine. The frontend reads the same
//! file with `frontend/src/games/brick-breaker/levels.ts`.

use std::sync::OnceLock;

use serde::Deserialize;

use super::engine::{BrickSpec, Drop, Kind, Level};

const LEVELS_JSON: &str = include_str!("../../../shared/brick_levels.json");

pub const LEVEL_COUNT: u32 = 24;

#[derive(Debug, Deserialize)]
struct LevelFile {
    id: u32,
    world: u32,
    name: String,
    speed: i32,
    map: Vec<String>,
    drops: Vec<(i32, i32, Drop)>,
    moving: Vec<(i32, i32, String, i32, i32, i32)>,
}

#[derive(Debug, Deserialize)]
struct File {
    levels: Vec<LevelFile>,
}

#[derive(Debug, Clone)]
pub struct CampaignLevel {
    pub world: u32,
    pub level: Level,
}

fn kind_of(ch: char) -> Option<(Kind, Option<u32>)> {
    match ch {
        'n' => Some((Kind::Normal, None)),
        't' => Some((Kind::Tough, Some(2))),
        'T' => Some((Kind::Tough, Some(3))),
        's' => Some((Kind::Steel, None)),
        'e' => Some((Kind::Explosive, None)),
        _ => None,
    }
}

fn convert(f: LevelFile) -> CampaignLevel {
    let mut bricks = Vec::new();
    for (r, row) in f.map.iter().enumerate() {
        for (c, ch) in row.chars().enumerate() {
            if let Some((t, hp)) = kind_of(ch) {
                bricks.push(BrickSpec { c: c as i32, r: r as i32, t, hp, d: None, m: None });
            }
        }
    }
    for (c, r, k, lo, hi, speed) in &f.moving {
        let (t, hp) = kind_of(k.chars().next().unwrap_or('n')).unwrap_or((Kind::Normal, None));
        bricks.push(BrickSpec { c: *c, r: *r, t, hp, d: None, m: Some([*lo, *hi, *speed]) });
    }
    for (c, r, d) in &f.drops {
        if let Some(b) = bricks.iter_mut().find(|b| b.c == *c && b.r == *r) {
            b.d = Some(*d);
        }
    }
    CampaignLevel { world: f.world, level: Level { id: f.id, name: f.name, speed: Some(f.speed), bricks } }
}

pub fn levels() -> &'static [CampaignLevel] {
    static L: OnceLock<Vec<CampaignLevel>> = OnceLock::new();
    L.get_or_init(|| {
        let f: File = serde_json::from_str(LEVELS_JSON).expect("shared/brick_levels.json is valid");
        f.levels.into_iter().map(convert).collect()
    })
}

pub fn level(id: u32) -> Option<&'static Level> {
    levels().iter().map(|l| &l.level).find(|l| l.id == id)
}

#[cfg(test)]
mod tests {
    use super::super::engine::{replay, rules, tests::bot_run, End, Game, Input, Summary, LAUNCH};
    use super::*;

    /// A test player that aims: whenever a ball starts falling it tries a few
    /// paddle offsets on a copy of the game and keeps the one that breaks the
    /// most bricks before the ball comes back. Closer to a person than the
    /// plain bot, which never aims at anything.
    fn smart_run(level: &Level) -> (Vec<Input>, Summary) {
        let r = rules();
        let mut g = Game::new(1, Some(level));
        let mut inputs = Vec::new();
        let mut aim = 0;
        let mut falling = false;
        let follow = |g: &Game, aim: i32| -> Option<i32> {
            let b = g.balls.iter().filter(|b| b.stuck.is_none() && b.sy > 0).max_by_key(|b| b.y)?;
            Some(((b.x + aim).clamp(0, r.width) / 100) * 100)
        };
        while g.over.is_none() {
            let now = g.balls.iter().any(|b| b.stuck.is_none() && b.sy > 0);
            if now && !falling {
                let mut best = (i64::MIN, 0);
                for k in -4..=4 {
                    let a = k * 900;
                    let mut sim = g.clone();
                    let (hits, bricks, lives) = (sim.paddle_hits, sim.s.bricks, sim.lives);
                    let mut t = 0;
                    while sim.over.is_none() && t < 900 && sim.paddle_hits < hits + 2 && sim.lives == lives {
                        let tg = follow(&sim, a);
                        sim.step(tg, false, false);
                        t += 1;
                    }
                    let mut val = (sim.s.bricks - bricks) as i64 * 100 - t as i64 / 10;
                    if sim.lives < lives {
                        val -= 100_000;
                    }
                    if sim.over == Some(End::Clear) {
                        val += 1_000_000;
                    }
                    if val > best.0 {
                        best = (val, a);
                    }
                }
                aim = best.1;
            }
            falling = now;
            let target = follow(&g, aim).filter(|&x| x != g.target);
            let launch = g.balls.iter().any(|b| b.stuck.is_some()) && g.tick.is_multiple_of(7);
            let fire = g.laser > 0 && g.cooldown == 0;
            if let Some(x) = target {
                inputs.push((g.tick, x));
            }
            if launch {
                inputs.push((g.tick, LAUNCH));
            }
            if fire {
                inputs.push((g.tick, super::super::engine::FIRE));
            }
            g.step(target, launch, fire);
        }
        (inputs, g.s)
    }

    #[test]
    fn the_file_is_well_formed() {
        let raw: File = serde_json::from_str(LEVELS_JSON).unwrap();
        assert_eq!(raw.levels.len() as u32, LEVEL_COUNT);
        for (i, f) in raw.levels.iter().enumerate() {
            let id = i as u32 + 1;
            assert_eq!(f.id, id);
            assert_eq!(f.world, if id <= 12 { 1 } else { 2 }, "level {id}");
            assert!(!f.name.is_empty());
            assert!(f.map.iter().all(|row| row.chars().count() as i32 == rules().cols), "level {id}");
            assert!(f.map.iter().all(|row| row.chars().all(|ch| ch == '.' || kind_of(ch).is_some())), "level {id}");
            for (c, r, _) in &f.drops {
                let ch = f.map.get(*r as usize).and_then(|row| row.chars().nth(*c as usize));
                let on_mover = f.moving.iter().any(|m| m.0 == *c && m.1 == *r);
                assert!(on_mover || matches!(ch, Some('n' | 't' | 'T' | 'e')), "level {id}: drop at {c},{r} needs a breakable brick");
            }
            for (c, r, k, lo, hi, speed) in &f.moving {
                assert!(matches!(k.as_str(), "n" | "t" | "T"), "level {id}");
                assert!(lo <= c && c <= hi && *hi < rules().cols && *speed > 0, "level {id}");
                // The lane is empty, and no other mover shares it.
                let row = f.map.get(*r as usize).map(String::as_str).unwrap_or("");
                assert!(row.chars().enumerate().all(|(x, ch)| ch == '.' || (x as i32) < *lo || (x as i32) > *hi), "level {id}: lane {r}");
                let mates = f.moving.iter().filter(|m| m.1 == *r && m.3 <= *hi && m.4 >= *lo).count();
                assert_eq!(mates, 1, "level {id}: lanes on row {r} overlap");
            }
        }
    }

    #[test]
    fn worlds_teach_one_brick_kind_at_a_time() {
        let first = |pred: &dyn Fn(&BrickSpec) -> bool| levels().iter().position(|l| l.level.bricks.iter().any(pred)).unwrap() + 1;
        assert_eq!(first(&|b| b.t == Kind::Normal), 1);
        assert_eq!(first(&|b| b.t == Kind::Tough), 3);
        assert_eq!(first(&|b| b.t == Kind::Steel), 5);
        assert_eq!(first(&|b| b.t == Kind::Explosive), 7);
        assert_eq!(first(&|b| b.m.is_some()), 9);
        // World 2 starts faster than World 1 ends.
        let speed = |id: u32| level(id).unwrap().speed.unwrap();
        assert!(speed(13) > speed(12));
        assert!((1..LEVEL_COUNT).all(|id| speed(id + 1) >= speed(id)));
        // Every drop shows up somewhere in each world.
        for world in [1, 2] {
            for d in super::super::engine::DROPS {
                assert!(
                    levels().iter().filter(|l| l.world == world).any(|l| l.level.bricks.iter().any(|b| b.d == Some(d))),
                    "world {world} never drops {d:?}"
                );
            }
        }
    }

    /// Every level can be cleared: the plain bot (which never aims) clears
    /// each one with several seeds before the time cap, and the server's
    /// replay of its inputs agrees.
    #[test]
    fn the_bot_clears_every_level() {
        for cl in levels() {
            let lv = &cl.level;
            for seed in 1..=3u32 {
                let (inputs, s) = bot_run(seed, Some(lv), u32::MAX);
                assert_eq!(s.ended_by, Some(End::Clear), "level {} '{}' seed {seed}: {s:?}", lv.id, lv.name);
                if seed == 1 {
                    assert_eq!(replay(seed, Some(lv), &inputs, None).unwrap(), s);
                }
            }
        }
    }

    /// A player who aims clears every level in a few minutes, and later
    /// levels take longer on the whole.
    #[test]
    fn aiming_clears_every_level_in_a_few_minutes() {
        let mut secs = Vec::new();
        for cl in levels() {
            let (inputs, s) = smart_run(&cl.level);
            assert_eq!(s.ended_by, Some(End::Clear), "level {}: {s:?}", cl.level.id);
            assert!(s.ticks < 60 * 60 * 4, "level {} takes too long: {s:?}", cl.level.id);
            assert_eq!(replay(1, Some(&cl.level), &inputs, None).unwrap(), s);
            secs.push(s.ticks / 60);
        }
        let avg = |w: &[u32]| w.iter().sum::<u32>() / w.len() as u32;
        assert!(avg(&secs[12..]) > avg(&secs[..12]), "World 2 should take longer: {secs:?}");
    }

    /// `cargo test --release brick_print_levels -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn brick_print_levels() {
        for cl in levels() {
            let lv = &cl.level;
            let runs: Vec<_> = (1..=5u32).map(|seed| bot_run(seed, Some(lv), u32::MAX).1).collect();
            let secs: Vec<u32> = runs.iter().map(|s| s.ticks / 60).collect();
            let scores: Vec<u32> = runs.iter().map(|s| s.score).collect();
            let cleared = runs.iter().filter(|s| s.cleared).count();
            let (_, smart) = smart_run(lv);
            println!(
                "{:>2} {:<15} bricks {:>3} aiming {:>3}s cleared {cleared}/5 secs {secs:?} scores {scores:?} chain {}",
                lv.id,
                lv.name,
                lv.bricks.iter().filter(|b| b.t != Kind::Steel).count(),
                smart.ticks / 60,
                runs.iter().map(|s| s.best_chain).max().unwrap()
            );
        }
    }
}
