//! Memory Match routes outside the room: the power-up locker (see and buy
//! powers), plus what the online rooms call when a game ends (one
//! `memory_games` row per player, quests).

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::items::{self, items};
use super::rules::{Game, Power};
use crate::auth::jwt::AuthUser;
use crate::character::catalog::Rarity;
use crate::economy::{self, GameResult};
use crate::error::{AppError, AppResult};
use crate::quests;
use crate::state::AppState;

pub async fn owned_keys(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid) -> AppResult<Vec<String>> {
    Ok(sqlx::query_scalar("SELECT item_key FROM memory_items WHERE user_id = $1").bind(user_id).fetch_all(ex).await?)
}

/// Every power in `kit` is free or bought by `user_id`.
pub async fn check_owned(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid, kit: &[Power]) -> AppResult<()> {
    let owned = owned_keys(ex, user_id).await?;
    for p in kit {
        if !items().owns(p.id(), &owned) {
            let name = items().find(p.id()).map_or(p.id(), |i| i.name.as_str());
            return Err(AppError::Validation(format!("you don't own {name} yet")));
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct PowerView {
    pub id: String,
    pub name: String,
    pub rarity: Rarity,
    pub price: Option<i64>,
    pub owned: bool,
}

#[derive(Serialize)]
pub struct Collection {
    pub powers: Vec<PowerView>,
}

async fn collection_of(state: &AppState, user_id: Uuid) -> AppResult<Collection> {
    let owned = owned_keys(&state.pool, user_id).await?;
    let cat = items();
    Ok(Collection {
        powers: cat
            .powers
            .iter()
            .map(|p| PowerView { id: p.id.clone(), name: p.name.clone(), rarity: p.rarity, price: p.price, owned: cat.owns(&p.id, &owned) })
            .collect(),
    })
}

/// `GET /api/games/memory-match/collection`
pub async fn collection(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Collection>> {
    Ok(Json(collection_of(&state, user.user_id).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuyRequest {
    pub id: String,
}

/// `POST /api/games/memory-match/buy`
pub async fn buy(State(state): State<AppState>, user: AuthUser, Json(req): Json<BuyRequest>) -> AppResult<Json<Collection>> {
    let p = items().find(&req.id).ok_or_else(|| AppError::Validation(format!("unknown power: {}", req.id)))?;
    let price = p.price.ok_or_else(|| AppError::Validation(format!("{} is already free", p.name)))?;
    let key = items::key(&p.id);
    let mut tx = state.pool.begin().await?;
    let inserted = sqlx::query("INSERT INTO memory_items (user_id, item_key, source) VALUES ($1, $2, 'shop') ON CONFLICT DO NOTHING")
        .bind(user.user_id)
        .bind(&key)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict(format!("you already own {}", p.name)));
    }
    economy::spend(&mut tx, user.user_id, price, 0, &format!("memory_shop:{key}")).await?;
    tx.commit().await?;
    Ok(Json(collection_of(&state, user.user_id).await?))
}

/// A finished room game: save it for `user_id` (who played as `player`,
/// 0 = moved first) and move their quests along.
pub async fn record_game(tx: &mut Transaction<'_, Postgres>, room_id: Uuid, user_id: Uuid, g: &Game, player: usize) -> AppResult<()> {
    let result = match g.pairs[player].cmp(&g.pairs[1 - player]) {
        std::cmp::Ordering::Greater => GameResult::Win,
        std::cmp::Ordering::Less => GameResult::Loss,
        std::cmp::Ordering::Equal => GameResult::Draw,
    };
    let s = g.stats[player];
    sqlx::query(
        r#"INSERT INTO memory_games (user_id, room_id, mode, size, result, pairs, misses, best_run, powers)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
    )
    .bind(user_id)
    .bind(room_id)
    .bind(g.setup.mode.as_str())
    .bind(g.setup.size.as_str())
    .bind(match result {
        GameResult::Win => "win",
        GameResult::Loss => "loss",
        GameResult::Draw => "draw",
    })
    .bind(g.pairs[player] as i16)
    .bind(s.misses.min(i16::MAX as u32) as i16)
    .bind(s.best_run as i16)
    .bind(s.powers as i16)
    .execute(&mut **tx)
    .await?;
    let ev = quests::Event::MemoryGame { result, powers: i64::from(s.powers) };
    quests::api::record(tx, user_id, &[ev]).await?;
    Ok(())
}
