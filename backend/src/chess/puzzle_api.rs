//! The daily puzzle API. The server keeps your attempt: a right move gets
//! Zero-Bot's most stubborn reply, a wrong move costs a try (it isn't
//! played), and three wrong tries end the puzzle and show the solution.

use axum::extract::State;
use axum::Json;
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::ai::{best_defence, forces_mate};
use super::puzzles::{self, Puzzle};
use super::{Game, Side};
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
    pub start_fen: String,
    pub fen: String,
    pub mate_in: u8,
    /// The side you play.
    pub color: Side,
    pub moves: Vec<String>,
    pub san: Vec<String>,
    /// Your legal moves now (empty when finished).
    pub legal: Vec<String>,
    pub in_check: bool,
    /// new | playing | solved | failed
    pub status: String,
    pub mistakes: i16,
    pub mistakes_left: i16,
    /// Days in a row solved, counting today if solved.
    pub streak: i64,
    /// The stored solution, once the puzzle is over.
    pub solution: Option<Vec<String>>,
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

/// Is `uci` a right move after the moves so far? (Any move that still forces
/// mate in time counts.) It's always the solver's turn here, so the solver
/// has played half of the moves so far.
pub fn check_move(p: &Puzzle, g: &Game, uci: &str) -> Result<bool, &'static str> {
    let mv = g.parse(uci).map_err(|e| e.text())?;
    let left = p.mate_in.saturating_sub((g.moves().len() / 2) as u8);
    let mut b = g.board().clone();
    b.play_unchecked(mv);
    Ok(forces_mate(&b, left))
}

/// Days in a row solved, ending today (or yesterday if today isn't solved yet).
async fn streak(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid, today: NaiveDate) -> AppResult<i64> {
    let days: Vec<NaiveDate> =
        sqlx::query_scalar("SELECT day FROM chess_puzzle_runs WHERE user_id = $1 AND status = 'solved' AND day <= $2 ORDER BY day DESC LIMIT 400")
            .bind(user_id)
            .bind(today)
            .fetch_all(ex)
            .await?;
    Ok(count_streak(&days, today))
}

/// `days` newest first.
pub fn count_streak(days: &[NaiveDate], today: NaiveDate) -> i64 {
    let mut expect = match days.first() {
        Some(&d) if d == today => today,
        Some(&d) if d == today.pred_opt().expect("date") => d,
        _ => return 0,
    };
    let mut n = 0;
    for &d in days {
        if d != expect {
            break;
        }
        n += 1;
        expect = d.pred_opt().expect("date");
    }
    n
}

fn view(p: &Puzzle, day: NaiveDate, run: Option<&Run>, streak: i64) -> AppResult<PuzzleView> {
    let moves = run.map(|r| r.moves.as_str()).unwrap_or("");
    let g = Game::replay(&p.fen, moves).map_err(|e| AppError::Internal(anyhow::anyhow!("puzzle {}: {}", p.id, e.text())))?;
    let status = run.map(|r| r.status.clone()).unwrap_or_else(|| "new".into());
    let mistakes = run.map(|r| r.mistakes).unwrap_or(0);
    let open = status == "new" || status == "playing";
    Ok(PuzzleView {
        day,
        number: p.id,
        start_fen: p.fen.clone(),
        fen: g.fen(),
        mate_in: p.mate_in,
        color: Game::from_fen(&p.fen).map(|s| s.to_move()).unwrap_or(Side::White),
        moves: g.moves().to_vec(),
        san: g.san().to_vec(),
        legal: if open { g.legal_moves() } else { Vec::new() },
        in_check: g.in_check(),
        status,
        mistakes,
        mistakes_left: (MAX_MISTAKES - mistakes).max(0),
        streak,
        solution: if open { None } else { Some(p.solution.clone()) },
        correct: None,
        reply: None,
        rewards: None,
        points: None,
    })
}

async fn load_run(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid, day: NaiveDate, lock: bool) -> AppResult<Option<Run>> {
    let sql = if lock {
        "SELECT moves, status, mistakes FROM chess_puzzle_runs WHERE user_id = $1 AND day = $2 FOR UPDATE"
    } else {
        "SELECT moves, status, mistakes FROM chess_puzzle_runs WHERE user_id = $1 AND day = $2"
    };
    Ok(sqlx::query_as(sql).bind(user_id).bind(day).fetch_optional(ex).await?)
}

/// `GET /api/games/chess/puzzle`: today's puzzle and your attempt.
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
    pub uci: String,
}

/// `POST /api/games/chess/puzzle/move`
pub async fn make_move(State(state): State<AppState>, user: AuthUser, Json(req): Json<PuzzleMove>) -> AppResult<Json<PuzzleView>> {
    let day = daily::wib_date(Utc::now());
    let p = puzzles::for_day(day);
    let mut tx = state.pool.begin().await?;
    sqlx::query("INSERT INTO chess_puzzle_runs (user_id, day, puzzle_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
        .bind(user.user_id)
        .bind(day)
        .bind(p.id as i32)
        .execute(&mut *tx)
        .await?;
    let mut run = load_run(&mut *tx, user.user_id, day, true).await?.ok_or(AppError::NotFound)?;
    if run.status == "solved" || run.status == "failed" {
        return Err(AppError::Conflict("today's puzzle is done; come back tomorrow".into()));
    }
    let mut g = Game::replay(&p.fen, &run.moves).map_err(|e| AppError::Internal(anyhow::anyhow!(e.text())))?;
    let right = check_move(p, &g, &req.uci).map_err(|e| AppError::Validation(e.into()))?;
    let (mut reply, mut rewards, mut points) = (None, None, None);
    if right {
        g.play(&req.uci).map_err(|e| AppError::Validation(e.text().into()))?;
        if g.outcome().is_over() {
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
            quests::api::record(&mut tx, user.user_id, &[quests::Event::ChessPuzzleSolved]).await?;
            rewards = Some(economy::grant(&mut tx, user.user_id, pay, "chess_puzzle", true).await?);
            points = Some(pts);
        } else {
            let m = best_defence(g.board(), &mut rand::thread_rng()).expect("the defender has a move");
            g.play_move(m);
            reply = g.moves().last().cloned();
            run.status = "playing".into();
        }
        run.moves = g.move_string();
    } else {
        run.mistakes += 1;
        run.status = if run.mistakes >= MAX_MISTAKES { "failed" } else { "playing" }.into();
    }
    let done = run.status == "solved" || run.status == "failed";
    sqlx::query(
        "UPDATE chess_puzzle_runs SET moves = $3, status = $4, mistakes = $5, finished_at = CASE WHEN $6 THEN now() END WHERE user_id = $1 AND day = $2",
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

    fn d(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }

    #[test]
    fn streak_counts_days_in_a_row() {
        let today = d("2026-11-15");
        assert_eq!(count_streak(&[], today), 0);
        assert_eq!(count_streak(&[d("2026-11-15"), d("2026-11-14"), d("2026-11-12")], today), 2);
        assert_eq!(count_streak(&[d("2026-11-14"), d("2026-11-13")], today), 2, "today not solved yet keeps the streak");
        assert_eq!(count_streak(&[d("2026-11-13")], today), 0, "a missed day breaks it");
    }

    #[test]
    fn fewer_mistakes_pay_more() {
        let (a, pa) = solve_reward(0);
        let (b, pb) = solve_reward(2);
        assert!(a.coins > b.coins && pa > pb);
    }

    #[test]
    fn any_mating_move_is_right() {
        // Two rooks: Rb7 and other quiet rook moves force mate in 2; Ra8+ doesn't.
        let p = Puzzle { id: 0, fen: "4k3/8/8/8/8/8/1R6/R3K3 w - - 0 1".into(), mate_in: 2, solution: vec![] };
        let g = Game::from_fen(&p.fen).unwrap();
        assert_eq!(check_move(&p, &g, "b2b7"), Ok(true));
        assert_eq!(check_move(&p, &g, "e1e2"), Ok(false));
        assert!(check_move(&p, &g, "b2b9").is_err());
        // After Rb7 and a king move, only mates are right.
        let mut g = Game::replay(&p.fen, "b2b7 e8f8").unwrap();
        assert_eq!(check_move(&p, &g, "a1a8"), Ok(true));
        assert_eq!(check_move(&p, &g, "a1a2"), Ok(false));
        g.play("a1a8").unwrap();
        assert!(g.outcome().is_over());
    }
}
