//! The Daily Hunt: everyone hunts the same hidden fleet each WIB day. The
//! server keeps the fleet (like Minefield keeps its mines) and answers each
//! shot. Fewer shots = more points; pings count as shots. One try a day.

use axum::extract::State;
use axum::Json;
use chrono::{Datelike, NaiveDate, Utc};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use serde::Serialize;
use uuid::Uuid;

use super::api::{FireRequest, GAME_ID};
use super::rules::{random_fleet, Fleet, Sea, ShotResult};
use super::view::SeaView;
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

#[derive(Serialize)]
pub struct DailyView {
    pub day: NaiveDate,
    pub target: SeaView,
    /// playing | done (or "new" before the first shot)
    pub status: String,
    /// The hidden fleet, once you've sunk it all.
    pub fleet: Option<String>,
    pub last: Option<ShotResult>,
    pub points: Option<i32>,
    pub rewards: Option<Granted>,
}

#[derive(sqlx::FromRow)]
struct Run {
    moves: String,
    status: String,
}

fn view(day: NaiveDate, fleet: &Fleet, run: Option<&Run>) -> AppResult<(DailyView, Sea)> {
    let moves = run.map(|r| r.moves.as_str()).unwrap_or("");
    let (sea, results) = Sea::replay(fleet, moves).map_err(|e| AppError::Internal(anyhow::anyhow!("daily hunt: {}", e.text())))?;
    let status = run.map(|r| r.status.clone()).unwrap_or_else(|| "new".into());
    Ok((
        DailyView {
            day,
            target: SeaView::of(&sea),
            fleet: (status == "done").then(|| fleet.code()),
            status,
            last: results.last().copied(),
            points: None,
            rewards: None,
        },
        sea,
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

/// `POST /api/games/sonar/daily/fire`
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
    let (_, mut sea) = view(day, &fleet, Some(&run))?;
    let result = sea.play(mv).map_err(|e| AppError::Validation(e.text().into()))?;
    run.moves = sea.moves.join(" ");
    let (mut pts, mut rewards) = (None, None);
    if sea.all_sunk() {
        run.status = "done".into();
        let shots = sea.shots();
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
    .bind(sea.shots() as i16)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    let (mut v, _) = view(day, &fleet, Some(&run))?;
    v.last = Some(result);
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
}
