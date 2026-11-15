//! Chess vs Zero-Bot: the server keeps the game, checks every move and plays
//! the AI's reply. Also the board-style / piece-set collection and shop.

use std::time::Duration;

use axum::extract::{Path, State};
use axum::Json;
use rand::Rng as _;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::ai::{best_move, Level};
use super::items::{self, Kind};
use super::{Game, Outcome, Side, START_FEN};
use crate::auth::jwt::AuthUser;
use crate::economy::{self, game_xp, GameResult, Granted, Reward};
use crate::error::{AppError, AppResult};
use crate::quests;
use crate::state::AppState;

pub const GAME_ID: &str = "chess";
pub const MAX_UNDOS: i16 = 3;
/// Zero-Bot's thinking time per move.
const AI_BUDGET: Duration = Duration::from_millis(1500);

#[derive(sqlx::FromRow)]
struct GameRow {
    id: Uuid,
    level: String,
    color: String,
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
        if self.color == "black" {
            Side::Black
        } else {
            Side::White
        }
    }
    fn game(&self) -> AppResult<Game> {
        Game::replay(START_FEN, &self.moves).map_err(|e| AppError::Internal(anyhow::anyhow!("chess game {}: {}", self.id, e.text())))
    }
}

#[derive(Serialize)]
pub struct GameView {
    pub id: Uuid,
    pub level: Level,
    /// Your colour.
    pub color: Side,
    pub fen: String,
    /// UCI moves so far.
    pub moves: Vec<String>,
    /// Same moves in SAN ("e4", "Nf3") for the move list.
    pub san: Vec<String>,
    /// Your legal moves now (UCI); empty when it isn't your turn.
    pub legal: Vec<String>,
    pub in_check: bool,
    pub outcome: Outcome,
    /// active | won | lost | drawn | resigned
    pub status: String,
    pub ending: Option<String>,
    pub undos_left: i16,
    pub board_style: String,
    pub piece_set: String,
    /// Zero-Bot's reply to your last move (UCI).
    pub ai_move: Option<String>,
    /// Paid when the game ended with this request.
    pub rewards: Option<Granted>,
    /// Lucky drop ("board:neon") on a win, if any.
    pub drop: Option<String>,
}

fn view(row: &GameRow, g: &Game, ai_move: Option<String>, rewards: Option<Granted>, drop: Option<String>) -> GameView {
    let your_turn = row.status == "active" && g.to_move() == row.side();
    GameView {
        id: row.id,
        level: row.level(),
        color: row.side(),
        fen: g.fen(),
        moves: g.moves().to_vec(),
        san: g.san().to_vec(),
        legal: if your_turn { g.legal_moves() } else { Vec::new() },
        in_check: g.in_check(),
        outcome: g.outcome(),
        status: row.status.clone(),
        ending: row.ending.clone(),
        undos_left: (MAX_UNDOS - row.undos_used).max(0),
        board_style: row.board_style.clone(),
        piece_set: row.piece_set.clone(),
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

/// Leaderboard points for a finished game (running total, like Connect Four).
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

async fn owned_keys(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid) -> AppResult<Vec<String>> {
    Ok(sqlx::query_scalar("SELECT item_key FROM chess_items WHERE user_id = $1").bind(user_id).fetch_all(ex).await?)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateRequest {
    pub level: String,
    /// "white", "black" or "random".
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub board: Option<String>,
    #[serde(default)]
    pub pieces: Option<String>,
}

fn default_color() -> String {
    "white".into()
}

/// `POST /api/games/chess/games`: a new game vs Zero-Bot (an unfinished one is resigned).
pub async fn create(State(state): State<AppState>, user: AuthUser, Json(req): Json<CreateRequest>) -> AppResult<Json<GameView>> {
    let level = Level::parse(&req.level).ok_or_else(|| AppError::Validation("level must be easy, medium, hard or master".into()))?;
    let color = match req.color.as_str() {
        "white" | "black" => req.color.clone(),
        "random" => (if rand::thread_rng().gen_bool(0.5) { "white" } else { "black" }).to_string(),
        _ => return Err(AppError::Validation("color must be white, black or random".into())),
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

    let mut tx = state.pool.begin().await?;
    // One game at a time: starting a new one resigns the old one.
    sqlx::query("UPDATE chess_games SET status = 'resigned', ending = 'resign', finished_at = now() WHERE user_id = $1 AND status = 'active'")
        .bind(user.user_id)
        .execute(&mut *tx)
        .await?;
    let mut row: GameRow = sqlx::query_as(
        r#"INSERT INTO chess_games (user_id, level, color, board_style, piece_set) VALUES ($1, $2, $3, $4, $5)
           RETURNING id, level, color, moves, status, ending, undos_used, board_style, piece_set"#,
    )
    .bind(user.user_id)
    .bind(level.as_str())
    .bind(&color)
    .bind(&board)
    .bind(&pieces)
    .fetch_one(&mut *tx)
    .await?;
    // Zero-Bot opens when you play black.
    let mut g = row.game()?;
    let mut ai_move = None;
    if row.side() == Side::Black {
        let m = best_move(g.board(), level, AI_BUDGET, &mut rand::thread_rng()).expect("opening move");
        g.play_move(m);
        ai_move = g.moves().last().cloned();
        row.moves = g.move_string();
        sqlx::query("UPDATE chess_games SET moves = $2 WHERE id = $1").bind(row.id).bind(&row.moves).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(view(&row, &g, ai_move, None, None)))
}

/// `GET /api/games/chess/games/active`
pub async fn active(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Option<GameView>>> {
    let row: Option<GameRow> = sqlx::query_as(
        "SELECT id, level, color, moves, status, ending, undos_used, board_style, piece_set FROM chess_games WHERE user_id = $1 AND status = 'active'",
    )
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
    sqlx::query_as(
        "SELECT id, level, color, moves, status, ending, undos_used, board_style, piece_set FROM chess_games WHERE id = $1 AND user_id = $2 FOR UPDATE",
    )
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
    let ev = quests::Event::ChessGame { level: level.mult(), result };
    quests::api::record(tx, user_id, &[ev]).await?;
    // Roll everything random first (the RNG can't be held across awaits).
    let (pay, lucky, pick_seed) = {
        let mut rng = rand::thread_rng();
        (reward(level, result, used_undo, &mut rng), rng.gen_bool(0.2), rng.gen::<u64>())
    };
    let granted = economy::grant(tx, user_id, pay, "chess_game", true).await?;

    // Lucky drop: a win vs Hard or Master may give a board or piece set.
    let mut drop = None;
    if result == GameResult::Win && level.mult() >= 3 && lucky {
        let owned = owned_keys(&mut **tx, user_id).await?;
        let pick = {
            use rand::SeedableRng;
            items::items().random_unowned(&owned, &mut rand_chacha::ChaCha8Rng::seed_from_u64(pick_seed))
        };
        if let Some(k) = pick {
            sqlx::query("INSERT INTO chess_items (user_id, item_key, source) VALUES ($1, $2, 'drop') ON CONFLICT DO NOTHING")
                .bind(user_id)
                .bind(&k)
                .execute(&mut **tx)
                .await?;
            drop = Some(k);
        }
    }
    sqlx::query("UPDATE chess_games SET status = $2, ending = $3, moves = $4, finished_at = now() WHERE id = $1")
        .bind(row.id)
        .bind(&row.status)
        .bind(&row.ending)
        .bind(&row.moves)
        .execute(&mut **tx)
        .await?;
    Ok((granted, drop))
}

/// The result for the player when the game is over.
fn result_for(outcome: Outcome, me: Side) -> Option<(GameResult, &'static str)> {
    match outcome {
        Outcome::Ongoing => None,
        Outcome::Checkmate(w) => Some((if w == me { GameResult::Win } else { GameResult::Loss }, "checkmate")),
        Outcome::Stalemate => Some((GameResult::Draw, "stalemate")),
        Outcome::Repetition => Some((GameResult::Draw, "repetition")),
        Outcome::FiftyMoves => Some((GameResult::Draw, "fifty_moves")),
        Outcome::InsufficientMaterial => Some((GameResult::Draw, "insufficient_material")),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoveRequest {
    /// UCI move, e.g. "e2e4", "e7e8q", castling "e1g1".
    pub uci: String,
}

/// `POST /api/games/chess/games/:id/move`: your move, then Zero-Bot's reply.
pub async fn make_move(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<MoveRequest>,
) -> AppResult<Json<GameView>> {
    let mut tx = state.pool.begin().await?;
    let mut row = lock(&mut tx, id, user.user_id).await?;
    if row.status != "active" {
        return Err(AppError::Conflict("this game is over".into()));
    }
    let mut g = row.game()?;
    if g.to_move() != row.side() {
        return Err(AppError::Conflict("wait for Zero-Bot's move".into()));
    }
    g.play(&req.uci).map_err(|e| AppError::Validation(e.text().into()))?;
    let mut ai_move = None;
    if !g.outcome().is_over() {
        let m = best_move(g.board(), row.level(), AI_BUDGET, &mut rand::thread_rng()).expect("a legal reply");
        g.play_move(m);
        ai_move = g.moves().last().cloned();
    }
    row.moves = g.move_string();
    let (mut rewards, mut drop) = (None, None);
    if let Some((result, ending)) = result_for(g.outcome(), row.side()) {
        let (gr, d) = finish(&mut tx, user.user_id, &mut row, result, ending).await?;
        rewards = Some(gr);
        drop = d;
    } else {
        sqlx::query("UPDATE chess_games SET moves = $2 WHERE id = $1").bind(row.id).bind(&row.moves).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(view(&row, &g, ai_move, rewards, drop)))
}

/// `POST /api/games/chess/games/:id/undo`: take back your move and Zero-Bot's reply.
pub async fn undo(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<GameView>> {
    let mut tx = state.pool.begin().await?;
    let mut row = lock(&mut tx, id, user.user_id).await?;
    if row.status != "active" {
        return Err(AppError::Conflict("this game is over".into()));
    }
    if row.undos_used >= MAX_UNDOS {
        return Err(AppError::Conflict("no undos left".into()));
    }
    let mut g = row.game()?;
    // Back to your turn with at least one of your moves taken back.
    let mine = row.side();
    let mut taken = 0;
    while g.undo().is_some() {
        if g.to_move() == mine {
            taken += 1;
            break;
        }
    }
    if taken == 0 {
        return Err(AppError::Conflict("nothing to undo yet".into()));
    }
    row.undos_used += 1;
    row.moves = g.move_string();
    sqlx::query("UPDATE chess_games SET moves = $2, undos_used = $3 WHERE id = $1")
        .bind(row.id)
        .bind(&row.moves)
        .bind(row.undos_used)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(view(&row, &g, None, None, None)))
}

/// `POST /api/games/chess/games/:id/resign`
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
// Board styles and piece sets
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

/// `GET /api/games/chess/collection`
pub async fn collection(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Collection>> {
    Ok(Json(collection_of(&state, user.user_id).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuyRequest {
    pub kind: Kind,
    pub id: String,
}

/// `POST /api/games/chess/buy`
pub async fn buy(State(state): State<AppState>, user: AuthUser, Json(req): Json<BuyRequest>) -> AppResult<Json<Collection>> {
    let it = items::items().find(req.kind, &req.id).ok_or_else(|| AppError::Validation(format!("unknown item: {}", req.id)))?;
    let price = it.price.ok_or_else(|| AppError::Validation(format!("{} is already free", it.name)))?;
    let key = items::key(req.kind, &it.id);
    let mut tx = state.pool.begin().await?;
    let inserted = sqlx::query("INSERT INTO chess_items (user_id, item_key, source) VALUES ($1, $2, 'shop') ON CONFLICT DO NOTHING")
        .bind(user.user_id)
        .bind(&key)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict(format!("you already own {}", it.name)));
    }
    economy::spend(&mut tx, user.user_id, price, 0, &format!("chess_shop:{key}")).await?;
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
        assert!(reward(Level::Hard, GameResult::Loss, false, &mut r).xp > 0);
        let tokens: i32 = (0..300).map(|_| reward(Level::Master, GameResult::Win, true, &mut r).tokens).sum();
        assert_eq!(tokens, 0, "undo means no token");
        assert_eq!(points(Level::Master, GameResult::Win, false), 45);
        assert_eq!(points(Level::Master, GameResult::Win, true), 40);
        assert_eq!(points(Level::Easy, GameResult::Draw, false), 3);
    }

    #[test]
    fn results_from_your_side() {
        assert_eq!(result_for(Outcome::Checkmate(Side::White), Side::White), Some((GameResult::Win, "checkmate")));
        assert_eq!(result_for(Outcome::Checkmate(Side::White), Side::Black), Some((GameResult::Loss, "checkmate")));
        assert_eq!(result_for(Outcome::Stalemate, Side::Black).map(|r| r.0), Some(GameResult::Draw));
        assert_eq!(result_for(Outcome::Ongoing, Side::White), None);
    }
}
