//! The Daily Hunt: everyone hunts the same hidden fleet each WIB day. The
//! server keeps the fleet (like Minefield keeps its mines) and answers each
//! move. You have all five ship powers (Mk I); fewer moves = more points;
//! pings and powers count as moves. One try a day.

use axum::extract::State;
use axum::Json;
use chrono::{Datelike, NaiveDate, Utc};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use serde::Serialize;
use uuid::Uuid;

use super::api::{FireRequest, GAME_ID};
use super::rules::{random_fleet, Fleet, Move, Sea, ShotError, ShotResult};
use super::tactics::{crate_seed, hide_crates_from, tactics_rules, Item, Tactics, MK1};
use super::view::{CellResult, PowersView, SeaView};
use crate::auth::jwt::AuthUser;
use crate::daily;
use crate::economy::{self, Granted, Reward};
use crate::error::{AppError, AppResult};
use crate::quests;
use crate::state::AppState;

/// `scores.level` for the Daily Hunt ("Today's hunt" board).
pub const DAILY_BOARD: i32 = 5;

/// Today's fleet: the same for everyone on a WIB day.
pub fn daily_fleet(day: NaiveDate) -> Fleet {
    let seed = (day.year() as u64) * 10_000 + u64::from(day.month()) * 100 + u64::from(day.day());
    random_fleet(&mut ChaCha8Rng::seed_from_u64(seed ^ 0x534F_4E41_5248_554E))
}

/// Leaderboard points for finishing in `shots` moves (17 is perfect).
pub fn daily_points(shots: usize) -> i32 {
    (101 - shots as i32).max(1)
}

/// Coins and XP for finishing.
pub fn daily_reward(shots: usize) -> Reward {
    match shots {
        0..=30 => Reward { coins: 40, tokens: 0, xp: 40 },
        31..=45 => Reward { coins: 25, tokens: 0, xp: 30 },
        _ => Reward { coins: 15, tokens: 0, xp: 20 },
    }
}

/// Items a Hunt crate can hold: you have no fleet to shield or repair.
const HUNT_ITEMS: [Item; 2] = [Item::Ping, Item::ExtraShot];

/// Today's crates: the same 3 squares (and items) for everyone.
pub fn daily_crates(day: NaiveDate, fleet: &Fleet) -> Vec<(usize, Item)> {
    let seed = (day.year() as u32) * 10_000 + day.month() * 100 + day.day();
    hide_crates_from(fleet, crate_seed(seed ^ 0x4855_4E54, 1), tactics_rules().crates, &HUNT_ITEMS)
}

/// One hunter against today's fleet, with all five ship powers at Mk I.
/// Every move counts, except spending Overdrive and the shot that opens an
/// Extra shot crate.
pub struct Hunt {
    pub sea: Sea,
    pub tactics: Tactics,
    /// Every move played, in order ("f37 a12h o2 …").
    pub moves: Vec<String>,
    /// Moves that count for the score.
    pub counted: usize,
}

/// What one Hunt move did.
pub struct HuntTurn {
    pub results: Vec<(usize, ShotResult)>,
    /// It didn't count as a move (Overdrive, or it opened an Extra shot crate).
    pub free: bool,
}

impl HuntTurn {
    pub fn main(&self) -> ShotResult {
        self.results.iter().map(|&(_, r)| r).max_by_key(|r| r.weight()).unwrap_or(ShotResult::Miss)
    }
}

impl Hunt {
    pub fn new(day: NaiveDate, fleet: &Fleet) -> Hunt {
        Hunt { sea: Sea::new_tactics(fleet, daily_crates(day, fleet)), tactics: Tactics::new([MK1, MK1]), moves: Vec::new(), counted: 0 }
    }

    pub fn play(&mut self, m: Move) -> Result<HuntTurn, ShotError> {
        if self.sea.all_sunk() {
            return Err(ShotError::Over);
        }
        if let Move::Overdrive(p) = m {
            if !self.tactics.overdrive[0] {
                return Err(ShotError::NoOverdrive);
            }
            if self.tactics.ready(0, p) {
                return Err(ShotError::AlreadyReady);
            }
            self.tactics.spend_overdrive(0, p);
            self.moves.push(m.code());
            return Ok(HuntTurn { results: vec![(0, ShotResult::Charged { power: p as u8 })], free: true });
        }
        let power = m.power();
        let mut size = 0;
        if let Some(p) = power {
            if !self.tactics.ready(0, p) {
                return Err(ShotError::NotReady);
            }
            size = self.tactics.spec(0, p).size;
            if let Move::Torpedo { edge, .. } = m {
                if size < 4 && !edge.basic() {
                    return Err(ShotError::BadMove);
                }
            }
        }
        let results = self.sea.strike(m, size)?;
        let mut free = false;
        for &(_, r) in &results {
            match r {
                ShotResult::Crate { item: Item::Ping } => self.sea.bonus_pings += 1,
                ShotResult::Crate { item: Item::ExtraShot } => free = true,
                _ => {}
            }
        }
        self.tactics.after_move(0, power);
        if m.fires() {
            self.tactics.after_firing(0, results.iter().any(|&(_, r)| r.struck()));
        }
        self.moves.push(m.code());
        if !free {
            self.counted += 1;
        }
        Ok(HuntTurn { results, free })
    }

    /// Replay a saved move list; returns the hunt and the last move's turn.
    pub fn replay(day: NaiveDate, fleet: &Fleet, moves: &str) -> Result<(Hunt, Option<HuntTurn>), ShotError> {
        let mut h = Hunt::new(day, fleet);
        let mut last = None;
        for t in moves.split_whitespace() {
            last = Some(h.play(Move::parse(t).ok_or(ShotError::BadMove)?)?);
        }
        Ok((h, last))
    }
}

#[derive(Serialize)]
pub struct DailyView {
    pub day: NaiveDate,
    /// `target.shots` = moves that count.
    pub target: SeaView,
    /// playing | done (or "new" before the first move)
    pub status: String,
    /// The hidden fleet, once you've sunk it all.
    pub fleet: Option<String>,
    /// The last move's headline result.
    pub last: Option<ShotResult>,
    /// Every square the last move touched.
    pub last_hits: Vec<CellResult>,
    /// The last move didn't count (Overdrive, or an Extra shot crate).
    pub last_free: bool,
    /// Your five ship powers (Mk I).
    pub powers: PowersView,
    pub points: Option<i32>,
    pub rewards: Option<Granted>,
}

#[derive(sqlx::FromRow)]
struct Run {
    moves: String,
    status: String,
}

fn view(day: NaiveDate, fleet: &Fleet, run: Option<&Run>) -> AppResult<(DailyView, Hunt)> {
    let moves = run.map(|r| r.moves.as_str()).unwrap_or("");
    let (hunt, last) = Hunt::replay(day, fleet, moves).map_err(|e| AppError::Internal(anyhow::anyhow!("daily hunt: {}", e.text())))?;
    let status = run.map(|r| r.status.clone()).unwrap_or_else(|| "new".into());
    let mut target = SeaView::of(&hunt.sea);
    target.shots = hunt.counted;
    Ok((
        DailyView {
            day,
            target,
            fleet: (status == "done").then(|| fleet.code()),
            status,
            last: last.as_ref().map(HuntTurn::main),
            last_hits: last.as_ref().map(|t| t.results.iter().map(|&(cell, result)| CellResult { cell, result }).collect()).unwrap_or_default(),
            last_free: last.as_ref().is_some_and(|t| t.free),
            powers: PowersView::hunter(&hunt.tactics),
            points: None,
            rewards: None,
        },
        hunt,
    ))
}

/// `GET /api/games/sonar/daily`
pub async fn today(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<DailyView>> {
    let day = daily::wib_date(Utc::now());
    let run: Option<Run> = sqlx::query_as("SELECT moves, status FROM sonar_daily_runs WHERE user_id = $1 AND day = $2")
        .bind(user.user_id)
        .bind(day)
        .fetch_optional(&state.pool)
        .await?;
    let (v, _) = view(day, &daily_fleet(day), run.as_ref())?;
    Ok(Json(v))
}

/// `POST /api/games/sonar/daily/fire`: a shot, a ping, or any power move.
pub async fn fire(State(state): State<AppState>, user: AuthUser, Json(req): Json<FireRequest>) -> AppResult<Json<DailyView>> {
    let mv = req.to_move()?;
    let day = daily::wib_date(Utc::now());
    let fleet = daily_fleet(day);
    let mut tx = state.pool.begin().await?;
    sqlx::query("INSERT INTO sonar_daily_runs (user_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(user.user_id)
        .bind(day)
        .execute(&mut *tx)
        .await?;
    let mut run: Run = sqlx::query_as("SELECT moves, status FROM sonar_daily_runs WHERE user_id = $1 AND day = $2 FOR UPDATE")
        .bind(user.user_id)
        .bind(day)
        .fetch_one(&mut *tx)
        .await?;
    if run.status == "done" {
        return Err(AppError::Conflict("today's hunt is done; a new fleet hides at midnight WIB".into()));
    }
    let (_, mut hunt) = view(day, &fleet, Some(&run))?;
    hunt.play(mv).map_err(|e| AppError::Validation(e.text().into()))?;
    run.moves = hunt.moves.join(" ");
    let (mut pts, mut rewards) = (None, None);
    if hunt.sea.all_sunk() {
        run.status = "done".into();
        let shots = hunt.counted;
        let p = daily_points(shots);
        record_points(&mut tx, user.user_id, p).await?;
        quests::api::record(&mut tx, user.user_id, &[quests::Event::SonarDaily { shots: shots as i64 }]).await?;
        rewards = Some(economy::grant(&mut tx, user.user_id, daily_reward(shots), "sonar_daily", true).await?);
        pts = Some(p);
    }
    sqlx::query(
        "UPDATE sonar_daily_runs SET moves = $3, status = $4, shots = $5, finished_at = CASE WHEN $4 = 'done' THEN now() END WHERE user_id = $1 AND day = $2",
    )
    .bind(user.user_id)
    .bind(day)
    .bind(&run.moves)
    .bind(&run.status)
    .bind(hunt.counted as i16)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    let (mut v, _) = view(day, &fleet, Some(&run))?;
    v.points = pts;
    v.rewards = rewards;
    Ok(Json(v))
}

async fn record_points(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, user_id: Uuid, pts: i32) -> AppResult<()> {
    let total: i32 = sqlx::query_scalar("SELECT COALESCE(MAX(score), 0) FROM scores WHERE user_id = $1 AND game_id = $2")
        .bind(user_id)
        .bind(GAME_ID)
        .fetch_one(&mut **tx)
        .await?;
    sqlx::query("INSERT INTO scores (user_id, game_id, score, level, gained) VALUES ($1, $2, $3, $4, $5)")
        .bind(user_id)
        .bind(GAME_ID)
        .bind(total + pts)
        .bind(DAILY_BOARD)
        .bind(pts)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_fleet_all_day_and_a_new_one_tomorrow() {
        let d: NaiveDate = "2026-11-15".parse().unwrap();
        assert_eq!(daily_fleet(d), daily_fleet(d));
        assert_ne!(daily_fleet(d), daily_fleet(d.succ_opt().unwrap()));
        assert_eq!(daily_fleet(d).validate(), Ok(()));
    }

    #[test]
    fn fewer_shots_score_more() {
        assert_eq!(daily_points(17), 84);
        assert!(daily_points(30) > daily_points(60));
        assert_eq!(daily_points(100), 1);
        assert!(daily_reward(25).coins > daily_reward(70).coins);
    }

    fn day() -> NaiveDate {
        "2026-11-23".parse().unwrap()
    }

    /// Open water squares (not a ship, not a crate), in order.
    fn water(fleet: &Fleet) -> Vec<usize> {
        let occ = fleet.occupancy();
        let crates: Vec<usize> = daily_crates(day(), fleet).iter().map(|&(c, _)| c).collect();
        (0..100).filter(|&c| occ[c].is_none() && !crates.contains(&c)).collect()
    }

    #[test]
    fn three_crates_for_everyone_with_only_hunt_items() {
        for k in 0..30 {
            let d = day() + chrono::Days::new(k);
            let f = daily_fleet(d);
            let c = daily_crates(d, &f);
            assert_eq!(c, daily_crates(d, &f), "same crates all day");
            assert_eq!(c.len(), 3);
            let occ = f.occupancy();
            for &(cell, item) in &c {
                assert!(occ[cell].is_none(), "a crate on a ship");
                assert!(matches!(item, Item::Ping | Item::ExtraShot), "{item:?} is useless without a fleet");
            }
        }
    }

    #[test]
    fn powers_charge_with_moves_and_each_use_counts_as_a_move() {
        let f = daily_fleet(day());
        let mut h = Hunt::new(day(), &f);
        // Air Strike (cooldown 6) starts half charged: not ready yet.
        assert!(matches!(h.play(Move::AirStrike { cell: 0, horizontal: true }), Err(ShotError::NotReady)));
        assert_eq!(h.counted, 0, "a refused move doesn't count");
        let w = water(&f);
        for &c in &w[..3] {
            h.play(Move::Fire(c)).unwrap();
        }
        assert_eq!(h.counted, 3);
        assert!(h.tactics.ready(0, crate::sonar::tactics::AIR_STRIKE));
        // Aim it at three squares that haven't been fired at.
        let row = (5..10).find(|r| (0..3).all(|k| h.sea.marks[r * 10 + k].open())).unwrap();
        let t = h.play(Move::AirStrike { cell: row * 10, horizontal: true }).unwrap();
        assert_eq!(t.results.len(), 3);
        assert_eq!(h.counted, 4, "a power is one move");
        assert!(!h.tactics.ready(0, crate::sonar::tactics::AIR_STRIKE), "used powers start over");
    }

    #[test]
    fn overdrive_and_an_extra_shot_crate_are_free() {
        let f = daily_fleet(day());
        let mut h = Hunt::new(day(), &f);
        // Three hits in a row on the carrier (5 long) fill Overdrive.
        let carrier: Vec<usize> = (0..100).filter(|&c| f.occupancy()[c] == Some(0)).collect();
        for &c in &carrier[..3] {
            h.play(Move::Fire(c)).unwrap();
        }
        assert!(h.tactics.overdrive[0]);
        // Everything is charged after 3 moves: use Radar so Overdrive has something to charge.
        h.play(Move::Radar { line: 9, row: true }).unwrap();
        assert!(!h.tactics.ready(0, crate::sonar::tactics::RADAR));
        let before = h.counted;
        let t = h.play(Move::Overdrive(crate::sonar::tactics::RADAR)).unwrap();
        assert!(t.free);
        assert_eq!(h.counted, before, "Overdrive is free");
        assert!(h.tactics.ready(0, crate::sonar::tactics::RADAR));
        assert!(matches!(h.play(Move::Overdrive(0)), Err(ShotError::NoOverdrive)), "spent");
        // Crates: an Extra shot doesn't count, an Extra ping adds a ping.
        for (cell, item) in daily_crates(day(), &f) {
            let (counted, pings) = (h.counted, h.sea.pings_left());
            let t = h.play(Move::Fire(cell)).unwrap();
            match item {
                Item::ExtraShot => assert!(t.free && h.counted == counted),
                _ => assert!(!t.free && h.counted == counted + 1 && h.sea.pings_left() == pings + 1),
            }
        }
    }

    #[test]
    fn a_full_hunt_replays_to_the_same_score() {
        let f = daily_fleet(day());
        let mut h = Hunt::new(day(), &f);
        let occ = f.occupancy();
        for c in (0..100).filter(|&c| occ[c].is_some()) {
            if h.sea.marks[c].open() {
                h.play(Move::Fire(c)).unwrap();
            }
        }
        assert!(h.sea.all_sunk());
        assert!(matches!(h.play(Move::Fire(0)), Err(ShotError::Over)));
        let (again, last) = Hunt::replay(day(), &f, &h.moves.join(" ")).unwrap();
        assert_eq!(again.counted, h.counted);
        assert!(again.sea.all_sunk());
        assert!(matches!(last.unwrap().main(), ShotResult::Sunk { .. }));
        // Yesterday's plain shots-and-pings runs still replay.
        assert!(Hunt::replay(day(), &f, "p44 f0 f99").is_ok());
    }
}
