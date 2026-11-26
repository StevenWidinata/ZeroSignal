//! Today's Dailies: every game with a Daily board, whether you played it
//! today (WIB day), your score and where it ranks. Shown on the Hub.

use axum::extract::State;
use axum::Json;
use chrono::Utc;
use serde::Serialize;

use crate::auth::jwt::AuthUser;
use crate::daily;
use crate::error::AppResult;
use crate::games::{self, Ranking};
use crate::state::AppState;

/// One game's Daily.
struct DailyDef {
    game_id: &'static str,
    /// `scores.level` of the Daily board.
    board: i32,
    /// `SELECT finished FROM … WHERE user_id = $1 AND day = $2`: one row if
    /// you started today's Daily, `finished` = it's over.
    status_sql: &'static str,
    /// Can an unfinished Daily be continued? (Real-time rounds can't: an
    /// unfinished one is used up.)
    resumable: bool,
}

const DAILIES: [DailyDef; 10] = [
    DailyDef {
        game_id: "snake-signal",
        board: 4,
        status_sql: "SELECT finished_at IS NOT NULL FROM snake_runs WHERE user_id = $1 AND mode = 'daily' AND day = $2",
        resumable: false,
    },
    DailyDef {
        game_id: "brick-breaker",
        board: crate::brick_breaker::api::BOARD_DAILY,
        status_sql: "SELECT finished_at IS NOT NULL FROM brick_runs WHERE user_id = $1 AND mode = 'daily' AND day = $2",
        resumable: false,
    },
    DailyDef {
        game_id: "signal-flap",
        board: crate::signal_flap::api::BOARD_DAILY,
        status_sql: "SELECT finished_at IS NOT NULL FROM flap_runs WHERE user_id = $1 AND mode = 'daily' AND day = $2",
        resumable: false,
    },
    DailyDef {
        game_id: "whack-a-mole",
        board: 4,
        status_sql: "SELECT finished_at IS NOT NULL FROM wam_runs WHERE user_id = $1 AND mode = 'daily' AND day = $2",
        resumable: false,
    },
    DailyDef {
        game_id: "minefield",
        board: 4,
        status_sql: "SELECT status IN ('won', 'lost') FROM mf_games WHERE user_id = $1 AND difficulty = 'daily' AND day = $2",
        resumable: true,
    },
    DailyDef {
        game_id: "2048",
        board: 4,
        status_sql: "SELECT finished_at IS NOT NULL FROM g2048_runs WHERE user_id = $1 AND mode = 'daily' AND day = $2",
        resumable: true,
    },
    DailyDef {
        game_id: "chess",
        board: 5,
        status_sql: "SELECT status <> 'playing' FROM chess_puzzle_runs WHERE user_id = $1 AND day = $2",
        resumable: true,
    },
    DailyDef {
        game_id: "checkers",
        board: 5,
        status_sql: "SELECT status <> 'playing' FROM checkers_puzzle_runs WHERE user_id = $1 AND day = $2",
        resumable: true,
    },
    DailyDef {
        game_id: "sonar",
        board: 5,
        status_sql: "SELECT status = 'done' FROM sonar_daily_runs WHERE user_id = $1 AND day = $2",
        resumable: true,
    },
    DailyDef {
        game_id: "sudoku",
        board: 5,
        status_sql: "SELECT status <> 'playing' FROM sudoku_games WHERE user_id = $1 AND level = 'daily' AND day = $2",
        resumable: true,
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// Not started today.
    New,
    /// Started and can still be finished.
    Playing,
    /// Finished (or a real-time round left unfinished).
    Done,
}

#[derive(Serialize)]
pub struct DailyView {
    pub game_id: &'static str,
    pub board: i32,
    pub status: Status,
    /// Your points on today's board (None = no score today).
    pub score: Option<i32>,
    /// Your place among today's ranked players (guests and hidden players see
    /// where they would be).
    pub rank: Option<i64>,
    /// Ranked players on today's board.
    pub players: i64,
}

fn status_of(row: Option<bool>, resumable: bool) -> Status {
    match row {
        None => Status::New,
        Some(true) => Status::Done,
        Some(false) if resumable => Status::Playing,
        Some(false) => Status::Done,
    }
}

pub async fn today(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<DailyView>>> {
    let now = Utc::now();
    let day = daily::wib_date(now);
    let since = daily::today_start(now);
    let mut out = Vec::with_capacity(DAILIES.len());
    for d in &DAILIES {
        let Some(game) = games::find(d.game_id) else { continue };
        if game.status != games::GameStatus::Live {
            continue;
        }
        let finished: Option<bool> = sqlx::query_scalar(d.status_sql)
            .bind(user.user_id)
            .bind(day)
            .fetch_optional(&state.pool)
            .await?;
        // Same points as the "today" leaderboard (`scores::top`).
        let points = if game.ranking == Ranking::Total {
            "COALESCE(SUM(COALESCE(s.gained, s.score)), 0)::INT"
        } else {
            "MAX(s.score)"
        };
        let sql = format!(
            r#"WITH board AS (
                   SELECT s.user_id, {points} AS pts,
                          BOOL_AND(NOT u.is_guest AND u.delete_requested_at IS NULL AND NOT u.hide_on_leaderboards) AS ranked
                   FROM scores s JOIN users u ON u.id = s.user_id
                   WHERE s.game_id = $1 AND s.level = $2 AND s.created_at >= $3
                   GROUP BY s.user_id
               ), me AS (SELECT pts FROM board WHERE user_id = $4)
               SELECT (SELECT pts FROM me),
                      (SELECT COUNT(*) FROM board WHERE ranked AND pts > (SELECT pts FROM me)) + 1,
                      (SELECT COUNT(*) FROM board WHERE ranked AND pts > 0)"#
        );
        let (score, above, players): (Option<i32>, i64, i64) = sqlx::query_as(&sql)
            .bind(d.game_id)
            .bind(d.board)
            .bind(since)
            .bind(user.user_id)
            .fetch_one(&state.pool)
            .await?;
        out.push(DailyView {
            game_id: d.game_id,
            board: d.board,
            status: status_of(finished, d.resumable),
            score,
            rank: score.map(|_| above),
            players,
        });
    }
    Ok(Json(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_rules() {
        assert_eq!(status_of(None, true), Status::New);
        assert_eq!(status_of(Some(true), false), Status::Done);
        assert_eq!(status_of(Some(false), true), Status::Playing);
        // An unfinished real-time Daily can't be continued: it's used up.
        assert_eq!(status_of(Some(false), false), Status::Done);
    }

    #[test]
    fn every_daily_is_a_catalog_game() {
        for d in &DAILIES {
            assert!(games::find(d.game_id).is_some(), "{}", d.game_id);
        }
    }
}
