//! The Ship Workshop: spend coins to take each Tactics power from Mk I to
//! Mk III (`upgrade_prices` in `shared/sonar_tactics.json`). Upgrades count
//! vs Zero-Bot and in the Campaign; online games are always Mk I. Zero-Bot
//! gets stronger powers on harder levels (`bot_mk`).

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::ai::Level;
use super::tactics::{tactics_rules, Levels, MAX_LEVEL, MK1, POWERS};
use crate::auth::jwt::AuthUser;
use crate::economy;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Coins for the next Mk of a power now at `level` (None when it's maxed).
pub fn upgrade_price(level: u8) -> Option<i64> {
    let prices = &tactics_rules().upgrade_prices;
    (1..MAX_LEVEL).contains(&level).then(|| prices[usize::from(level) - 1])
}

/// Zero-Bot's Mk for every power on `level`.
pub fn bot_levels(level: Level) -> Levels {
    [tactics_rules().bot_mk[level.as_str()]; POWERS]
}

/// A player's Mk levels (Mk I where nothing was bought).
pub async fn levels_of(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid) -> AppResult<Levels> {
    let rows: Vec<(String, i16)> = sqlx::query_as("SELECT power, level FROM sonar_upgrades WHERE user_id = $1").bind(user_id).fetch_all(ex).await?;
    let mut levels = MK1;
    for (power, level) in rows {
        if let Some(p) = tactics_rules().powers.iter().position(|s| s.id == power) {
            levels[p] = (level as u8).clamp(1, MAX_LEVEL);
        }
    }
    Ok(levels)
}

#[derive(Serialize)]
pub struct WorkshopView {
    /// Your Mk per power, in fleet order.
    pub levels: Levels,
    /// Coins for each power's next Mk (null = maxed).
    pub next_price: [Option<i64>; POWERS],
}

fn view(levels: Levels) -> WorkshopView {
    WorkshopView { levels, next_price: levels.map(upgrade_price) }
}

/// `GET /api/games/sonar/workshop`
pub async fn get(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<WorkshopView>> {
    Ok(Json(view(levels_of(&state.pool, user.user_id).await?)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpgradeRequest {
    /// "air_strike", "salvo", "radar", "torpedo" or "flare".
    pub power: String,
}

/// `POST /api/games/sonar/workshop/upgrade`: buy the next Mk of one power.
pub async fn upgrade(State(state): State<AppState>, user: AuthUser, Json(req): Json<UpgradeRequest>) -> AppResult<Json<WorkshopView>> {
    let p = tactics_rules()
        .powers
        .iter()
        .position(|s| s.id == req.power)
        .ok_or_else(|| AppError::Validation(format!("unknown power: {}", req.power)))?;
    let mut tx = state.pool.begin().await?;
    // Lock the row (or its absence) so two clicks can't buy the same Mk twice.
    let now: Option<i16> = sqlx::query_scalar("SELECT level FROM sonar_upgrades WHERE user_id = $1 AND power = $2 FOR UPDATE")
        .bind(user.user_id)
        .bind(&req.power)
        .fetch_optional(&mut *tx)
        .await?;
    let level = now.map_or(1, |l| l as u8);
    let price = upgrade_price(level).ok_or_else(|| AppError::Conflict(format!("{} is already Mk III", tactics_rules().powers[p].name)))?;
    let inserted = sqlx::query(
        r#"INSERT INTO sonar_upgrades (user_id, power, level) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, power) DO UPDATE SET level = $3, updated_at = now() WHERE sonar_upgrades.level = $4"#,
    )
    .bind(user.user_id)
    .bind(&req.power)
    .bind(i16::from(level + 1))
    .bind(i16::from(level))
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict("that upgrade was just bought, try again".into()));
    }
    economy::spend(&mut tx, user.user_id, price, 0, &format!("sonar_workshop:{}:{}", req.power, level + 1)).await?;
    let levels = levels_of(&mut *tx, user.user_id).await?;
    tx.commit().await?;
    Ok(Json(view(levels)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prices_and_zero_bot_levels() {
        assert_eq!(upgrade_price(1), Some(150));
        assert_eq!(upgrade_price(2), Some(350));
        assert_eq!(upgrade_price(3), None);
        assert_eq!(bot_levels(Level::Easy), MK1);
        assert_eq!(bot_levels(Level::Medium), MK1);
        assert_eq!(bot_levels(Level::Hard), [2; POWERS]);
        assert_eq!(bot_levels(Level::Master), [3; POWERS]);
    }
}
