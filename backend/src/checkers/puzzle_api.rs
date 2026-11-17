//! The daily checkers puzzle. The server keeps your attempt: a right move
//! gets Zero-Bot's most stubborn reply, a wrong move costs a try (it isn't
//! played), and three wrong tries end the puzzle and show the solution.

use axum::extract::State;
use axum::Json;
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::ai::{best_defence, forces_win};
use super::puzzles::{self, Puzzle};
use super::rules::{decode, parse_path, Game, Move, Outcome, Side};
use crate::auth::jwt::AuthUser;
use crate::daily;
use crate::economy::{self, Granted, Reward};
use crate::error::{AppError, AppResult};
use crate::quests;
use crate::state::AppState;

pub const MAX_MISTAKES: i16 = 3;
/// `scores.level` for puzzle points ("Today's puzzle" board).
pub const PUZZLE_BOARD: i32 = 5;

#[derive(sqlx::FromRow)]
struct Run {
    moves: String,
    status: String,
    mistakes: i16,
}

#[derive(Serialize)]
pub struct PuzzleView {
    pub day: NaiveDate,
    /// Puzzle number (shown as "Puzzle #12").
    pub number: u32,
    /// The board now: 32 cells (0 empty, ±1 man, ±2 king; + dark).
    pub cells: Vec<i8>,
    pub turn: Side,
    pub win_in: u8,
    /// The side you play.
    pub side: Side,
    pub moves: Vec<String>,
    /// Your legal moves now (empty when finished).
    pub legal: Vec<String>,
    /// new | playing | solved | failed
    pub status: String,
    pub mistakes: i16,
    pub mistakes_left: i16,
    /// Days in a row solved, counting today if solved.
    pub streak: i64,
    /// The stored solution, once the puzzle is over.
    pub solution: Option<Vec<String>>,
    /// The start position (for stepping through the solution).
    pub start_cells: Vec<i8>,
    /// Was the move you just sent right?
    pub correct: Option<bool>,
    /// Zero-Bot's reply to your right move.
    pub reply: Option<String>,
    pub rewards: Option<Granted>,
    /// Leaderboard points for solving.
    pub points: Option<i32>,
}

/// Coins, XP and leaderboard points for solving with this many wrong tries.
pub fn solve_reward(mistakes: i16) -> (Reward, i32) {
    match mistakes {
        0 => (Reward { coins: 40, tokens: 0, xp: 40 }, 30),
        1 => (Reward { coins: 25, tokens: 0, xp: 30 }, 20),
        _ => (Reward { coins: 15, tokens: 0, xp: 20 }, 10),
    }
}

fn start(p: &Puzzle) -> AppResult<Game> {
    let (cells, turn) = decode(&p.pos).ok_or_else(|| AppError::Internal(anyhow::anyhow!("puzzle {} position", p.id)))?;
    Ok(Game::from_position(cells, turn))
}

fn replay(p: &Puzzle, moves: &str) -> AppResult<Game> {
    let g = start(p)?;
    Game::replay_from(g.cells, g.turn, moves).map_err(|e| AppError::Internal(anyhow::anyhow!("puzzle {}: {e}", p.id)))
}

/// Is `mv` a right move after the moves so far? (Any legal move that still
/// forces the win in time counts.) It's always the solver's turn here.
pub fn check_move(p: &Puzzle, g: &Game, mv: &str) -> Result<(bool, Move), &'static str> {
    let path = parse_path(mv).ok_or("bad move")?;
    let m = g.legal_moves().into_iter().find(|m| m.path == path).ok_or("illegal move")?;
    let left = p.win_in.saturating_sub((g.moves.len() / 2) as u8);
    let mut after = g.clone();
    after.apply(&m);
    Ok((forces_win(&after, left), m))
}

/// Days in a row solved, ending today (or yesterday if today isn't solved yet).
async fn streak(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid, today: NaiveDate) -> AppResult<i64> {
    let days: Vec<NaiveDate> = sqlx::query_scalar(
        "SELECT day FROM checkers_puzzle_runs WHERE user_id = $1 AND status = 'solved' AND day <= $2 ORDER BY day DESC LIMIT 400",
    )
    .bind(user_id)
    .bind(today)
    .fetch_all(ex)
    .await?;
    Ok(crate::chess::puzzle_api::count_streak(&days, today))
}

fn view(p: &Puzzle, day: NaiveDate, run: Option<&Run>, streak: i64) -> AppResult<PuzzleView> {
    let moves = run.map(|r| r.moves.as_str()).unwrap_or("");
    let g = replay(p, moves)?;
    let first = start(p)?;
    let status = run.map(|r| r.status.clone()).unwrap_or_else(|| "new".into());
    let mistakes = run.map(|r| r.mistakes).unwrap_or(0);
    let open = status == "new" || status == "playing";
    Ok(PuzzleView {
        day,
        number: p.id,
        cells: g.cells.to_vec(),
        turn: g.turn,
        win_in: p.win_in,
        side: first.turn,
        moves: g.moves.iter().map(Move::notation).collect(),
        legal: if open { g.legal_moves().iter().map(Move::notation).collect() } else { Vec::new() },
        status,
        mistakes,
        mistakes_left: (MAX_MISTAKES - mistakes).max(0),
        streak,
        solution: if open { None } else { Some(p.solution.clone()) },
        start_cells: first.cells.to_vec(),
        correct: None,
        reply: None,
        rewards: None,
        points: None,
    })
}

async fn load_run(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid, day: NaiveDate, lock: bool) -> AppResult<Option<Run>> {
    let sql = if lock {
        "SELECT moves, status, mistakes FROM checkers_puzzle_runs WHERE user_id = $1 AND day = $2 FOR UPDATE"
    } else {
        "SELECT moves, status, mistakes FROM checkers_puzzle_runs WHERE user_id = $1 AND day = $2"
    };
    Ok(sqlx::query_as(sql).bind(user_id).bind(day).fetch_optional(ex).await?)
}

/// `GET /api/games/checkers/puzzle`: today's puzzle and your attempt.
pub async fn today(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<PuzzleView>> {
    let day = daily::wib_date(Utc::now());
    let p = puzzles::for_day(day);
    let run = load_run(&state.pool, user.user_id, day, false).await?;
    let s = streak(&state.pool, user.user_id, day).await?;
    Ok(Json(view(p, day, run.as_ref(), s)?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PuzzleMove {
    /// Move in notation ("11-15", "22x15x8").
    pub mv: String,
}

/// `POST /api/games/checkers/puzzle/move`
pub async fn make_move(State(state): State<AppState>, user: AuthUser, Json(req): Json<PuzzleMove>) -> AppResult<Json<PuzzleView>> {
    let day = daily::wib_date(Utc::now());
    let p = puzzles::for_day(day);
    let mut tx = state.pool.begin().await?;
    sqlx::query("INSERT INTO checkers_puzzle_runs (user_id, day, puzzle_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
        .bind(user.user_id)
        .bind(day)
        .bind(p.id as i32)
        .execute(&mut *tx)
        .await?;
    let mut run = load_run(&mut *tx, user.user_id, day, true).await?.ok_or(AppError::NotFound)?;
    if run.status == "solved" || run.status == "failed" {
        return Err(AppError::Conflict("today's puzzle is done; come back tomorrow".into()));
    }
    let mut g = replay(p, &run.moves)?;
    let (right, m) = check_move(p, &g, &req.mv).map_err(|e| AppError::Validation(e.into()))?;
    let (mut reply, mut rewards, mut points) = (None, None, None);
    if right {
        g.apply(&m);
        if g.outcome() != Outcome::Ongoing {
            run.status = "solved".into();
            let (pay, pts) = solve_reward(run.mistakes);
            let total: i32 = sqlx::query_scalar("SELECT COALESCE(MAX(score), 0) FROM scores WHERE user_id = $1 AND game_id = $2")
                .bind(user.user_id)
                .bind(super::api::GAME_ID)
                .fetch_one(&mut *tx)
                .await?;
            sqlx::query("INSERT INTO scores (user_id, game_id, score, level, gained) VALUES ($1, $2, $3, $4, $5)")
                .bind(user.user_id)
                .bind(super::api::GAME_ID)
                .bind(total + pts)
                .bind(PUZZLE_BOARD)
                .bind(pts)
                .execute(&mut *tx)
                .await?;
            quests::api::record(&mut tx, user.user_id, &[quests::Event::CheckersPuzzleSolved]).await?;
            rewards = Some(economy::grant(&mut tx, user.user_id, pay, "checkers_puzzle", true).await?);
            points = Some(pts);
        } else {
            let left = p.win_in.saturating_sub((g.moves.len() / 2) as u8);
            let r = best_defence(&g, left).ok_or_else(|| AppError::Internal(anyhow::anyhow!("no reply")))?;
            reply = Some(r.notation());
            g.apply(&r);
            run.status = "playing".into();
        }
        run.moves = g.moves.iter().map(Move::notation).collect::<Vec<_>>().join(" ");
    } else {
        run.mistakes += 1;
        run.status = if run.mistakes >= MAX_MISTAKES { "failed" } else { "playing" }.into();
    }
    let done = run.status == "solved" || run.status == "failed";
    sqlx::query(
        "UPDATE checkers_puzzle_runs SET moves = $3, status = $4, mistakes = $5, finished_at = CASE WHEN $6 THEN now() END WHERE user_id = $1 AND day = $2",
    )
    .bind(user.user_id)
    .bind(day)
    .bind(&run.moves)
    .bind(&run.status)
    .bind(run.mistakes)
    .bind(done)
    .execute(&mut *tx)
    .await?;
    let s = streak(&mut *tx, user.user_id, day).await?;
    tx.commit().await?;
    let mut v = view(p, day, Some(&run), s)?;
    v.correct = Some(right);
    v.reply = reply;
    v.rewards = rewards;
    v.points = points;
    Ok(Json(v))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fewer_mistakes_pay_more() {
        let (a, pa) = solve_reward(0);
        let (b, pb) = solve_reward(2);
        assert!(a.coins > b.coins && pa > pb);
    }

    #[test]
    fn stored_solutions_are_right_and_other_moves_can_be_wrong() {
        for p in puzzles::puzzles().iter().step_by(30) {
            let mut g = start(p).unwrap();
            for (i, mv) in p.solution.iter().enumerate() {
                if i % 2 == 0 {
                    let (ok, m) = check_move(p, &g, mv).unwrap();
                    assert!(ok, "puzzle {} move {mv}", p.id);
                    g.apply(&m);
                } else {
                    g.play_str(mv).unwrap();
                }
            }
            assert!(matches!(g.outcome(), Outcome::Win(_)));
            assert!(check_move(p, &start(p).unwrap(), "1-99").is_err());
        }
    }
}
