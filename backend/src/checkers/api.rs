//! Checkers vs Zero-Bot: the server keeps the game, checks every move and
//! plays Zero-Bot's reply. Also the board / piece-set collection and shop.

use std::time::Duration;

use axum::extract::{Path, State};
use axum::Json;
use rand::Rng as _;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::ai::{best_move, Level};
use super::items::{self, Kind};
use super::rules::{Game, Move, Outcome, Side, QUIET_LIMIT};
use crate::auth::jwt::AuthUser;
use crate::economy::{self, game_xp, GameResult, Granted, Reward};
use crate::error::{AppError, AppResult};
use crate::quests;
use crate::state::AppState;

pub const GAME_ID: &str = "checkers";
pub const MAX_UNDOS: i16 = 3;
/// Zero-Bot's thinking time per move.
const AI_BUDGET: Duration = Duration::from_millis(1200);

#[derive(sqlx::FromRow)]
struct GameRow {
    id: Uuid,
    level: String,
    side: String,
    moves: String,
    status: String,
    ending: Option<String>,
    undos_used: i16,
    board_style: String,
    piece_set: String,
}

impl GameRow {
    fn level(&self) -> Level {
        Level::parse(&self.level).unwrap_or(Level::Easy)
    }
    fn side(&self) -> Side {
        Side::parse(&self.side).unwrap_or(Side::Dark)
    }
    fn game(&self) -> AppResult<Game> {
        Game::replay(&self.moves).map_err(|e| AppError::Internal(anyhow::anyhow!("checkers game {}: {e}", self.id)))
    }
}

/// The board for the browser: 32 cells (0 empty, ±1 man, ±2 king; + dark).
#[derive(Serialize)]
pub struct GameView {
    pub id: Uuid,
    pub level: Level,
    /// Your side (dark moves first).
    pub side: Side,
    pub cells: Vec<i8>,
    pub turn: Side,
    /// Moves so far in notation.
    pub moves: Vec<String>,
    /// Your legal moves now (notation); empty when it isn't your turn.
    pub legal: Vec<String>,
    /// active | won | lost | drawn | resigned
    pub status: String,
    pub ending: Option<String>,
    pub undos_left: i16,
    pub board_style: String,
    pub piece_set: String,
    /// Plies left before a quiet-move draw.
    pub quiet_left: u32,
    /// Zero-Bot's reply to your last move (notation).
    pub ai_move: Option<String>,
    /// Paid when the game ended with this request.
    pub rewards: Option<Granted>,
    /// Lucky drop ("board:neon") on a win, if any.
    pub drop: Option<String>,
}

fn view(row: &GameRow, g: &Game, ai_move: Option<String>, rewards: Option<Granted>, drop: Option<String>) -> GameView {
    let your_turn = row.status == "active" && g.turn == row.side();
    GameView {
        id: row.id,
        level: row.level(),
        side: row.side(),
        cells: g.cells.to_vec(),
        turn: g.turn,
        moves: g.moves.iter().map(Move::notation).collect(),
        legal: if your_turn { g.legal_moves().iter().map(Move::notation).collect() } else { Vec::new() },
        status: row.status.clone(),
        ending: row.ending.clone(),
        undos_left: (MAX_UNDOS - row.undos_used).max(0),
        board_style: row.board_style.clone(),
        piece_set: row.piece_set.clone(),
        quiet_left: QUIET_LIMIT.saturating_sub(g.quiet),
        ai_move,
        rewards,
        drop,
    }
}

/// Coins for beating each level (token chance in %).
pub fn win_coins(level: Level) -> (i64, u32) {
    match level {
        Level::Easy => (8, 5),
        Level::Medium => (20, 10),
        Level::Hard => (40, 20),
        Level::Master => (90, 40),
    }
}

/// Leaderboard points for a finished game (running total, like Chess).
pub fn points(level: Level, result: GameResult, used_undo: bool) -> i32 {
    let m = level.mult() as i32;
    match result {
        GameResult::Win => 10 * m + if used_undo { 0 } else { 5 },
        GameResult::Draw => 3 * m,
        GameResult::Loss => 0,
    }
}

/// The reward for a finished game vs Zero-Bot.
pub fn reward(level: Level, result: GameResult, used_undo: bool, rng: &mut impl rand::Rng) -> Reward {
    let xp = game_xp(result, level.mult());
    if result != GameResult::Win {
        return Reward { coins: 0, tokens: 0, xp };
    }
    let (coins, token_pct) = win_coins(level);
    let tokens = if used_undo { 0 } else { economy::roll_token(f64::from(token_pct) / 100.0, rng) };
    Reward { coins, tokens, xp }
}

/// Why a game ended, for the player.
pub fn ending_of(g: &Game) -> &'static str {
    match g.outcome() {
        Outcome::Win(_) => "no_moves",
        Outcome::Draw if g.quiet >= QUIET_LIMIT => "quiet",
        Outcome::Draw => "repetition",
        Outcome::Ongoing => "",
    }
}

/// The result for the player when the game is over.
fn result_for(g: &Game, me: Side) -> Option<(GameResult, &'static str)> {
    match g.outcome() {
        Outcome::Ongoing => None,
        Outcome::Win(w) => Some((if w == me { GameResult::Win } else { GameResult::Loss }, ending_of(g))),
        Outcome::Draw => Some((GameResult::Draw, ending_of(g))),
    }
}

async fn owned_keys(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid) -> AppResult<Vec<String>> {
    Ok(sqlx::query_scalar("SELECT item_key FROM checkers_items WHERE user_id = $1").bind(user_id).fetch_all(ex).await?)
}

const COLUMNS: &str = "id, level, side, moves, status, ending, undos_used, board_style, piece_set";

/// Zero-Bot's move (runs on a blocking thread: the search takes a while).
async fn bot_move(g: &Game, level: Level) -> AppResult<Move> {
    let g = g.clone();
    tokio::task::spawn_blocking(move || best_move(&g, level, AI_BUDGET, &mut rand::thread_rng()))
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("checkers bot: {e}")))?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("checkers bot found no move")))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateRequest {
    pub level: String,
    /// "dark", "light" or "random". Dark moves first.
    #[serde(default = "default_side")]
    pub side: String,
    #[serde(default)]
    pub board: Option<String>,
    #[serde(default)]
    pub pieces: Option<String>,
}

fn default_side() -> String {
    "dark".into()
}

/// `POST /api/games/checkers/games`: a new game vs Zero-Bot (an unfinished one is resigned).
pub async fn create(State(state): State<AppState>, user: AuthUser, Json(req): Json<CreateRequest>) -> AppResult<Json<GameView>> {
    let level = Level::parse(&req.level).ok_or_else(|| AppError::Validation("level must be easy, medium, hard or master".into()))?;
    let side = match req.side.as_str() {
        "dark" | "light" => req.side.clone(),
        "random" => (if rand::thread_rng().gen_bool(0.5) { "dark" } else { "light" }).to_string(),
        _ => return Err(AppError::Validation("side must be dark, light or random".into())),
    };
    let cat = items::items();
    let owned = owned_keys(&state.pool, user.user_id).await?;
    let board = req.board.unwrap_or_else(|| cat.default_id(Kind::Board).to_string());
    let pieces = req.pieces.unwrap_or_else(|| cat.default_id(Kind::Pieces).to_string());
    if !cat.owns(Kind::Board, &board, &owned) {
        return Err(AppError::Validation("you don't own that board".into()));
    }
    if !cat.owns(Kind::Pieces, &pieces, &owned) {
        return Err(AppError::Validation("you don't own that piece set".into()));
    }

    // Zero-Bot opens when you play light (worked out before the transaction).
    let mut g = Game::new();
    let mut ai_move = None;
    if side == "light" {
        let m = bot_move(&g, level).await?;
        ai_move = Some(m.notation());
        g.apply(&m);
    }

    let mut tx = state.pool.begin().await?;
    // One game at a time: starting a new one resigns the old one.
    sqlx::query(
        "UPDATE checkers_games SET status = 'resigned', ending = 'resign', finished_at = now() WHERE user_id = $1 AND status = 'active'",
    )
    .bind(user.user_id)
    .execute(&mut *tx)
    .await?;
    let row: GameRow = sqlx::query_as(&format!(
        "INSERT INTO checkers_games (user_id, level, side, moves, board_style, piece_set) VALUES ($1, $2, $3, $4, $5, $6) RETURNING {COLUMNS}"
    ))
    .bind(user.user_id)
    .bind(level.as_str())
    .bind(&side)
    .bind(g.move_string())
    .bind(&board)
    .bind(&pieces)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(view(&row, &g, ai_move, None, None)))
}

/// `GET /api/games/checkers/games/active`
pub async fn active(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Option<GameView>>> {
    let row: Option<GameRow> =
        sqlx::query_as(&format!("SELECT {COLUMNS} FROM checkers_games WHERE user_id = $1 AND status = 'active'"))
            .bind(user.user_id)
            .fetch_optional(&state.pool)
            .await?;
    match row {
        Some(r) => {
            let g = r.game()?;
            Ok(Json(Some(view(&r, &g, None, None, None))))
        }
        None => Ok(Json(None)),
    }
}

async fn lock(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, id: Uuid, user: Uuid) -> AppResult<GameRow> {
    sqlx::query_as(&format!("SELECT {COLUMNS} FROM checkers_games WHERE id = $1 AND user_id = $2 FOR UPDATE"))
        .bind(id)
        .bind(user)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(AppError::NotFound)
}

/// Record a finished game: status, leaderboard points, quests and rewards.
async fn finish(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    row: &mut GameRow,
    result: GameResult,
    ending: &str,
) -> AppResult<(Granted, Option<String>)> {
    row.status = match result {
        GameResult::Win => "won",
        GameResult::Loss if ending == "resign" => "resigned",
        GameResult::Loss => "lost",
        GameResult::Draw => "drawn",
    }
    .into();
    row.ending = Some(ending.into());
    let used_undo = row.undos_used > 0;
    let level = row.level();
    let pts = points(level, result, used_undo);
    let total: i32 = sqlx::query_scalar("SELECT COALESCE(MAX(score), 0) FROM scores WHERE user_id = $1 AND game_id = $2")
        .bind(user_id)
        .bind(GAME_ID)
        .fetch_one(&mut **tx)
        .await?;
    sqlx::query("INSERT INTO scores (user_id, game_id, score, level, gained) VALUES ($1, $2, $3, $4, $5)")
        .bind(user_id)
        .bind(GAME_ID)
        .bind(total + pts)
        .bind(level.mult() as i32)
        .bind(pts)
        .execute(&mut **tx)
        .await?;
    let ev = quests::Event::CheckersGame { level: level.mult(), result };
    quests::api::record(tx, user_id, &[ev]).await?;
    // Roll everything random first (the RNG can't be held across awaits).
    let (pay, lucky, pick_seed) = {
        let mut rng = rand::thread_rng();
        (reward(level, result, used_undo, &mut rng), rng.gen_bool(0.2), rng.gen::<u64>())
    };
    let granted = economy::grant(tx, user_id, pay, "checkers_game", true).await?;

    // Lucky drop: a win vs Hard or Master may give a board or piece set.
    let mut drop = None;
    if result == GameResult::Win && level.mult() >= 3 && lucky {
        let owned = owned_keys(&mut **tx, user_id).await?;
        let pick = {
            use rand::SeedableRng;
            items::items().random_unowned(&owned, &mut rand_chacha::ChaCha8Rng::seed_from_u64(pick_seed))
        };
        if let Some(k) = pick {
            sqlx::query("INSERT INTO checkers_items (user_id, item_key, source) VALUES ($1, $2, 'drop') ON CONFLICT DO NOTHING")
                .bind(user_id)
                .bind(&k)
                .execute(&mut **tx)
                .await?;
            drop = Some(k);
        }
    }
    sqlx::query("UPDATE checkers_games SET status = $2, ending = $3, moves = $4, finished_at = now() WHERE id = $1")
        .bind(row.id)
        .bind(&row.status)
        .bind(&row.ending)
        .bind(&row.moves)
        .execute(&mut **tx)
        .await?;
    Ok((granted, drop))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoveRequest {
    /// Move in notation: "11-15", or a capture chain "22x15x8".
    pub mv: String,
}

/// `POST /api/games/checkers/games/:id/move`: your move, then Zero-Bot's reply.
pub async fn make_move(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<MoveRequest>,
) -> AppResult<Json<GameView>> {
    // Check the move and think of the reply before locking the row for long.
    let row: GameRow = sqlx::query_as(&format!("SELECT {COLUMNS} FROM checkers_games WHERE id = $1 AND user_id = $2"))
        .bind(id)
        .bind(user.user_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;
    if row.status != "active" {
        return Err(AppError::Conflict("this game is over".into()));
    }
    let mut g = row.game()?;
    if g.turn != row.side() {
        return Err(AppError::Conflict("wait for Zero-Bot's move".into()));
    }
    g.play_str(&req.mv).map_err(|e| AppError::Validation(e.into()))?;
    let mut ai_move = None;
    if g.outcome() == Outcome::Ongoing {
        let m = bot_move(&g, row.level()).await?;
        ai_move = Some(m.notation());
        g.apply(&m);
    }

    let mut tx = state.pool.begin().await?;
    let mut row = lock(&mut tx, id, user.user_id).await?;
    // Someone else changed the game meanwhile (another tab): try again.
    if row.status != "active" || !g.move_string().starts_with(&row.moves) {
        return Err(AppError::Conflict("the game changed, reload it".into()));
    }
    row.moves = g.move_string();
    let (mut rewards, mut drop) = (None, None);
    if let Some((result, ending)) = result_for(&g, row.side()) {
        let (gr, d) = finish(&mut tx, user.user_id, &mut row, result, ending).await?;
        rewards = Some(gr);
        drop = d;
    } else {
        sqlx::query("UPDATE checkers_games SET moves = $2 WHERE id = $1").bind(row.id).bind(&row.moves).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(view(&row, &g, ai_move, rewards, drop)))
}

/// Your previous turn: the moves with your last move (and Zero-Bot's reply) taken back.
pub fn undo_moves(moves: &str, me: Side) -> Option<String> {
    let list: Vec<&str> = moves.split_whitespace().collect();
    // Dark makes the even-numbered moves (0, 2, …).
    let mine = |i: usize| (i % 2 == 0) == (me == Side::Dark);
    let last_mine = (0..list.len()).rev().find(|&i| mine(i))?;
    Some(list[..last_mine].join(" "))
}

/// `POST /api/games/checkers/games/:id/undo`: take back your move and Zero-Bot's reply.
pub async fn undo(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<GameView>> {
    let mut tx = state.pool.begin().await?;
    let mut row = lock(&mut tx, id, user.user_id).await?;
    if row.status != "active" {
        return Err(AppError::Conflict("this game is over".into()));
    }
    if row.undos_used >= MAX_UNDOS {
        return Err(AppError::Conflict("no undos left".into()));
    }
    let back = undo_moves(&row.moves, row.side()).ok_or_else(|| AppError::Conflict("nothing to undo yet".into()))?;
    row.undos_used += 1;
    row.moves = back;
    let g = row.game()?;
    sqlx::query("UPDATE checkers_games SET moves = $2, undos_used = $3 WHERE id = $1")
        .bind(row.id)
        .bind(&row.moves)
        .bind(row.undos_used)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(view(&row, &g, None, None, None)))
}

/// `POST /api/games/checkers/games/:id/resign`
pub async fn resign(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<GameView>> {
    let mut tx = state.pool.begin().await?;
    let mut row = lock(&mut tx, id, user.user_id).await?;
    if row.status != "active" {
        return Err(AppError::Conflict("this game is over".into()));
    }
    let g = row.game()?;
    let (gr, _) = finish(&mut tx, user.user_id, &mut row, GameResult::Loss, "resign").await?;
    tx.commit().await?;
    Ok(Json(view(&row, &g, None, Some(gr), None)))
}

// ---------------------------------------------------------------------------
// Boards and piece sets
// ---------------------------------------------------------------------------

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
    pub boards: Vec<ItemView>,
    pub pieces: Vec<ItemView>,
}

async fn collection_of(state: &AppState, user_id: Uuid) -> AppResult<Collection> {
    let owned = owned_keys(&state.pool, user_id).await?;
    let cat = items::items();
    let view = |kind| {
        cat.list(kind)
            .iter()
            .map(|i| ItemView { id: i.id.clone(), name: i.name.clone(), rarity: i.rarity, price: i.price, owned: cat.owns(kind, &i.id, &owned) })
            .collect()
    };
    Ok(Collection { boards: view(Kind::Board), pieces: view(Kind::Pieces) })
}

/// `GET /api/games/checkers/collection`
pub async fn collection(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Collection>> {
    Ok(Json(collection_of(&state, user.user_id).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuyRequest {
    pub kind: Kind,
    pub id: String,
}

/// `POST /api/games/checkers/buy`
pub async fn buy(State(state): State<AppState>, user: AuthUser, Json(req): Json<BuyRequest>) -> AppResult<Json<Collection>> {
    let it = items::items().find(req.kind, &req.id).ok_or_else(|| AppError::Validation(format!("unknown item: {}", req.id)))?;
    let price = it.price.ok_or_else(|| AppError::Validation(format!("{} is already free", it.name)))?;
    let key = items::key(req.kind, &it.id);
    let mut tx = state.pool.begin().await?;
    let inserted =
        sqlx::query("INSERT INTO checkers_items (user_id, item_key, source) VALUES ($1, $2, 'shop') ON CONFLICT DO NOTHING")
            .bind(user.user_id)
            .bind(&key)
            .execute(&mut *tx)
            .await?
            .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict(format!("you already own {}", it.name)));
    }
    economy::spend(&mut tx, user.user_id, price, 0, &format!("checkers_shop:{key}")).await?;
    tx.commit().await?;
    Ok(Json(collection_of(&state, user.user_id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    #[test]
    fn harder_levels_pay_more_and_undo_costs_the_token() {
        let mut r = ChaCha8Rng::seed_from_u64(1);
        let easy = reward(Level::Easy, GameResult::Win, false, &mut r);
        let master = reward(Level::Master, GameResult::Win, false, &mut r);
        assert!(master.coins > easy.coins && master.xp > easy.xp);
        assert_eq!(reward(Level::Hard, GameResult::Loss, false, &mut r).coins, 0);
        let tokens: i32 = (0..300).map(|_| reward(Level::Master, GameResult::Win, true, &mut r).tokens).sum();
        assert_eq!(tokens, 0, "undo means no token");
        assert_eq!(points(Level::Master, GameResult::Win, false), 45);
        assert_eq!(points(Level::Easy, GameResult::Draw, false), 3);
    }

    #[test]
    fn undo_goes_back_to_your_turn() {
        // You play dark: moves 0, 2, 4 are yours.
        assert_eq!(undo_moves("11-15 23-19 8-11 22-17", Side::Dark).as_deref(), Some("11-15 23-19"));
        assert_eq!(undo_moves("11-15 23-19 8-11", Side::Dark).as_deref(), Some("11-15 23-19"));
        assert_eq!(undo_moves("11-15", Side::Light), None);
        assert_eq!(undo_moves("11-15 23-19 8-11", Side::Light).as_deref(), Some("11-15"));
        assert_eq!(undo_moves("", Side::Dark), None);
    }

    #[test]
    fn results_from_your_side() {
        let mut g = Game::new();
        assert_eq!(result_for(&g, Side::Dark), None);
        g.quiet = QUIET_LIMIT;
        assert_eq!(result_for(&g, Side::Dark), Some((GameResult::Draw, "quiet")));
    }
}
