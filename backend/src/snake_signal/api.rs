//! Snake Signal runs: `start` hands out a seed, `finish` replays the turns.

use axum::extract::{Path, State};
use axum::Json;
use chrono::{Datelike, Utc};
use rand::Rng as _;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::engine::{self, Mode, Size, Summary, Turn};
use super::items::{self, Kind as ItemKind};
use crate::auth::jwt::AuthUser;
use crate::daily;
use crate::economy::{self, Granted};
use crate::error::{AppError, AppResult};
use crate::quests;
use crate::scores::score_round_reward;
use crate::state::AppState;

pub const GAME_ID: &str = "snake-signal";
/// A run must be finished within this many minutes of starting.
const RUN_EXPIRY_MIN: i64 = 60;
/// Allowed difference between the game clock and the server clock (ms).
const CLOCK_SLACK_MS: i64 = 3_000;
/// Runs shorter than this (ticks) still score, but pay nothing and don't
/// count for quests (so quitting at once can't farm "play 3").
pub const MIN_REWARD_TICKS: u32 = 100;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartRequest {
    pub mode: String,
    #[serde(default)]
    pub size: Option<String>,
    /// Cosmetics; you must own them. Default: the free ones.
    #[serde(default)]
    pub skin: Option<String>,
    #[serde(default)]
    pub arena: Option<String>,
    #[serde(default)]
    pub trail: Option<String>,
}

#[derive(Serialize)]
pub struct StartResponse {
    pub run_id: Uuid,
    pub seed: u32,
    pub mode: Mode,
    pub size: Size,
}

pub async fn start(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<StartRequest>,
) -> AppResult<Json<StartResponse>> {
    let mode = Mode::parse(&req.mode).ok_or_else(|| AppError::Validation("unknown mode".into()))?;
    let size = match req.size.as_deref() {
        None => Size::Medium,
        Some(s) => Size::parse(s).ok_or_else(|| AppError::Validation("unknown board size".into()))?,
    };

    let cat = items::items();
    let owned = owned_keys(&state.pool, user.user_id).await?;
    let mut pick = |kind: ItemKind, want: Option<String>| -> AppResult<String> {
        let id = want.unwrap_or_else(|| cat.default_id(kind).to_string());
        if cat.owns(kind, &id, &owned) {
            Ok(id)
        } else {
            Err(AppError::Validation(format!("you don't own that {}", kind.prefix())))
        }
    };
    let skin = pick(ItemKind::Skin, req.skin)?;
    let arena = pick(ItemKind::Arena, req.arena)?;
    let trail = pick(ItemKind::Trail, req.trail)?;

    // The Daily is the same medium board for everyone, one try per WIB day.
    let (seed, size, day) = if mode == Mode::Daily {
        let d = daily::wib_date(Utc::now());
        let played: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM snake_runs WHERE user_id = $1 AND mode = 'daily' AND day = $2)",
        )
        .bind(user.user_id)
        .bind(d)
        .fetch_one(&state.pool)
        .await?;
        if played {
            return Err(AppError::Conflict("you already played today's Daily. Come back tomorrow!".into()));
        }
        (engine::daily_seed(d.year(), d.month(), d.day()), Size::Medium, Some(d))
    } else {
        (rand::thread_rng().gen::<u32>(), size, None)
    };

    let run_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO snake_runs (user_id, mode, size, seed, day, skin, arena, trail)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id"#,
    )
    .bind(user.user_id)
    .bind(mode.as_str())
    .bind(size.as_str())
    .bind(i64::from(seed))
    .bind(day)
    .bind(&skin)
    .bind(&arena)
    .bind(&trail)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(d) if d.is_unique_violation() => {
            AppError::Conflict("you already played today's Daily. Come back tomorrow!".into())
        }
        _ => AppError::from(e),
    })?;

    Ok(Json(StartResponse { run_id, seed, mode, size }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FinishRequest {
    /// `[tick, dir]` pairs (dir: 0 up, 1 right, 2 down, 3 left).
    pub turns: Vec<Turn>,
    /// The tick where you ended the run yourself (None = it ended by itself).
    #[serde(default)]
    pub quit_at: Option<u32>,
}

#[derive(Serialize)]
pub struct FinishResponse {
    pub mode: Mode,
    pub size: Size,
    pub summary: Summary,
    /// Best score in this mode before the run (today only for Daily).
    pub previous_best: i32,
    pub new_best: bool,
    pub rewards: Granted,
    /// Lucky drop: an item key ("skin:lava") you just got, if any.
    pub drop: Option<String>,
}

#[derive(sqlx::FromRow)]
struct RunRow {
    mode: String,
    size: String,
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
        r#"SELECT mode, size, seed, finished_at,
                  EXTRACT(EPOCH FROM (now() - started_at))::FLOAT8 * 1000 AS elapsed_ms
           FROM snake_runs WHERE id = $1 AND user_id = $2 FOR UPDATE"#,
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
    let size = Size::parse(&run.size).ok_or_else(|| AppError::Validation("unknown board size".into()))?;

    let summary = engine::replay(run.seed as u32, mode, size, &req.turns, req.quit_at)
        .map_err(|e| AppError::Validation(e.message().into()))?;
    // The run can't be over before that much real time has passed.
    if (run.elapsed_ms as i64) + CLOCK_SLACK_MS < summary.game_ms as i64 {
        return Err(AppError::Validation("run finished too fast".into()));
    }

    let previous_best = mode_best(&mut tx, user.user_id, mode).await?;
    let score = summary.score.min(i32::MAX as u32) as i32;
    let ended_by = summary.ended_by.map(|e| e.as_str());

    sqlx::query(
        r#"UPDATE snake_runs SET finished_at = now(), score = $2, max_length = $3, best_combo = $4,
               eaten = $5, golden = $6, powers = $7, close_calls = $8, bugs_eaten = $9,
               ticks = $10, ended_by = $11
           WHERE id = $1"#,
    )
    .bind(run_id)
    .bind(score)
    .bind(summary.max_length as i32)
    .bind(summary.best_combo as i16)
    .bind(summary.eaten as i32)
    .bind(summary.golden as i32)
    .bind(summary.powers as i32)
    .bind(summary.close_calls as i32)
    .bind(summary.bugs_eaten as i32)
    .bind(summary.ticks as i32)
    .bind(ended_by)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO scores (user_id, game_id, score, level, gained, detail) VALUES ($1, $2, $3, $4, $3, $5)",
    )
    .bind(user.user_id)
    .bind(GAME_ID)
    .bind(score)
    .bind(mode.board_id())
    .bind(summary.max_length.to_string())
    .execute(&mut *tx)
    .await?;

    let mut rewards = Granted::default();
    let mut drop = None;
    if summary.ticks >= MIN_REWARD_TICKS {
        let ev = quests::Event::SnakeRun { score: i64::from(score), best_combo: i64::from(summary.best_combo) };
        quests::api::record(&mut tx, user.user_id, &[ev]).await?;
        let reward = score_round_reward(score, &mut rand::thread_rng());
        rewards = economy::grant(&mut tx, user.user_id, reward, "snake_signal_run", true).await?;

        // Lucky drop: a big run may give a skin, arena or trail you don't own.
        let roll: f64 = rand::thread_rng().gen();
        if i64::from(score) >= items::DROP_MIN_SCORE && roll < items::DROP_CHANCE {
            let owned = owned_keys(&mut *tx, user.user_id).await?;
            let pick = items::items().random_unowned(&owned, &mut rand::thread_rng());
            if let Some(k) = pick {
                sqlx::query(
                    "INSERT INTO snake_items (user_id, item_key, source) VALUES ($1, $2, 'drop') ON CONFLICT DO NOTHING",
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

    Ok(Json(FinishResponse { mode, size, summary, previous_best, new_best: score > previous_best, rewards, drop }))
}

/// Best score on a mode's leaderboard (Daily: today only).
async fn mode_best(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    mode: Mode,
) -> AppResult<i32> {
    let since = if mode == Mode::Daily {
        daily::today_start(Utc::now())
    } else {
        chrono::DateTime::<Utc>::UNIX_EPOCH
    };
    Ok(sqlx::query_scalar(
        r#"SELECT COALESCE(MAX(score), 0) FROM scores
           WHERE user_id = $1 AND game_id = $2 AND level = $3 AND created_at >= $4"#,
    )
    .bind(user_id)
    .bind(GAME_ID)
    .bind(mode.board_id())
    .bind(since)
    .fetch_one(&mut **tx)
    .await?)
}

// ---------------------------------------------------------------------------
// Skins, arenas and trails
// ---------------------------------------------------------------------------

async fn owned_keys(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid) -> AppResult<Vec<String>> {
    Ok(sqlx::query_scalar("SELECT item_key FROM snake_items WHERE user_id = $1")
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
    pub skins: Vec<ItemView>,
    pub arenas: Vec<ItemView>,
    pub trails: Vec<ItemView>,
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
    Ok(Collection { skins: view(ItemKind::Skin), arenas: view(ItemKind::Arena), trails: view(ItemKind::Trail) })
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
        "INSERT INTO snake_items (user_id, item_key, source) VALUES ($1, $2, 'shop') ON CONFLICT DO NOTHING",
    )
    .bind(user.user_id)
    .bind(&key)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict(format!("you already own {}", it.name)));
    }
    economy::spend(&mut tx, user.user_id, price, 0, &format!("snake_shop:{key}")).await?;
    tx.commit().await?;
    Ok(Json(collection_of(&state, user.user_id).await?))
}
