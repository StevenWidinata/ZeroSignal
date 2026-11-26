//! Signal Flap runs: `start` hands out a seed, `finish` replays the flap ticks
//! and pays out. Also the shop.
//!
//! Boards (`scores.level`): Endless (best score) and the Daily. `detail` is
//! the number of gaps passed.

use axum::extract::{Path, State};
use axum::Json;
use chrono::{Datelike, Utc};
use rand::Rng as _;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::engine::{self, Summary};
use super::items::{self, Kind as ItemKind};
use crate::auth::jwt::AuthUser;
use crate::daily;
use crate::economy::{self, Granted};
use crate::error::{AppError, AppResult};
use crate::quests;
use crate::scores::score_round_reward;
use crate::state::AppState;

pub const GAME_ID: &str = "signal-flap";
/// A run must be finished within this many minutes of starting.
const RUN_EXPIRY_MIN: i64 = 60;
/// Allowed difference between the game clock and the server clock (ms).
const CLOCK_SLACK_MS: i64 = 3_000;
/// Runs shorter than this (10 s) still score, but pay nothing and don't count
/// for quests (so quitting at once can't farm them).
pub const MIN_REWARD_TICKS: u32 = 600;
/// Signal Flap scores are small (one point per gap or bar), so the shared
/// score reward sees them ×100: a 50 here pays like a 5,000 in Snake Signal.
pub const REWARD_SCALE: i32 = 100;

/// `scores.level` of each board.
pub const BOARD_ENDLESS: i32 = 1;
pub const BOARD_DAILY: i32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Endless,
    Daily,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        match s {
            "endless" => Some(Mode::Endless),
            "daily" => Some(Mode::Daily),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Endless => "endless",
            Mode::Daily => "daily",
        }
    }

    pub fn board(self) -> i32 {
        match self {
            Mode::Endless => BOARD_ENDLESS,
            Mode::Daily => BOARD_DAILY,
        }
    }
}

/// What a run pays (before the daily coin cap).
pub fn run_reward(score: i32, rng: &mut impl rand::Rng) -> economy::Reward {
    score_round_reward(score.clamp(0, i32::MAX / REWARD_SCALE) * REWARD_SCALE, rng)
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartRequest {
    pub mode: String,
    /// Cosmetics; you must own them. Default: the first free one.
    #[serde(default)]
    pub drone: Option<String>,
    #[serde(default)]
    pub trail: Option<String>,
    #[serde(default)]
    pub sky: Option<String>,
}

#[derive(Serialize)]
pub struct StartResponse {
    pub run_id: Uuid,
    pub seed: u32,
    pub mode: Mode,
}

const DAILY_DONE: &str = "you already played today's Daily. Come back tomorrow!";

pub async fn start(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<StartRequest>,
) -> AppResult<Json<StartResponse>> {
    let mode = Mode::parse(&req.mode).ok_or_else(|| AppError::Validation("unknown mode".into()))?;

    let cat = items::items();
    let owned = owned_keys(&state.pool, user.user_id).await?;
    let pick = |kind: ItemKind, want: Option<String>| -> AppResult<String> {
        let id = want.unwrap_or_else(|| cat.default_id(kind).to_string());
        if cat.owns(kind, &id, &owned) {
            Ok(id)
        } else {
            Err(AppError::Validation(format!("you don't own that {}", kind.prefix())))
        }
    };
    let drone = pick(ItemKind::Drone, req.drone)?;
    let trail = pick(ItemKind::Trail, req.trail)?;
    let sky = pick(ItemKind::Sky, req.sky)?;

    // The Daily is the same course for everyone, one try per WIB day.
    let (seed, day) = if mode == Mode::Daily {
        let d = daily::wib_date(Utc::now());
        let played: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM flap_runs WHERE user_id = $1 AND mode = 'daily' AND day = $2)",
        )
        .bind(user.user_id)
        .bind(d)
        .fetch_one(&state.pool)
        .await?;
        if played {
            return Err(AppError::Conflict(DAILY_DONE.into()));
        }
        (engine::daily_seed(d.year(), d.month(), d.day()), Some(d))
    } else {
        (rand::thread_rng().gen::<u32>(), None)
    };

    let run_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO flap_runs (user_id, mode, seed, day, drone, trail, sky)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id"#,
    )
    .bind(user.user_id)
    .bind(mode.as_str())
    .bind(i64::from(seed))
    .bind(day)
    .bind(&drone)
    .bind(&trail)
    .bind(&sky)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(d) if d.is_unique_violation() => AppError::Conflict(DAILY_DONE.into()),
        _ => AppError::from(e),
    })?;

    Ok(Json(StartResponse { run_id, seed, mode }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FinishRequest {
    /// The ticks you flapped on, in order (60 ticks per second from GO).
    pub flaps: Vec<u32>,
    /// The tick where you ended the run yourself (None = it ended by itself).
    #[serde(default)]
    pub quit_at: Option<u32>,
}

#[derive(Serialize)]
pub struct FinishResponse {
    pub mode: Mode,
    pub summary: Summary,
    /// Endless: best score before the run. Daily: 0 (one try).
    pub previous_best: i32,
    pub new_best: bool,
    pub rewards: Granted,
    /// Lucky drop: an item key ("trail:comet") you just got, if any.
    pub drop: Option<String>,
}

#[derive(sqlx::FromRow)]
struct RunRow {
    mode: String,
    seed: i64,
    finished_at: Option<chrono::DateTime<Utc>>,
    elapsed_ms: f64,
}

pub async fn finish(
    State(state): State<AppState>,
    user: AuthUser,
    Path(run_id): Path<Uuid>,
    Json(req): Json<FinishRequest>,
) -> AppResult<Json<FinishResponse>> {
    let mut tx = state.pool.begin().await?;
    let run: RunRow = sqlx::query_as(
        r#"SELECT mode, seed, finished_at,
                  EXTRACT(EPOCH FROM (now() - started_at))::FLOAT8 * 1000 AS elapsed_ms
           FROM flap_runs WHERE id = $1 AND user_id = $2 FOR UPDATE"#,
    )
    .bind(run_id)
    .bind(user.user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    if run.finished_at.is_some() {
        return Err(AppError::Conflict("this run is already finished".into()));
    }
    if run.elapsed_ms > (RUN_EXPIRY_MIN * 60_000) as f64 {
        return Err(AppError::Validation("this run has expired".into()));
    }
    let mode = Mode::parse(&run.mode).ok_or_else(|| AppError::Validation("unknown mode".into()))?;

    let summary = engine::replay(run.seed as u32, &req.flaps, req.quit_at)
        .map_err(|e| AppError::Validation(e.message().into()))?;
    // The run can't be over before that much real time has passed.
    if (run.elapsed_ms as i64) + CLOCK_SLACK_MS < summary.game_ms as i64 {
        return Err(AppError::Validation("run finished too fast".into()));
    }

    let score = summary.score.min(i32::MAX as u32) as i32;
    sqlx::query(
        r#"UPDATE flap_runs SET finished_at = now(), score = $2, gaps = $3, bars = $4, flaps = $5,
               ticks = $6, ended_by = $7
           WHERE id = $1"#,
    )
    .bind(run_id)
    .bind(score)
    .bind(summary.gaps as i32)
    .bind(summary.bars as i32)
    .bind(summary.flaps as i32)
    .bind(summary.ticks as i32)
    .bind(summary.ended_by.map(|e| e.as_str()))
    .execute(&mut *tx)
    .await?;

    let previous_best = board_best(&mut tx, user.user_id, mode).await?;
    sqlx::query("INSERT INTO scores (user_id, game_id, score, level, gained, detail) VALUES ($1, $2, $3, $4, $3, $5)")
        .bind(user.user_id)
        .bind(GAME_ID)
        .bind(score)
        .bind(mode.board())
        .bind(summary.gaps.to_string())
        .execute(&mut *tx)
        .await?;
    let new_best = score > previous_best;

    let mut rewards = Granted::default();
    let mut drop = None;
    if summary.ticks >= MIN_REWARD_TICKS {
        let ev = quests::Event::FlapRun { gaps: i64::from(summary.gaps), bars: i64::from(summary.bars) };
        quests::api::record(&mut tx, user.user_id, &[ev]).await?;
        let reward = run_reward(score, &mut rand::thread_rng());
        rewards = economy::grant(&mut tx, user.user_id, reward, "signal_flap_run", true).await?;

        // Lucky drop: a good run may give a drone, trail or sky you don't own.
        let roll: f64 = rand::thread_rng().gen();
        if i64::from(score) >= items::DROP_MIN_SCORE && roll < items::DROP_CHANCE {
            let owned = owned_keys(&mut *tx, user.user_id).await?;
            let pick = items::items().random_unowned(&owned, &mut rand::thread_rng());
            if let Some(k) = pick {
                sqlx::query(
                    "INSERT INTO flap_items (user_id, item_key, source) VALUES ($1, $2, 'drop') ON CONFLICT DO NOTHING",
                )
                .bind(user.user_id)
                .bind(&k)
                .execute(&mut *tx)
                .await?;
                drop = Some(k);
            }
        }
    }
    tx.commit().await?;

    Ok(Json(FinishResponse { mode, summary, previous_best, new_best, rewards, drop }))
}

/// Best score on the Endless board, or today's on the Daily board.
async fn board_best(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, user_id: Uuid, mode: Mode) -> AppResult<i32> {
    let since = if mode == Mode::Daily { daily::today_start(Utc::now()) } else { chrono::DateTime::<Utc>::UNIX_EPOCH };
    Ok(sqlx::query_scalar(
        r#"SELECT COALESCE(MAX(score), 0) FROM scores
           WHERE user_id = $1 AND game_id = $2 AND level = $3 AND created_at >= $4"#,
    )
    .bind(user_id)
    .bind(GAME_ID)
    .bind(mode.board())
    .bind(since)
    .fetch_one(&mut **tx)
    .await?)
}

// ---------------------------------------------------------------------------
// Drones, trails and skies
// ---------------------------------------------------------------------------

async fn owned_keys(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid) -> AppResult<Vec<String>> {
    Ok(sqlx::query_scalar("SELECT item_key FROM flap_items WHERE user_id = $1")
        .bind(user_id)
        .fetch_all(ex)
        .await?)
}

#[derive(Serialize)]
pub struct ItemView {
    pub id: String,
    pub name: String,
    pub rarity: crate::character::catalog::Rarity,
    pub price: Option<i64>,
    pub owned: bool,
}

#[derive(Serialize)]
pub struct Collection {
    pub drones: Vec<ItemView>,
    pub trails: Vec<ItemView>,
    pub skies: Vec<ItemView>,
}

async fn collection_of(state: &AppState, user_id: Uuid) -> AppResult<Collection> {
    let owned = owned_keys(&state.pool, user_id).await?;
    let cat = items::items();
    let view = |kind| {
        cat.list(kind)
            .iter()
            .map(|i| ItemView {
                id: i.id.clone(),
                name: i.name.clone(),
                rarity: i.rarity,
                price: i.price,
                owned: cat.owns(kind, &i.id, &owned),
            })
            .collect()
    };
    Ok(Collection { drones: view(ItemKind::Drone), trails: view(ItemKind::Trail), skies: view(ItemKind::Sky) })
}

pub async fn collection(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Collection>> {
    Ok(Json(collection_of(&state, user.user_id).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuyRequest {
    pub kind: ItemKind,
    pub id: String,
}

pub async fn buy(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<BuyRequest>,
) -> AppResult<Json<Collection>> {
    let it = items::items()
        .find(req.kind, &req.id)
        .ok_or_else(|| AppError::Validation(format!("unknown item: {}", req.id)))?;
    let price = it.price.ok_or_else(|| AppError::Validation(format!("{} is already free", it.name)))?;
    let key = items::key(req.kind, &it.id);
    let mut tx = state.pool.begin().await?;
    let inserted = sqlx::query(
        "INSERT INTO flap_items (user_id, item_key, source) VALUES ($1, $2, 'shop') ON CONFLICT DO NOTHING",
    )
    .bind(user.user_id)
    .bind(&key)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict(format!("you already own {}", it.name)));
    }
    economy::spend(&mut tx, user.user_id, price, 0, &format!("flap_shop:{key}")).await?;
    tx.commit().await?;
    Ok(Json(collection_of(&state, user.user_id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    #[test]
    fn modes_round_trip_and_use_their_own_boards() {
        for m in [Mode::Endless, Mode::Daily] {
            assert_eq!(Mode::parse(m.as_str()), Some(m));
        }
        assert_eq!(Mode::parse("campaign"), None);
        assert_eq!((Mode::Endless.board(), Mode::Daily.board()), (1, 2));
    }

    #[test]
    fn rewards_scale_like_snake_signal() {
        let mut r = ChaCha8Rng::seed_from_u64(1);
        assert_eq!(run_reward(0, &mut r).coins, 0);
        assert_eq!(run_reward(50, &mut r).coins, 5);
        assert_eq!(run_reward(120, &mut r).coins, 12);
        // A silly score can't overflow.
        assert!(run_reward(i32::MAX, &mut r).coins > 0);
        assert_eq!(run_reward(-5, &mut r).coins, 0);
    }
}
