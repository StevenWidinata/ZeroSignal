//! Sonar Campaign: Tactics missions vs Zero-Bot with twists (fog, silent
//! fleets, extra mines, shields, a move limit, no powers), defined in
//! `shared/sonar_campaign.json`. Missions open one by one; each win earns up
//! to 3 stars (win / within `star_moves` moves / no ship lost) and every new
//! star pays coins once. Campaign games give no leaderboard points.

use std::sync::OnceLock;

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::ai::Level;
use super::tactics::{Levels, Setup, Twists, POWERS};
use crate::auth::jwt::AuthUser;
use crate::error::AppResult;
use crate::state::AppState;

const JSON: &str = include_str!("../../../shared/sonar_campaign.json");

#[derive(Debug, Clone, Deserialize)]
pub struct Op {
    pub id: i16,
    pub name: String,
    pub level: Level,
    pub bot_mk: u8,
    pub fog: bool,
    pub silent: bool,
    pub bot_mines: u8,
    /// [in your sea, in Zero-Bot's sea]
    pub crates: [u8; 2],
    pub bot_shields: u8,
    pub no_powers: bool,
    pub move_limit: Option<i16>,
    pub star_moves: i16,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Campaign {
    pub star_coins: i64,
    pub ops: Vec<Op>,
}

pub fn campaign() -> &'static Campaign {
    static C: OnceLock<Campaign> = OnceLock::new();
    C.get_or_init(|| serde_json::from_str(JSON).expect("shared/sonar_campaign.json"))
}

pub fn op(id: i16) -> Option<&'static Op> {
    campaign().ops.iter().find(|o| o.id == id)
}

impl Op {
    /// The game's Tactics setup: you are side 0 (your Workshop levels, unless
    /// your powers are out), Zero-Bot side 1.
    pub fn setup(&self, yours: Levels, seed: u32) -> Setup {
        Setup {
            levels: [yours, [self.bot_mk; POWERS]],
            seed,
            crates: self.crates[1],
            twists: Twists {
                fog: self.fog,
                silent_all: [false, self.silent],
                shields: [0, self.bot_shields],
                crates: Some(self.crates),
                no_powers: [self.no_powers, false],
            },
        }
    }

    /// Stars for a game: none for a loss; a win is 1, +1 within `star_moves`
    /// moves, +1 without losing a ship.
    pub fn stars(&self, won: bool, moves: i16, ships_lost: usize) -> i16 {
        if !won {
            return 0;
        }
        1 + i16::from(moves <= self.star_moves) + i16::from(ships_lost == 0)
    }

    /// Coins for `new_stars` stars earned for the first time.
    pub fn coins_for(&self, new_stars: i16) -> i64 {
        campaign().star_coins * i64::from(self.id) * i64::from(new_stars.max(0))
    }
}

/// Best stars per mission so far (missing = not won yet).
async fn progress(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid) -> AppResult<Vec<(i16, i16, i16)>> {
    Ok(sqlx::query_as("SELECT op, stars, best_moves FROM sonar_campaign WHERE user_id = $1").bind(user_id).fetch_all(ex).await?)
}

/// Mission 1 is always open; each later one opens when the one before is won.
pub async fn unlocked(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid, id: i16) -> AppResult<bool> {
    if id == 1 {
        return Ok(true);
    }
    let won: Option<i16> = sqlx::query_scalar("SELECT stars FROM sonar_campaign WHERE user_id = $1 AND op = $2")
        .bind(user_id)
        .bind(id - 1)
        .fetch_optional(ex)
        .await?;
    Ok(won.is_some())
}

/// Save a won mission; returns how many stars are new.
pub async fn record(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, user_id: Uuid, id: i16, stars: i16, moves: i16) -> AppResult<i16> {
    let before: Option<i16> = sqlx::query_scalar("SELECT stars FROM sonar_campaign WHERE user_id = $1 AND op = $2 FOR UPDATE")
        .bind(user_id)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?;
    sqlx::query(
        r#"INSERT INTO sonar_campaign (user_id, op, stars, best_moves) VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, op) DO UPDATE SET stars = GREATEST(sonar_campaign.stars, EXCLUDED.stars),
               best_moves = LEAST(sonar_campaign.best_moves, EXCLUDED.best_moves), updated_at = now()"#,
    )
    .bind(user_id)
    .bind(id)
    .bind(stars)
    .bind(moves)
    .execute(&mut **tx)
    .await?;
    Ok((stars - before.unwrap_or(0)).max(0))
}

#[derive(Serialize)]
pub struct OpProgress {
    pub id: i16,
    /// 0 = not won yet.
    pub stars: i16,
    pub best_moves: Option<i16>,
    pub unlocked: bool,
}

/// `GET /api/games/sonar/campaign`: your stars and which missions are open.
pub async fn get(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<OpProgress>>> {
    let done = progress(&state.pool, user.user_id).await?;
    let won = |id: i16| done.iter().find(|(o, _, _)| *o == id);
    Ok(Json(
        campaign()
            .ops
            .iter()
            .map(|o| OpProgress {
                id: o.id,
                stars: won(o.id).map_or(0, |w| w.1),
                best_moves: won(o.id).map(|w| w.2),
                unlocked: o.id == 1 || won(o.id - 1).is_some(),
            })
            .collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sonar::ai::{bot_mines, choose_for};
    use crate::sonar::rules::{random_fleet, Duel};
    use crate::sonar::tactics::MK1;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    #[test]
    fn missions_are_numbered_and_sensible() {
        let c = campaign();
        assert_eq!(c.ops.len(), 12);
        for (i, o) in c.ops.iter().enumerate() {
            assert_eq!(o.id as usize, i + 1, "missions are 1..12 in order");
            assert!((1..=3).contains(&o.bot_mk));
            assert!(o.move_limit.map_or(true, |l| o.star_moves < l), "{}: the move star must be possible", o.name);
        }
        let all: i64 = c.ops.iter().map(|o| o.coins_for(3)).sum();
        assert_eq!(all, 10 * 78 * 3);
    }

    #[test]
    fn stars_count_the_win_the_moves_and_the_fleet() {
        let o = op(5).unwrap();
        assert_eq!(o.stars(false, 30, 0), 0);
        assert_eq!(o.stars(true, 44, 2), 1);
        assert_eq!(o.stars(true, 40, 2), 2);
        assert_eq!(o.stars(true, 40, 0), 3);
        assert_eq!(o.coins_for(2), 100);
        assert_eq!(o.coins_for(-1), 0);
    }

    #[test]
    fn zero_bot_plays_every_mission_to_the_end() {
        // Hard plays your side against each mission's Zero-Bot: only legal moves, and the game ends.
        for o in &campaign().ops {
            let mut rng = ChaCha8Rng::seed_from_u64(o.id as u64);
            let you = random_fleet(&mut rng);
            let mut bot = random_fleet(&mut rng);
            bot.mines = bot_mines(&bot, o.bot_mines, o.level, &mut rng);
            let setup = o.setup(MK1, 7);
            let mut d = Duel::new_tactics([&you, &bot], 0, setup);
            for _ in 0..600 {
                if d.winner().is_some() {
                    break;
                }
                let side = d.to_move();
                let m = choose_for(&d, side, if side == 0 { Level::Hard } else { o.level }, &mut rng);
                d.play(m).unwrap_or_else(|e| panic!("{}: {} ({})", o.name, m.code(), e.text()));
            }
            assert!(d.winner().is_some(), "{} never ended", o.name);
            // The stored fleet code reads back with this mission's mine limit.
            assert!(crate::sonar::rules::Fleet::parse_with_mines(&bot.code(), o.bot_mines).is_ok());
        }
    }
}
