//! Sudoku games API. The server picks the puzzle, keeps the solution and the
//! clock; the browser sends the grid as the player sees it. Nothing is
//! checked until the grid is full and the player presses Check: then wrong
//! squares are marked and the clock keeps running. Also the theme shop.

use axum::extract::{Path, State};
use axum::Json;
use chrono::{DateTime, NaiveDate, Utc};
use rand::seq::SliceRandom;
use rand::Rng as _;
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::bank::bank;
use super::items::{self, items};
use super::rules::{code, parse, Grid, Level, CELLS};
use super::solver::{self, Technique};
use crate::auth::jwt::AuthUser;
use crate::character::catalog::Rarity;
use crate::daily;
use crate::economy::{self, Granted, Reward};
use crate::error::{AppError, AppResult};
use crate::quests;
use crate::state::AppState;

pub const GAME_ID: &str = "sudoku";
pub const MAX_HINTS: i16 = 3;
pub const HINT_PENALTY_MS: i64 = 30_000;

// ---------------------------------------------------------------------------
// Modes, score, rewards
// ---------------------------------------------------------------------------

/// A level, or the Daily (a Medium-grade puzzle, the same for everyone).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Easy,
    Medium,
    Hard,
    Expert,
    Daily,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        [Mode::Easy, Mode::Medium, Mode::Hard, Mode::Expert, Mode::Daily].into_iter().find(|m| m.as_str() == s)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Easy => "easy",
            Mode::Medium => "medium",
            Mode::Hard => "hard",
            Mode::Expert => "expert",
            Mode::Daily => "daily",
        }
    }

    fn level(self) -> Option<Level> {
        match self {
            Mode::Easy => Some(Level::Easy),
            Mode::Medium => Some(Level::Medium),
            Mode::Hard => Some(Level::Hard),
            Mode::Expert => Some(Level::Expert),
            Mode::Daily => None,
        }
    }

    /// `scores.level`: 1–4 Easy … Expert, 5 the Daily.
    pub fn board_id(self) -> i32 {
        match self {
            Mode::Easy => 1,
            Mode::Medium => 2,
            Mode::Hard => 3,
            Mode::Expert => 4,
            Mode::Daily => 5,
        }
    }

    /// Quest level: 1 Easy … 4 Expert; the Daily counts as Medium.
    fn quest_level(self) -> i64 {
        match self {
            Mode::Daily => 2,
            m => i64::from(m.board_id()),
        }
    }

    /// (base points, par time in seconds).
    fn par(self) -> (i64, i64) {
        match self {
            Mode::Easy => (1_000, 300),
            Mode::Medium | Mode::Daily => (2_000, 480),
            Mode::Hard => (4_000, 720),
            Mode::Expert => (8_000, 1_200),
        }
    }
}

/// The fastest time that counts for points: 1.5 s per open square (about
/// what the quickest people manage), so a program that solves instantly
/// can't beat a fast human.
pub const MS_PER_OPEN_SQUARE: i64 = 1_500;

pub fn counted_ms(time_ms: i64, givens: &Grid) -> i64 {
    let open = givens.iter().filter(|&&v| v == 0).count() as i64;
    time_ms.max(open * MS_PER_OPEN_SQUARE)
}

/// Points for a win: the base, +10 for every second under par.
pub fn score(m: Mode, time_ms: i64) -> i32 {
    let (base, par) = m.par();
    (base + 10 * (par - time_ms.max(0) / 1000).max(0)) as i32
}

pub fn reward(m: Mode, rng: &mut impl rand::Rng) -> Reward {
    let (coins, mult, chance) = match m {
        Mode::Easy => (5, 1, 0.02),
        Mode::Medium => (15, 2, 0.08),
        Mode::Hard => (35, 3, 0.15),
        Mode::Expert => (70, 4, 0.25),
        Mode::Daily => (25, 2, 0.10),
    };
    Reward { coins, tokens: economy::roll_token(chance, rng), xp: 20 * mult }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    level: String,
    day: Option<NaiveDate>,
    puzzle: i32,
    entries: String,
    hinted: Vec<i16>,
    hints: i16,
    checks: i16,
    status: String,
    time_ms: Option<i32>,
    score: Option<i32>,
    started_at: DateTime<Utc>,
}

const COLUMNS: &str = "id, level, day, puzzle, entries, hinted, hints, checks, status, time_ms, score, started_at";

impl Row {
    fn mode(&self) -> AppResult<Mode> {
        Mode::parse(&self.level).ok_or_else(|| AppError::Internal(anyhow::anyhow!("sudoku game {}: bad level", self.id)))
    }

    fn givens(&self) -> AppResult<Grid> {
        let i = usize::try_from(self.puzzle).unwrap_or(usize::MAX);
        let g = match self.mode()?.level() {
            Some(l) => bank().puzzle(l, i),
            None => bank().daily_puzzle(i),
        };
        g.ok_or_else(|| AppError::Internal(anyhow::anyhow!("sudoku game {}: no puzzle {}", self.id, self.puzzle)))
    }

    fn solution(&self) -> AppResult<Grid> {
        solver::solve(&self.givens()?).ok_or_else(|| AppError::Internal(anyhow::anyhow!("sudoku game {}: no single solution", self.id)))
    }

    fn playing(&self) -> bool {
        self.status == "playing"
    }

    /// Time so far, hints included.
    fn elapsed_ms(&self) -> i64 {
        match self.time_ms {
            Some(t) => i64::from(t),
            None => (Utc::now() - self.started_at).num_milliseconds().max(0) + i64::from(self.hints) * HINT_PENALTY_MS,
        }
    }
}

async fn lock(tx: &mut Transaction<'_, Postgres>, id: Uuid, user_id: Uuid) -> AppResult<Row> {
    sqlx::query_as(&format!("SELECT {COLUMNS} FROM sudoku_games WHERE id = $1 AND user_id = $2 FOR UPDATE"))
        .bind(id)
        .bind(user_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(AppError::NotFound)
}

async fn save(tx: &mut Transaction<'_, Postgres>, row: &Row, finished: bool) -> AppResult<()> {
    sqlx::query(
        r#"UPDATE sudoku_games SET entries = $2, hinted = $3, hints = $4, checks = $5, status = $6, time_ms = $7, score = $8,
               finished_at = CASE WHEN $9 THEN now() ELSE finished_at END
           WHERE id = $1"#,
    )
    .bind(row.id)
    .bind(&row.entries)
    .bind(&row.hinted)
    .bind(row.hints)
    .bind(row.checks)
    .bind(&row.status)
    .bind(row.time_ms)
    .bind(row.score)
    .bind(finished)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// The grid a player sent, if it keeps the givens and the hinted squares.
fn read_entries(s: &str, givens: &Grid, hinted: &[i16], solution: &Grid) -> AppResult<Grid> {
    let g = parse(s).ok_or_else(|| AppError::Validation("the grid must be 81 characters: 1-9 or .".into()))?;
    if (0..CELLS).any(|c| givens[c] != 0 && g[c] != givens[c]) {
        return Err(AppError::Validation("the printed numbers can't change".into()));
    }
    if hinted.iter().any(|&c| usize::try_from(c).ok().and_then(|c| g.get(c).map(|v| *v != solution[c])).unwrap_or(true)) {
        return Err(AppError::Validation("numbers from hints can't change".into()));
    }
    Ok(g)
}

/// What a hint may look at: the givens plus your correct numbers, and the
/// squares to leave alone (your wrong numbers, so a hint never gives them away).
fn hint_inputs(grid: &Grid, solution: &Grid) -> (Grid, [bool; CELLS]) {
    let view: Grid = std::array::from_fn(|c| if grid[c] == solution[c] { grid[c] } else { 0 });
    let avoid: [bool; CELLS] = std::array::from_fn(|c| grid[c] != 0 && grid[c] != solution[c]);
    (view, avoid)
}

/// A puzzle you haven't had lately (any, once you've had them all).
fn pick_puzzle(count: usize, recent: &[i32], rng: &mut impl rand::Rng) -> usize {
    let fresh: Vec<usize> = (0..count).filter(|&i| !recent.contains(&(i as i32))).collect();
    match fresh.choose(rng) {
        Some(&i) => i,
        None => rng.gen_range(0..count),
    }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct ResultView {
    pub won: bool,
    pub time_ms: Option<i32>,
    pub score: Option<i32>,
    pub checks: i16,
    pub hints: i16,
    /// Only in the reply that ended the game.
    pub previous_best: Option<i32>,
    pub new_best: Option<bool>,
    pub rewards: Option<Granted>,
    /// A lucky theme drop ("theme:neon").
    pub drop: Option<String>,
}

#[derive(Serialize)]
pub struct HintView {
    pub cell: usize,
    pub digit: u8,
    pub technique: Option<Technique>,
    pub reason: String,
}

#[derive(Serialize)]
pub struct GameView {
    pub id: Uuid,
    pub mode: Mode,
    pub day: Option<NaiveDate>,
    pub status: String,
    /// 81 characters, '.' = empty.
    pub givens: String,
    /// The grid as you left it (givens included).
    pub entries: String,
    /// Squares filled by hints.
    pub hinted: Vec<i16>,
    pub hints_used: i16,
    pub hints_left: i16,
    pub checks: i16,
    /// Game time so far, hint time included.
    pub elapsed_ms: i64,
    /// Only once the game is over.
    pub solution: Option<String>,
    /// Reply to a Check that found wrong numbers: those squares.
    pub wrong: Option<Vec<usize>>,
    /// Reply to a hint.
    pub hint: Option<HintView>,
    pub result: Option<ResultView>,
}

fn view(row: &Row) -> AppResult<GameView> {
    let mode = row.mode()?;
    let done = !row.playing();
    Ok(GameView {
        id: row.id,
        mode,
        day: row.day,
        status: row.status.clone(),
        givens: code(&row.givens()?),
        entries: row.entries.clone(),
        hinted: row.hinted.clone(),
        hints_used: row.hints,
        hints_left: (MAX_HINTS - row.hints).max(0),
        checks: row.checks,
        elapsed_ms: row.elapsed_ms(),
        solution: if done { Some(code(&row.solution()?)) } else { None },
        wrong: None,
        hint: None,
        result: done.then(|| ResultView {
            won: row.status == "won",
            time_ms: row.time_ms,
            score: row.score,
            checks: row.checks,
            hints: row.hints,
            previous_best: None,
            new_best: None,
            rewards: None,
            drop: None,
        }),
    })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateRequest {
    /// easy, medium, hard, expert or daily.
    pub level: String,
}

/// `POST /api/games/sudoku/games`: a new puzzle (your unfinished one is given
/// up), or today's Daily (continued if you started it; one try).
pub async fn create(State(state): State<AppState>, user: AuthUser, Json(req): Json<CreateRequest>) -> AppResult<Json<GameView>> {
    let mode = Mode::parse(&req.level).ok_or_else(|| AppError::Validation("level must be easy, medium, hard, expert or daily".into()))?;
    let mut tx = state.pool.begin().await?;

    let (puzzle, givens, day) = match mode.level() {
        None => {
            let today = daily::wib_date(Utc::now());
            // An unfinished Daily from an earlier day is over.
            sqlx::query(
                "UPDATE sudoku_games SET status = 'gave_up', finished_at = now() \
                 WHERE user_id = $1 AND level = 'daily' AND status = 'playing' AND day < $2",
            )
            .bind(user.user_id)
            .bind(today)
            .execute(&mut *tx)
            .await?;
            let existing: Option<Row> =
                sqlx::query_as(&format!("SELECT {COLUMNS} FROM sudoku_games WHERE user_id = $1 AND level = 'daily' AND day = $2 FOR UPDATE"))
                    .bind(user.user_id)
                    .bind(today)
                    .fetch_optional(&mut *tx)
                    .await?;
            if let Some(row) = existing {
                if !row.playing() {
                    return Err(AppError::Conflict("you already played today's Daily".into()));
                }
                tx.commit().await?;
                return Ok(Json(view(&row)?));
            }
            let (i, g) = bank().daily(today);
            (i, g, Some(today))
        }
        Some(level) => {
            sqlx::query(
                "UPDATE sudoku_games SET status = 'gave_up', finished_at = now() \
                 WHERE user_id = $1 AND level <> 'daily' AND status = 'playing'",
            )
            .bind(user.user_id)
            .execute(&mut *tx)
            .await?;
            let recent: Vec<i32> =
                sqlx::query_scalar("SELECT puzzle FROM sudoku_games WHERE user_id = $1 AND level = $2 ORDER BY created_at DESC LIMIT 150")
                    .bind(user.user_id)
                    .bind(mode.as_str())
                    .fetch_all(&mut *tx)
                    .await?;
            let i = pick_puzzle(bank().count(level), &recent, &mut rand::thread_rng());
            let g = bank().puzzle(level, i).expect("index in range");
            (i, g, None)
        }
    };
    let row: Row = sqlx::query_as(&format!(
        "INSERT INTO sudoku_games (user_id, level, day, puzzle, entries) VALUES ($1, $2, $3, $4, $5) RETURNING {COLUMNS}"
    ))
    .bind(user.user_id)
    .bind(mode.as_str())
    .bind(day)
    .bind(puzzle as i32)
    .bind(code(&givens))
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(view(&row)?))
}

/// `GET /api/games/sudoku/games/active`: your unfinished puzzle (not the Daily).
pub async fn active(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Option<GameView>>> {
    let row: Option<Row> = sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM sudoku_games WHERE user_id = $1 AND level <> 'daily' AND status = 'playing' ORDER BY created_at DESC LIMIT 1"
    ))
    .bind(user.user_id)
    .fetch_optional(&state.pool)
    .await?;
    Ok(Json(row.map(|r| view(&r)).transpose()?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GridRequest {
    /// The grid as you see it: 81 characters, '.' = empty.
    pub entries: String,
}

/// Lock a game you're playing and take the grid you sent.
async fn take_grid(tx: &mut Transaction<'_, Postgres>, id: Uuid, user_id: Uuid, entries: &str) -> AppResult<(Row, Grid, Grid)> {
    let mut row = lock(tx, id, user_id).await?;
    if !row.playing() {
        return Err(AppError::Conflict("this game is over".into()));
    }
    let solution = row.solution()?;
    let grid = read_entries(entries, &row.givens()?, &row.hinted, &solution)?;
    row.entries = code(&grid);
    Ok((row, grid, solution))
}

/// `POST /api/games/sudoku/games/:id/save`: keep your grid (so a reload or
/// another device continues it).
pub async fn save_grid(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(req): Json<GridRequest>) -> AppResult<Json<GameView>> {
    let mut tx = state.pool.begin().await?;
    let (row, _, _) = take_grid(&mut tx, id, user.user_id, &req.entries).await?;
    save(&mut tx, &row, false).await?;
    tx.commit().await?;
    Ok(Json(view(&row)?))
}

/// `POST /api/games/sudoku/games/:id/check`: with every square filled, win
/// or learn which squares are wrong (the clock keeps running).
pub async fn check(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(req): Json<GridRequest>) -> AppResult<Json<GameView>> {
    let mut tx = state.pool.begin().await?;
    let (mut row, grid, solution) = take_grid(&mut tx, id, user.user_id, &req.entries).await?;
    if grid.contains(&0) {
        return Err(AppError::Validation("fill every square first".into()));
    }
    let wrong: Vec<usize> = (0..CELLS).filter(|&c| grid[c] != solution[c]).collect();
    if !wrong.is_empty() {
        row.checks = row.checks.saturating_add(1);
        save(&mut tx, &row, false).await?;
        tx.commit().await?;
        let mut v = view(&row)?;
        v.wrong = Some(wrong);
        return Ok(Json(v));
    }
    let v = win(&mut tx, &user, row).await?;
    tx.commit().await?;
    Ok(Json(v))
}

/// Record a solved puzzle: score, quests, rewards, maybe a theme.
async fn win(tx: &mut Transaction<'_, Postgres>, user: &AuthUser, mut row: Row) -> AppResult<GameView> {
    let mode = row.mode()?;
    let time_ms = row.elapsed_ms();
    let points = score(mode, counted_ms(time_ms, &row.givens()?));
    row.status = "won".into();
    row.time_ms = Some(time_ms.clamp(0, i32::MAX as i64) as i32);
    row.score = Some(points);
    save(tx, &row, true).await?;

    let previous_best = best_score(tx, user.user_id, mode).await?;
    sqlx::query("INSERT INTO scores (user_id, game_id, score, level, gained) VALUES ($1, $2, $3, $4, $3)")
        .bind(user.user_id)
        .bind(GAME_ID)
        .bind(points)
        .bind(mode.board_id())
        .execute(&mut **tx)
        .await?;
    let ev = quests::Event::SudokuWin { level: mode.quest_level(), daily: mode == Mode::Daily, hints: i64::from(row.hints) };
    quests::api::record(tx, user.user_id, &[ev]).await?;
    // Roll everything random first (the RNG can't be held across awaits).
    let (pay, lucky, pick_seed) = {
        let mut rng = rand::thread_rng();
        (reward(mode, &mut rng), rng.gen_bool(0.2), rng.gen::<u64>())
    };
    let granted = economy::grant(tx, user.user_id, pay, "sudoku_game", true).await?;
    let mut drop = None;
    if matches!(mode, Mode::Hard | Mode::Expert) && lucky {
        let owned = owned_keys(&mut **tx, user.user_id).await?;
        let pick = {
            use rand::SeedableRng;
            items().random_unowned(&owned, &mut rand_chacha::ChaCha8Rng::seed_from_u64(pick_seed))
        };
        if let Some(k) = pick {
            sqlx::query("INSERT INTO sudoku_items (user_id, item_key, source) VALUES ($1, $2, 'drop') ON CONFLICT DO NOTHING")
                .bind(user.user_id)
                .bind(&k)
                .execute(&mut **tx)
                .await?;
            drop = Some(k);
        }
    }
    let mut v = view(&row)?;
    if let Some(r) = v.result.as_mut() {
        r.previous_best = Some(previous_best);
        r.new_best = Some(points > previous_best);
        r.rewards = Some(granted);
        r.drop = drop;
    }
    Ok(v)
}

/// `POST /api/games/sudoku/games/:id/hint`: fill one square you could work
/// out next, with the reason (+30 s, 3 per game).
pub async fn hint(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(req): Json<GridRequest>) -> AppResult<Json<GameView>> {
    let mut tx = state.pool.begin().await?;
    let (mut row, mut grid, solution) = take_grid(&mut tx, id, user.user_id, &req.entries).await?;
    if row.hints >= MAX_HINTS {
        return Err(AppError::Conflict("no hints left".into()));
    }
    let (view_grid, avoid) = hint_inputs(&grid, &solution);
    let h = solver::hint(&view_grid, &avoid, &solution)
        .ok_or_else(|| AppError::Conflict("every open square has a number: press Check".into()))?;
    grid[h.cell] = h.digit;
    row.entries = code(&grid);
    row.hinted.push(h.cell as i16);
    row.hints += 1;
    save(&mut tx, &row, false).await?;
    tx.commit().await?;
    let mut v = view(&row)?;
    v.hint = Some(HintView { cell: h.cell, digit: h.digit, technique: h.tech, reason: h.reason });
    Ok(Json(v))
}

/// `POST /api/games/sudoku/games/:id/give-up`: end it and see the solution.
pub async fn give_up(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<GameView>> {
    let mut tx = state.pool.begin().await?;
    let mut row = lock(&mut tx, id, user.user_id).await?;
    if !row.playing() {
        return Err(AppError::Conflict("this game is over".into()));
    }
    row.status = "gave_up".into();
    save(&mut tx, &row, true).await?;
    tx.commit().await?;
    Ok(Json(view(&row)?))
}

/// Best score on this mode's board (Daily: today only).
async fn best_score(tx: &mut Transaction<'_, Postgres>, user_id: Uuid, m: Mode) -> AppResult<i32> {
    let since = if m == Mode::Daily { daily::today_start(Utc::now()) } else { DateTime::<Utc>::UNIX_EPOCH };
    Ok(sqlx::query_scalar(
        "SELECT COALESCE(MAX(score), 0) FROM scores WHERE user_id = $1 AND game_id = $2 AND level = $3 AND created_at >= $4",
    )
    .bind(user_id)
    .bind(GAME_ID)
    .bind(m.board_id())
    .bind(since)
    .fetch_one(&mut **tx)
    .await?)
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

async fn owned_keys(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid) -> AppResult<Vec<String>> {
    Ok(sqlx::query_scalar("SELECT item_key FROM sudoku_items WHERE user_id = $1").bind(user_id).fetch_all(ex).await?)
}

#[derive(Serialize)]
pub struct ThemeView {
    pub id: String,
    pub name: String,
    pub rarity: Rarity,
    pub price: Option<i64>,
    pub owned: bool,
}

#[derive(Serialize)]
pub struct Collection {
    pub themes: Vec<ThemeView>,
}

async fn collection_of(state: &AppState, user_id: Uuid) -> AppResult<Collection> {
    let owned = owned_keys(&state.pool, user_id).await?;
    let cat = items();
    Ok(Collection {
        themes: cat
            .themes
            .iter()
            .map(|t| ThemeView { id: t.id.clone(), name: t.name.clone(), rarity: t.rarity, price: t.price, owned: cat.owns(&t.id, &owned) })
            .collect(),
    })
}

/// `GET /api/games/sudoku/collection`
pub async fn collection(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Collection>> {
    Ok(Json(collection_of(&state, user.user_id).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuyRequest {
    pub id: String,
}

/// `POST /api/games/sudoku/buy`
pub async fn buy(State(state): State<AppState>, user: AuthUser, Json(req): Json<BuyRequest>) -> AppResult<Json<Collection>> {
    let t = items().find(&req.id).ok_or_else(|| AppError::Validation(format!("unknown theme: {}", req.id)))?;
    let price = t.price.ok_or_else(|| AppError::Validation(format!("{} is already free", t.name)))?;
    let key = items::key(&t.id);
    let mut tx = state.pool.begin().await?;
    let inserted = sqlx::query("INSERT INTO sudoku_items (user_id, item_key, source) VALUES ($1, $2, 'shop') ON CONFLICT DO NOTHING")
        .bind(user.user_id)
        .bind(&key)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict(format!("you already own {}", t.name)));
    }
    economy::spend(&mut tx, user.user_id, price, 0, &format!("sudoku_shop:{key}")).await?;
    tx.commit().await?;
    Ok(Json(collection_of(&state, user.user_id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    #[test]
    fn faster_solves_score_more_and_harder_levels_pay_more() {
        assert_eq!(score(Mode::Easy, 300_000), 1_000);
        assert_eq!(score(Mode::Easy, 299_999), 1_010);
        assert_eq!(score(Mode::Easy, 120_000), 1_000 + 10 * 180);
        assert_eq!(score(Mode::Expert, 3_600_000), 8_000);
        assert_eq!(score(Mode::Daily, 0), score(Mode::Medium, 0));
        // Instant solves count as 1.5 s per open square.
        let p = bank().puzzle(Level::Easy, 0).unwrap();
        let open = p.iter().filter(|&&v| v == 0).count() as i64;
        assert_eq!(counted_ms(3, &p), open * 1_500);
        assert_eq!(counted_ms(500_000, &p), 500_000);
        // At par (or slower) a harder level is worth more.
        assert!(score(Mode::Easy, 300_000) < score(Mode::Medium, 480_000));
        assert!(score(Mode::Medium, 480_000) < score(Mode::Hard, 720_000));
        assert!(score(Mode::Hard, 720_000) < score(Mode::Expert, 1_200_000));
        let mut r = ChaCha8Rng::seed_from_u64(1);
        let (e, x) = (reward(Mode::Easy, &mut r), reward(Mode::Expert, &mut r));
        assert_eq!((e.coins, e.xp), (5, 20));
        assert_eq!((x.coins, x.xp), (70, 80));
        assert_eq!(reward(Mode::Daily, &mut r).coins, 25);
        assert_eq!(Mode::parse("daily"), Some(Mode::Daily));
        assert_eq!(Mode::parse("master"), None);
        assert_eq!([Mode::Easy, Mode::Expert, Mode::Daily].map(Mode::board_id), [1, 4, 5]);
    }

    #[test]
    fn grids_keep_givens_and_hints() {
        let p = bank().puzzle(Level::Medium, 0).unwrap();
        let s = solver::solve(&p).unwrap();
        let open = (0..CELLS).find(|&c| p[c] == 0).unwrap();
        let given = (0..CELLS).find(|&c| p[c] != 0).unwrap();
        // Any number in an open square is fine (no checking until the end).
        let mut g = p;
        g[open] = if s[open] == 9 { 1 } else { s[open] + 1 };
        assert_eq!(read_entries(&code(&g), &p, &[], &s).unwrap(), g);
        // A printed number can't change.
        let mut bad = p;
        bad[given] = if p[given] == 9 { 1 } else { p[given] + 1 };
        assert!(read_entries(&code(&bad), &p, &[], &s).is_err());
        // A hinted square must keep its number.
        let mut h = p;
        h[open] = s[open];
        assert!(read_entries(&code(&h), &p, &[open as i16], &s).is_ok());
        assert!(read_entries(&code(&p), &p, &[open as i16], &s).is_err());
        assert!(read_entries(&code(&p), &p, &[200], &s).is_err());
        assert!(read_entries("12", &p, &[], &s).is_err());
    }

    #[test]
    fn hints_ignore_and_avoid_wrong_numbers() {
        let p = bank().puzzle(Level::Easy, 3).unwrap();
        let s = solver::solve(&p).unwrap();
        let open: Vec<usize> = (0..CELLS).filter(|&c| p[c] == 0).collect();
        let mut g = p;
        g[open[0]] = s[open[0]]; // right
        g[open[1]] = if s[open[1]] == 9 { 1 } else { s[open[1]] + 1 }; // wrong
        let (view, avoid) = hint_inputs(&g, &s);
        assert_eq!(view[open[0]], s[open[0]]);
        assert_eq!(view[open[1]], 0);
        assert!(avoid[open[1]] && !avoid[open[0]]);
        let h = solver::hint(&view, &avoid, &s).unwrap();
        assert_ne!(h.cell, open[1]);
        assert_eq!(h.digit, s[h.cell]);
    }

    #[test]
    fn fresh_puzzles_first() {
        let mut r = ChaCha8Rng::seed_from_u64(2);
        for _ in 0..50 {
            assert_eq!(pick_puzzle(3, &[0, 2], &mut r), 1);
        }
        assert!(pick_puzzle(3, &[0, 1, 2], &mut r) < 3);
    }
}
