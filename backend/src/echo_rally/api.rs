//! Echo Rally against Zero-Bot: `start` hands out a seed, `finish` replays
//! the player's inputs against the bot and pays out. Also the shop (powers
//! and cosmetics).
//!
//! Board (`scores.level`): 1 = vs Zero-Bot, a running total like Checkers.
//! A win is worth (level 1–4) x (points to win); a loss 0. `detail` is the
//! bot level beaten.

use axum::extract::{Path, State};
use axum::Json;
use chrono::Utc;
use rand::Rng as _;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::bot::bot_kit;
use super::engine::{self, kit_ok, rules, BotMatch, Input, Power, Summary};
use super::items::{self, Kind as ItemKind};
use crate::auth::jwt::AuthUser;
use crate::economy::{self, game_xp, GameResult, Granted, Reward};
use crate::error::{AppError, AppResult};
use crate::quests;
use crate::state::AppState;

pub const GAME_ID: &str = "echo-rally";
/// `scores.level` of the vs Zero-Bot board.
pub const BOARD_BOT: i32 = 1;
/// A match must be finished within this many minutes of starting.
const MATCH_EXPIRY_MIN: i64 = 60;
/// Allowed difference between the game clock and the server clock (ms).
const CLOCK_SLACK_MS: i64 = 3_000;
/// Matches shorter than this (10 s) pay nothing and don't count for quests.
pub const MIN_REWARD_TICKS: u32 = 600;

/// Does a finished match pay and count? Not if you left it (so starting and
/// quitting can't farm loss XP or quests), nor if it was very short.
pub fn counts(s: &Summary) -> bool {
    s.ended_by != Some(engine::End::Quit) && s.ticks >= MIN_REWARD_TICKS
}

pub const LEVELS: [&str; 4] = ["easy", "medium", "hard", "master"];
const LEVEL_NAMES: [&str; 4] = ["Easy", "Medium", "Hard", "Master"];

pub fn parse_level(s: &str) -> Option<usize> {
    LEVELS.iter().position(|l| *l == s)
}

/// Coins for beating each level and the token chance in % (like Checkers).
pub fn win_coins(level: usize) -> (i64, u32) {
    [(8, 5), (20, 10), (40, 20), (90, 40)][level.min(3)]
}

/// Board points for a finished match.
pub fn points(level: usize, target: u32, won: bool) -> i32 {
    if won {
        (level as i32 + 1) * target as i32
    } else {
        0
    }
}

/// The reward for a finished match against Zero-Bot.
pub fn reward(level: usize, won: bool, rng: &mut impl rand::Rng) -> Reward {
    let mult = level as i64 + 1;
    if !won {
        return Reward { coins: 0, tokens: 0, xp: game_xp(GameResult::Loss, mult) };
    }
    let (coins, token_pct) = win_coins(level);
    let tokens = economy::roll_token(f64::from(token_pct) / 100.0, rng);
    Reward { coins, tokens, xp: game_xp(GameResult::Win, mult) }
}

/// Power ids from a request, as a kit.
fn parse_kit(ids: &[String]) -> AppResult<Vec<Power>> {
    ids.iter()
        .map(|s| Power::parse(s).ok_or_else(|| AppError::Validation(format!("unknown power: {s}"))))
        .collect()
}

fn kit_code(kit: &[Power]) -> String {
    kit.iter().map(|p| p.id()).collect::<Vec<_>>().join(",")
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartRequest {
    /// Points to win: 5, 7 or 11.
    pub target: u32,
    /// "easy", "medium", "hard" or "master".
    pub level: String,
    /// "classic" or "chaos".
    pub mode: String,
    /// Chaos: 3 different power ids you own.
    #[serde(default)]
    pub kit: Vec<String>,
    /// Cosmetics; you must own them. Default: the first free one.
    #[serde(default)]
    pub paddle: Option<String>,
    #[serde(default)]
    pub ball: Option<String>,
    #[serde(default)]
    pub court: Option<String>,
}

#[derive(Serialize)]
pub struct StartResponse {
    pub match_id: Uuid,
    pub seed: u32,
    pub target: u32,
    pub level: &'static str,
    pub chaos: bool,
    pub kit: Vec<Power>,
    /// The powers Zero-Bot brings (empty in Classic).
    pub bot_kit: Vec<Power>,
}

pub async fn start(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<StartRequest>,
) -> AppResult<Json<StartResponse>> {
    if !rules().targets.contains(&req.target) {
        return Err(AppError::Validation("play to 5, 7 or 11 points".into()));
    }
    let level = parse_level(&req.level).ok_or_else(|| AppError::Validation("unknown level".into()))?;
    let chaos = match req.mode.as_str() {
        "classic" => false,
        "chaos" => true,
        _ => return Err(AppError::Validation("unknown mode".into())),
    };
    let kit = parse_kit(&req.kit)?;
    if chaos && !kit_ok(&kit) {
        return Err(AppError::Validation("pick 3 different powers".into()));
    }
    if !chaos && !kit.is_empty() {
        return Err(AppError::Validation("powers are only for Chaos".into()));
    }

    let cat = items::items();
    let owned = owned_keys(&state.pool, user.user_id).await?;
    if let Some(p) = cat.missing_power(&kit, &owned) {
        return Err(AppError::Validation(format!("you don't own {} yet", p.name)));
    }
    let pick = |kind: ItemKind, want: Option<String>| -> AppResult<String> {
        let id = want.unwrap_or_else(|| cat.default_id(kind).to_string());
        if cat.owns(kind, &id, &owned) {
            Ok(id)
        } else {
            Err(AppError::Validation(format!("you don't own that {}", kind.prefix())))
        }
    };
    let paddle = pick(ItemKind::Paddle, req.paddle)?;
    let ball = pick(ItemKind::Ball, req.ball)?;
    let court = pick(ItemKind::Court, req.court)?;

    let seed: u32 = rand::thread_rng().gen();
    let mut tx = state.pool.begin().await?;
    // A match left unfinished counts as a loss.
    sqlx::query(
        r#"UPDATE rally_matches SET finished_at = now(), won = FALSE, ended_by = 'abandoned'
           WHERE user_id = $1 AND finished_at IS NULL"#,
    )
    .bind(user.user_id)
    .execute(&mut *tx)
    .await?;
    let match_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO rally_matches (user_id, seed, target, level, mode, kit, paddle, ball, court)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id"#,
    )
    .bind(user.user_id)
    .bind(i64::from(seed))
    .bind(req.target as i16)
    .bind(level as i16)
    .bind(if chaos { "chaos" } else { "classic" })
    .bind(kit_code(&kit))
    .bind(&paddle)
    .bind(&ball)
    .bind(&court)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;

    let bot_kit = if chaos { bot_kit(seed, level) } else { Vec::new() };
    Ok(Json(StartResponse { match_id, seed, target: req.target, level: LEVELS[level], chaos, kit, bot_kit }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FinishRequest {
    /// `[tick, value]`: a paddle target y, or -1/-2/-3 to fire a kit slot.
    pub inputs: Vec<Input>,
    /// The tick where you left the match (a loss that pays nothing); None =
    /// it was played out.
    #[serde(default)]
    pub quit_at: Option<u32>,
}

#[derive(Serialize)]
pub struct FinishResponse {
    pub summary: Summary,
    pub won: bool,
    /// Board points this match added, and your running total.
    pub points: i32,
    pub total: i32,
    pub rewards: Granted,
    /// Lucky drop: an item key ("ball:comet") you just got, if any.
    pub drop: Option<String>,
}

#[derive(sqlx::FromRow)]
struct MatchRow {
    seed: i64,
    target: i16,
    level: i16,
    mode: String,
    kit: String,
    finished_at: Option<chrono::DateTime<Utc>>,
    elapsed_ms: f64,
}

impl MatchRow {
    fn bot_match(&self) -> AppResult<BotMatch> {
        let kit = if self.kit.is_empty() {
            Vec::new()
        } else {
            self.kit
                .split(',')
                .map(|s| Power::parse(s).ok_or_else(|| AppError::Internal(anyhow::anyhow!("bad power in rally_matches.kit"))))
                .collect::<AppResult<_>>()?
        };
        Ok(BotMatch {
            seed: self.seed as u32,
            target: self.target as u32,
            level: self.level as usize,
            chaos: self.mode == "chaos",
            kit,
        })
    }
}

pub async fn finish(
    State(state): State<AppState>,
    user: AuthUser,
    Path(match_id): Path<Uuid>,
    Json(req): Json<FinishRequest>,
) -> AppResult<Json<FinishResponse>> {
    let mut tx = state.pool.begin().await?;
    let row: MatchRow = sqlx::query_as(
        r#"SELECT seed, target, level, mode, kit, finished_at,
                  EXTRACT(EPOCH FROM (now() - started_at))::FLOAT8 * 1000 AS elapsed_ms
           FROM rally_matches WHERE id = $1 AND user_id = $2 FOR UPDATE"#,
    )
    .bind(match_id)
    .bind(user.user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    if row.finished_at.is_some() {
        return Err(AppError::Conflict("this match is already over".into()));
    }
    if row.elapsed_ms > (MATCH_EXPIRY_MIN * 60_000) as f64 {
        return Err(AppError::Validation("this match has expired".into()));
    }
    let m = row.bot_match()?;
    let summary = engine::replay(&m, &req.inputs, req.quit_at).map_err(|e| AppError::Validation(e.message().into()))?;
    // The match can't be over before that much real time has passed.
    if (row.elapsed_ms as i64) + CLOCK_SLACK_MS < summary.game_ms as i64 {
        return Err(AppError::Validation("match finished too fast".into()));
    }
    let won = summary.winner == Some(0);

    sqlx::query(
        r#"UPDATE rally_matches SET finished_at = now(), score_me = $2, score_bot = $3, won = $4, ended_by = $5,
               ticks = $6, hits = $7, longest_rally = $8, powers = $9
           WHERE id = $1"#,
    )
    .bind(match_id)
    .bind(summary.score[0] as i16)
    .bind(summary.score[1] as i16)
    .bind(won)
    .bind(summary.ended_by.map(|e| e.as_str()))
    .bind(summary.ticks as i32)
    .bind(summary.hits[0] as i32)
    .bind(summary.longest_rally as i32)
    .bind(summary.powers[0] as i16)
    .execute(&mut *tx)
    .await?;

    let total_before: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(score), 0) FROM scores WHERE user_id = $1 AND game_id = $2 AND level = $3",
    )
    .bind(user.user_id)
    .bind(GAME_ID)
    .bind(BOARD_BOT)
    .fetch_one(&mut *tx)
    .await?;
    let mut pts = 0;
    let mut rewards = Granted::default();
    let mut drop = None;
    if counts(&summary) {
        pts = points(m.level, m.target, won);
        sqlx::query(
            "INSERT INTO scores (user_id, game_id, score, level, gained, detail) VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(user.user_id)
        .bind(GAME_ID)
        .bind(total_before + pts)
        .bind(BOARD_BOT)
        .bind(pts)
        .bind(LEVEL_NAMES[m.level])
        .execute(&mut *tx)
        .await?;
        let ev = quests::Event::RallyMatch {
            won,
            longest_rally: i64::from(summary.longest_rally),
            powers: i64::from(summary.powers[0]),
        };
        quests::api::record(&mut tx, user.user_id, &[ev]).await?;
        // Roll everything random first (the RNG can't be held across awaits).
        let (pay, lucky, pick_seed) = {
            let mut rng = rand::thread_rng();
            (reward(m.level, won, &mut rng), rng.gen_bool(items::DROP_CHANCE), rng.gen::<u64>())
        };
        rewards = economy::grant(&mut tx, user.user_id, pay, "echo_rally_match", true).await?;

        // Lucky drop: a win against Hard or Master may give a cosmetic.
        if won && m.level >= 2 && lucky {
            let owned = owned_keys(&mut *tx, user.user_id).await?;
            let pick = {
                use rand::SeedableRng;
                items::items().random_unowned(&owned, &mut rand_chacha::ChaCha8Rng::seed_from_u64(pick_seed))
            };
            if let Some(k) = pick {
                sqlx::query(
                    "INSERT INTO rally_items (user_id, item_key, source) VALUES ($1, $2, 'drop') ON CONFLICT DO NOTHING",
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

    Ok(Json(FinishResponse { summary, won, points: pts, total: total_before + pts, rewards, drop }))
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

pub async fn owned_keys(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid) -> AppResult<Vec<String>> {
    Ok(sqlx::query_scalar("SELECT item_key FROM rally_items WHERE user_id = $1")
        .bind(user_id)
        .fetch_all(ex)
        .await?)
}

/// Every power in `kit` is free or bought by `user_id` (for online rooms).
#[allow(dead_code)] // Online rooms use it from the next step.
pub async fn check_owned(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid, kit: &[Power]) -> AppResult<()> {
    let owned = owned_keys(ex, user_id).await?;
    match items::items().missing_power(kit, &owned) {
        Some(p) => Err(AppError::Validation(format!("you don't own {} yet", p.name))),
        None => Ok(()),
    }
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
    pub powers: Vec<ItemView>,
    pub paddles: Vec<ItemView>,
    pub balls: Vec<ItemView>,
    pub courts: Vec<ItemView>,
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
        powers: view(ItemKind::Power),
        paddles: view(ItemKind::Paddle),
        balls: view(ItemKind::Ball),
        courts: view(ItemKind::Court),
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
        "INSERT INTO rally_items (user_id, item_key, source) VALUES ($1, $2, 'shop') ON CONFLICT DO NOTHING",
    )
    .bind(user.user_id)
    .bind(&key)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict(format!("you already own {}", it.name)));
    }
    economy::spend(&mut tx, user.user_id, price, 0, &format!("rally_shop:{key}")).await?;
    tx.commit().await?;
    Ok(Json(collection_of(&state, user.user_id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    #[test]
    fn levels_round_trip() {
        for (i, l) in LEVELS.iter().enumerate() {
            assert_eq!(parse_level(l), Some(i));
        }
        assert_eq!(parse_level("expert"), None);
        assert_eq!(LEVELS.len(), rules().bot.len());
    }

    #[test]
    fn points_grow_with_level_and_target() {
        assert_eq!(points(0, 5, true), 5);
        assert_eq!(points(3, 11, true), 44);
        assert_eq!(points(2, 7, false), 0);
    }

    #[test]
    fn leaving_a_match_pays_nothing() {
        let mut s = Summary {
            score: [0, 3],
            winner: Some(1),
            ended_by: Some(engine::End::Quit),
            ticks: 5000,
            game_ms: 0,
            hits: [0, 0],
            longest_rally: 0,
            powers: [0, 0],
        };
        assert!(!counts(&s));
        s.ended_by = Some(engine::End::Win);
        assert!(counts(&s));
        s.ticks = MIN_REWARD_TICKS - 1;
        assert!(!counts(&s));
    }

    #[test]
    fn rewards_follow_checkers() {
        let mut r = ChaCha8Rng::seed_from_u64(1);
        assert_eq!(reward(3, true, &mut r).coins, 90);
        assert_eq!(reward(3, true, &mut r).xp, 80);
        assert_eq!(reward(0, true, &mut r).coins, 8);
        let lost = reward(2, false, &mut r);
        assert_eq!((lost.coins, lost.tokens, lost.xp), (0, 0, 15));
    }

    #[test]
    fn kits_parse_and_print() {
        let kit = parse_kit(&["grow".into(), "multi-ball".into(), "fog".into()]).unwrap();
        assert_eq!(kit_code(&kit), "grow,multi-ball,fog");
        assert!(parse_kit(&["laser".into()]).is_err());
        let row = MatchRow {
            seed: 4_000_000_000,
            target: 7,
            level: 3,
            mode: "chaos".into(),
            kit: kit_code(&kit),
            finished_at: None,
            elapsed_ms: 0.0,
        };
        let m = row.bot_match().unwrap();
        assert_eq!((m.seed, m.target, m.level, m.chaos), (4_000_000_000, 7, 3, true));
        assert_eq!(m.kit, kit);
        let classic = MatchRow { mode: "classic".into(), kit: String::new(), ..row };
        assert!(classic.bot_match().unwrap().kit.is_empty());
    }
}
