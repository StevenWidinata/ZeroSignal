//! Brick Breaker runs: `start` hands out a seed, `finish` replays the paddle
//! inputs and pays out. Also the Campaign progress, the shop and the boards.
//!
//! Boards (`scores.level`): Endless (best score), Campaign (total stars, ties
//! broken by the best clearing scores added up, stored as one number, see
//! [`campaign_points`]) and the Daily.

use axum::extract::{Path, State};
use axum::Json;
use chrono::{Datelike, Utc};
use rand::Rng as _;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::engine::{self, Input, Summary};
use super::items::{self, Kind as ItemKind};
use super::levels::{self, LEVEL_COUNT};
use crate::auth::jwt::AuthUser;
use crate::daily;
use crate::economy::{self, Granted, Reward};
use crate::error::{AppError, AppResult};
use crate::quests;
use crate::scores::score_round_reward;
use crate::state::AppState;

pub const GAME_ID: &str = "brick-breaker";
/// A run must be finished within this many minutes of starting.
const RUN_EXPIRY_MIN: i64 = 60;
/// Allowed difference between the game clock and the server clock (ms).
const CLOCK_SLACK_MS: i64 = 3_000;
/// Runs shorter than this (10 s) still score, but pay nothing and don't count
/// for quests (so quitting at once can't farm them). A Campaign clear always
/// counts.
pub const MIN_REWARD_TICKS: u32 = 600;
/// Coins paid once for each Campaign star earned for the first time.
pub const STAR_COINS: i64 = 10;

/// `scores.level` of each board.
pub const BOARD_ENDLESS: i32 = 1;
pub const BOARD_CAMPAIGN: i32 = 2;
pub const BOARD_DAILY: i32 = 3;

/// The Campaign board ranks by stars, then by the summed best scores. Both
/// fit one INTEGER: `stars × 10,000,000 + score` (72 stars → 720,000,000;
/// a level scores a few thousand, so the sum stays far below 10,000,000).
pub const CAMPAIGN_STAR_UNIT: i64 = 10_000_000;

pub fn campaign_points(stars: i64, score: i64) -> i32 {
    let p = stars.clamp(0, 3 * i64::from(LEVEL_COUNT)) * CAMPAIGN_STAR_UNIT + score.clamp(0, CAMPAIGN_STAR_UNIT - 1);
    p as i32
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Campaign,
    Endless,
    Daily,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        match s {
            "campaign" => Some(Mode::Campaign),
            "endless" => Some(Mode::Endless),
            "daily" => Some(Mode::Daily),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Campaign => "campaign",
            Mode::Endless => "endless",
            Mode::Daily => "daily",
        }
    }
}

/// The highest Campaign level you may play: levels open one by one, so it's
/// the first level you haven't cleared yet (the last one once all are clear).
pub fn unlocked_up_to(cleared: &[i32]) -> i32 {
    let top = LEVEL_COUNT as i32;
    (1..=top).find(|l| !cleared.contains(l)).unwrap_or(top)
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartRequest {
    pub mode: String,
    /// Campaign only: the level to play (1-24).
    #[serde(default)]
    pub level: Option<i32>,
    /// Cosmetics; you must own them. Default: the first free one.
    #[serde(default)]
    pub paddle: Option<String>,
    #[serde(default)]
    pub ball: Option<String>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub backdrop: Option<String>,
}

#[derive(Serialize)]
pub struct StartResponse {
    pub run_id: Uuid,
    pub seed: u32,
    pub mode: Mode,
    pub level: Option<i32>,
}

const DAILY_DONE: &str = "you already played today's Daily. Come back tomorrow!";

pub async fn start(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<StartRequest>,
) -> AppResult<Json<StartResponse>> {
    let mode = Mode::parse(&req.mode).ok_or_else(|| AppError::Validation("unknown mode".into()))?;
    let level = match (mode, req.level) {
        (Mode::Campaign, Some(l)) => {
            if !(1..=LEVEL_COUNT as i32).contains(&l) {
                return Err(AppError::Validation("unknown level".into()));
            }
            let cleared = cleared_levels(&state.pool, user.user_id).await?;
            if l > unlocked_up_to(&cleared) {
                return Err(AppError::Validation("clear the previous level first".into()));
            }
            Some(l)
        }
        (Mode::Campaign, None) => return Err(AppError::Validation("pick a level".into())),
        (_, Some(_)) => return Err(AppError::Validation("only the Campaign has levels".into())),
        (_, None) => None,
    };

    let cat = items::items();
    let owned = owned_keys(&state.pool, user.user_id).await?;
    let pick = |kind: ItemKind, want: Option<String>| -> AppResult<String> {
        let id = want.unwrap_or_else(|| cat.default_id(kind).to_string());
        if cat.owns(kind, &id, &owned) {
            Ok(id)
        } else {
            Err(AppError::Validation(format!("you don't own that {}", kind.noun())))
        }
    };
    let paddle = pick(ItemKind::Paddle, req.paddle)?;
    let ball = pick(ItemKind::Ball, req.ball)?;
    let theme = pick(ItemKind::Theme, req.theme)?;
    let backdrop = pick(ItemKind::Backdrop, req.backdrop)?;

    // The Daily is the same waves and drops for everyone, one try per WIB day.
    let (seed, day) = if mode == Mode::Daily {
        let d = daily::wib_date(Utc::now());
        let played: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM brick_runs WHERE user_id = $1 AND mode = 'daily' AND day = $2)",
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
        r#"INSERT INTO brick_runs (user_id, mode, level, seed, day, paddle, ball, theme, backdrop)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id"#,
    )
    .bind(user.user_id)
    .bind(mode.as_str())
    .bind(level.map(|l| l as i16))
    .bind(i64::from(seed))
    .bind(day)
    .bind(&paddle)
    .bind(&ball)
    .bind(&theme)
    .bind(&backdrop)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(d) if d.is_unique_violation() => AppError::Conflict(DAILY_DONE.into()),
        _ => AppError::from(e),
    })?;

    Ok(Json(StartResponse { run_id, seed, mode, level }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FinishRequest {
    /// `[tick, x]` pairs: a paddle target x (0..=48000), or -1 launch, -2 fire.
    pub inputs: Vec<Input>,
    /// The tick where you ended the run yourself (None = it ended by itself).
    #[serde(default)]
    pub quit_at: Option<u32>,
}

/// Campaign result: your stars on this level and what changed.
#[derive(Serialize)]
pub struct CampaignResult {
    /// Best stars on this level now (0 = never cleared).
    pub stars: u8,
    /// Stars earned for the first time by this run (they paid `star_coins`).
    pub new_stars: u8,
    pub star_coins: i64,
    pub total_stars: i64,
    /// Best clearing scores of every level added up.
    pub total_score: i64,
    pub unlocked_up_to: i32,
    /// This run opened the next level.
    pub unlocked_next: bool,
}

#[derive(Serialize)]
pub struct FinishResponse {
    pub mode: Mode,
    pub level: Option<i32>,
    pub summary: Summary,
    /// Endless: best score before the run. Daily: 0 (one try). Campaign: your
    /// best clearing score on this level before the run.
    pub previous_best: i32,
    pub new_best: bool,
    pub rewards: Granted,
    pub campaign: Option<CampaignResult>,
    /// Lucky drop: an item key ("ball:comet") you just got, if any.
    pub drop: Option<String>,
}

#[derive(sqlx::FromRow)]
struct RunRow {
    mode: String,
    level: Option<i16>,
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
        r#"SELECT mode, level, seed, finished_at,
                  EXTRACT(EPOCH FROM (now() - started_at))::FLOAT8 * 1000 AS elapsed_ms
           FROM brick_runs WHERE id = $1 AND user_id = $2 FOR UPDATE"#,
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
    let level = run.level.map(i32::from);
    let layout = match level {
        Some(l) => Some(levels::level(l as u32).ok_or_else(|| AppError::Validation("unknown level".into()))?),
        None => None,
    };

    let summary = engine::replay(run.seed as u32, layout, &req.inputs, req.quit_at)
        .map_err(|e| AppError::Validation(e.message().into()))?;
    // The run can't be over before that much real time has passed.
    if (run.elapsed_ms as i64) + CLOCK_SLACK_MS < summary.game_ms as i64 {
        return Err(AppError::Validation("run finished too fast".into()));
    }

    let score = summary.score.min(i32::MAX as u32) as i32;
    sqlx::query(
        r#"UPDATE brick_runs SET finished_at = now(), score = $2, bricks = $3, cleared = $4, stars = $5,
               wave = $6, best_combo = $7, best_chain = $8, drops = $9, lost = $10, ticks = $11, ended_by = $12
           WHERE id = $1"#,
    )
    .bind(run_id)
    .bind(score)
    .bind(summary.bricks as i32)
    .bind(summary.cleared)
    .bind(summary.stars as i16)
    .bind(summary.wave as i32)
    .bind(summary.best_combo as i32)
    .bind(summary.best_chain as i32)
    .bind(summary.drops as i32)
    .bind(summary.lost as i32)
    .bind(summary.ticks as i32)
    .bind(summary.ended_by.map(|e| e.as_str()))
    .execute(&mut *tx)
    .await?;

    let campaign_clear = mode == Mode::Campaign && summary.cleared;
    let (previous_best, campaign) = match level {
        Some(l) => {
            let (before, result) = record_campaign(&mut tx, user.user_id, l, &summary, score).await?;
            (before, Some(result))
        }
        None => {
            let board = if mode == Mode::Daily { BOARD_DAILY } else { BOARD_ENDLESS };
            let before = board_best(&mut tx, user.user_id, mode).await?;
            sqlx::query(
                "INSERT INTO scores (user_id, game_id, score, level, gained, detail) VALUES ($1, $2, $3, $4, $3, $5)",
            )
            .bind(user.user_id)
            .bind(GAME_ID)
            .bind(score)
            .bind(board)
            .bind(summary.wave.to_string())
            .execute(&mut *tx)
            .await?;
            (before, None)
        }
    };
    let new_best = if mode == Mode::Campaign { campaign_clear && score > previous_best } else { score > previous_best };

    let mut rewards = Granted::default();
    let mut drop = None;
    if summary.ticks >= MIN_REWARD_TICKS || campaign_clear {
        let ev = quests::Event::BrickRun {
            bricks: i64::from(summary.bricks),
            level_cleared: campaign_clear,
            endless_wave: if mode == Mode::Endless { i64::from(summary.wave) } else { 0 },
        };
        quests::api::record(&mut tx, user.user_id, &[ev]).await?;
        let reward = score_round_reward(score, &mut rand::thread_rng());
        rewards = economy::grant(&mut tx, user.user_id, reward, "brick_breaker_run", true).await?;

        // Lucky drop: a 3-star clear or a big Endless / Daily run may give a
        // paddle, ball, brick theme or backdrop you don't own.
        let lucky = if mode == Mode::Campaign { summary.stars >= 3 } else { i64::from(score) >= items::DROP_MIN_SCORE };
        let roll: f64 = rand::thread_rng().gen();
        if lucky && roll < items::DROP_CHANCE {
            let owned = owned_keys(&mut *tx, user.user_id).await?;
            let pick = items::items().random_unowned(&owned, &mut rand::thread_rng());
            if let Some(k) = pick {
                sqlx::query(
                    "INSERT INTO brick_items (user_id, item_key, source) VALUES ($1, $2, 'drop') ON CONFLICT DO NOTHING",
                )
                .bind(user.user_id)
                .bind(&k)
                .execute(&mut *tx)
                .await?;
                drop = Some(k);
            }
        }
    }
    // New stars pay once, outside the daily coin cap (they can't be farmed).
    if let Some(c) = campaign.as_ref().filter(|c| c.star_coins > 0) {
        let bonus = Reward { coins: c.star_coins, tokens: 0, xp: 0 };
        let g = economy::grant(&mut tx, user.user_id, bonus, "brick_breaker_stars", false).await?;
        rewards = Granted {
            coins: rewards.coins + g.coins,
            tokens: rewards.tokens + g.tokens,
            xp: rewards.xp + g.xp,
            coins_capped: rewards.coins_capped + g.coins_capped,
            level_before: if rewards == Granted::default() { g.level_before } else { rewards.level_before },
            level_after: g.level_after,
        };
    }
    tx.commit().await?;

    Ok(Json(FinishResponse { mode, level, summary, previous_best, new_best, rewards, campaign, drop }))
}

/// Saves a Campaign run: best stars and score on the level, the Campaign
/// board and the new stars. Returns the level's best clearing score before.
async fn record_campaign(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    level: i32,
    summary: &Summary,
    score: i32,
) -> AppResult<(i32, CampaignResult)> {
    // One Campaign update at a time per player, so two runs finishing at
    // once can't both pay the same new star.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('brick_levels'), hashtext($1::text))")
        .bind(user_id)
        .execute(&mut **tx)
        .await?;
    let before: Option<(i16, i32)> =
        sqlx::query_as("SELECT stars, best_score FROM brick_levels WHERE user_id = $1 AND level = $2")
            .bind(user_id)
            .bind(level as i16)
            .fetch_optional(&mut **tx)
            .await?;
    let (stars_before, best_before) = before.map_or((0u8, 0), |(s, b)| (s as u8, b));
    let cleared_before = before.is_some();

    let stars_now = if summary.cleared { (summary.stars.min(3) as u8).max(stars_before) } else { stars_before };
    let new_stars = stars_now - stars_before;
    if summary.cleared {
        sqlx::query(
            r#"INSERT INTO brick_levels (user_id, level, stars, best_score) VALUES ($1, $2, $3, $4)
               ON CONFLICT (user_id, level) DO UPDATE
               SET stars = GREATEST(brick_levels.stars, EXCLUDED.stars),
                   best_score = GREATEST(brick_levels.best_score, EXCLUDED.best_score),
                   updated_at = now()"#,
        )
        .bind(user_id)
        .bind(level as i16)
        .bind(summary.stars.clamp(1, 3) as i16)
        .bind(score.max(0))
        .execute(&mut **tx)
        .await?;
    }

    let (total_stars, total_score, cleared) = campaign_totals(&mut **tx, user_id).await?;
    // The Campaign board moves only when your stars or summed score grow.
    if summary.cleared && (new_stars > 0 || score > best_before) {
        sqlx::query(
            "INSERT INTO scores (user_id, game_id, score, level, gained, detail) VALUES ($1, $2, $3, $4, $3, $5)",
        )
        .bind(user_id)
        .bind(GAME_ID)
        .bind(campaign_points(total_stars, total_score))
        .bind(BOARD_CAMPAIGN)
        .bind(total_stars.to_string())
        .execute(&mut **tx)
        .await?;
    }
    let up_to = unlocked_up_to(&cleared);
    Ok((
        best_before,
        CampaignResult {
            stars: stars_now,
            new_stars,
            star_coins: STAR_COINS * i64::from(new_stars),
            total_stars,
            total_score,
            unlocked_up_to: up_to,
            unlocked_next: summary.cleared && !cleared_before && up_to > level,
        },
    ))
}

/// Total stars, summed best clearing scores and the cleared levels.
async fn campaign_totals(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid) -> AppResult<(i64, i64, Vec<i32>)> {
    let rows: Vec<(i16, i16, i32)> =
        sqlx::query_as("SELECT level, stars, best_score FROM brick_levels WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(ex)
            .await?;
    Ok((
        rows.iter().map(|r| i64::from(r.1)).sum(),
        rows.iter().map(|r| i64::from(r.2)).sum(),
        rows.iter().map(|r| i32::from(r.0)).collect(),
    ))
}

async fn cleared_levels(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid) -> AppResult<Vec<i32>> {
    Ok(campaign_totals(ex, user_id).await?.2)
}

/// Best score on the Endless board, or today's on the Daily board.
async fn board_best(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, user_id: Uuid, mode: Mode) -> AppResult<i32> {
    let (board, since) = if mode == Mode::Daily {
        (BOARD_DAILY, daily::today_start(Utc::now()))
    } else {
        (BOARD_ENDLESS, chrono::DateTime::<Utc>::UNIX_EPOCH)
    };
    Ok(sqlx::query_scalar(
        r#"SELECT COALESCE(MAX(score), 0) FROM scores
           WHERE user_id = $1 AND game_id = $2 AND level = $3 AND created_at >= $4"#,
    )
    .bind(user_id)
    .bind(GAME_ID)
    .bind(board)
    .bind(since)
    .fetch_one(&mut **tx)
    .await?)
}

// ---------------------------------------------------------------------------
// Campaign progress
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct LevelView {
    pub id: u32,
    pub world: u32,
    pub name: String,
    /// Best stars (0 = not cleared yet).
    pub stars: u8,
    /// Best clearing score.
    pub best: i32,
    pub unlocked: bool,
}

#[derive(Serialize)]
pub struct ProgressView {
    pub total_stars: i64,
    pub total_score: i64,
    pub levels_cleared: usize,
    pub unlocked_up_to: i32,
    pub levels: Vec<LevelView>,
}

/// `GET /api/games/brick-breaker/levels`: every level with your stars.
pub async fn progress(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<ProgressView>> {
    let rows: Vec<(i16, i16, i32)> =
        sqlx::query_as("SELECT level, stars, best_score FROM brick_levels WHERE user_id = $1")
            .bind(user.user_id)
            .fetch_all(&state.pool)
            .await?;
    let cleared: Vec<i32> = rows.iter().map(|r| i32::from(r.0)).collect();
    let up_to = unlocked_up_to(&cleared);
    let levels = levels::levels()
        .iter()
        .map(|c| {
            let mine = rows.iter().find(|r| i32::from(r.0) == c.level.id as i32);
            LevelView {
                id: c.level.id,
                world: c.world,
                name: c.level.name.clone(),
                stars: mine.map_or(0, |r| r.1 as u8),
                best: mine.map_or(0, |r| r.2),
                unlocked: c.level.id as i32 <= up_to,
            }
        })
        .collect();
    Ok(Json(ProgressView {
        total_stars: rows.iter().map(|r| i64::from(r.1)).sum(),
        total_score: rows.iter().map(|r| i64::from(r.2)).sum(),
        levels_cleared: rows.len(),
        unlocked_up_to: up_to,
        levels,
    }))
}

// ---------------------------------------------------------------------------
// Paddles, balls, brick themes and backdrops
// ---------------------------------------------------------------------------

async fn owned_keys(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid) -> AppResult<Vec<String>> {
    Ok(sqlx::query_scalar("SELECT item_key FROM brick_items WHERE user_id = $1")
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
    pub paddles: Vec<ItemView>,
    pub balls: Vec<ItemView>,
    pub themes: Vec<ItemView>,
    pub backdrops: Vec<ItemView>,
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
    Ok(Collection {
        paddles: view(ItemKind::Paddle),
        balls: view(ItemKind::Ball),
        themes: view(ItemKind::Theme),
        backdrops: view(ItemKind::Backdrop),
    })
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
        "INSERT INTO brick_items (user_id, item_key, source) VALUES ($1, $2, 'shop') ON CONFLICT DO NOTHING",
    )
    .bind(user.user_id)
    .bind(&key)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict(format!("you already own {}", it.name)));
    }
    economy::spend(&mut tx, user.user_id, price, 0, &format!("brick_shop:{key}")).await?;
    tx.commit().await?;
    Ok(Json(collection_of(&state, user.user_id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_open_one_by_one() {
        assert_eq!(unlocked_up_to(&[]), 1);
        assert_eq!(unlocked_up_to(&[1, 2, 3]), 4);
        // A gap (can't happen in play) still stops at the first uncleared level.
        assert_eq!(unlocked_up_to(&[1, 3]), 2);
        let all: Vec<i32> = (1..=24).collect();
        assert_eq!(unlocked_up_to(&all), 24);
    }

    #[test]
    fn campaign_points_rank_stars_first_then_score() {
        assert_eq!(campaign_points(0, 0), 0);
        assert_eq!(campaign_points(1, 2_000), 10_002_000);
        // One more star beats any score.
        assert!(campaign_points(5, 0) > campaign_points(4, 9_999_999));
        // Ties on stars go to the higher score.
        assert!(campaign_points(5, 12_001) > campaign_points(5, 12_000));
        // The biggest value still fits an INTEGER, and silly input is clamped.
        assert_eq!(campaign_points(72, i64::MAX), 729_999_999);
        assert_eq!(campaign_points(1_000, 0), 720_000_000);
        assert_eq!(campaign_points(-3, -5), 0);
    }

    #[test]
    fn modes_round_trip() {
        for m in [Mode::Campaign, Mode::Endless, Mode::Daily] {
            assert_eq!(Mode::parse(m.as_str()), Some(m));
        }
        assert_eq!(Mode::parse("classic"), None);
    }
}
