//! Online rooms API. Every action locks the room row, checks it's your turn
//! (or your seat), changes it and bumps `version`; `GET` waits up to
//! `WAIT_SECS` for a newer version so the other screen updates quickly
//! without sockets.

use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::{
    clean_code, new_code, play, play_checkers, play_sonar, play_uci, replay, seat_of, series_xp, sonar_setup, sonar_shot, sonar_state, Game, GameState, Seat, Series,
    EMOTES,
};
use crate::auth::jwt::AuthUser;
use crate::connect_four::board::Outcome;
use crate::economy::{self, Reward};
use crate::error::{AppError, AppResult};
use crate::sonar::CLASSIC_RETIRED;
use crate::state::AppState;

/// Longest a `GET` waits for news.
const WAIT_SECS: u64 = 20;
/// How often a waiting `GET` checks the room.
const POLL_MS: u64 = 700;
/// A player not seen for this long while playing forfeits.
pub const AWAY_SECS: i64 = 120;
/// A room nobody joined is closed after this many minutes.
const WAITING_MINUTES: i64 = 30;

#[derive(sqlx::FromRow, Clone)]
struct Room {
    id: Uuid,
    code: String,
    game: String,
    best_of: i16,
    host_id: Uuid,
    guest_id: Option<Uuid>,
    status: String,
    moves: String,
    game_no: i16,
    first_seat: i16,
    host_wins: i16,
    guest_wins: i16,
    draws: i16,
    game_over: bool,
    winner: Option<i16>,
    rewarded: bool,
    host_rematch: bool,
    guest_rematch: bool,
    host_emote: Option<String>,
    host_emote_at: Option<DateTime<Utc>>,
    guest_emote: Option<String>,
    guest_emote_at: Option<DateTime<Utc>>,
    host_seen: DateTime<Utc>,
    guest_seen: Option<DateTime<Utc>>,
    version: i32,
    created_at: DateTime<Utc>,
    /// Chess: the seat that offered a draw.
    draw_offer: Option<i16>,
    /// Sonar: each seat's secret fleet this game.
    host_fleet: Option<String>,
    guest_fleet: Option<String>,
    /// Sonar: "classic" or "tactics" for the whole room.
    sonar_mode: String,
    /// Sonar Tactics: this game's seed (hides the crates; new every game).
    sonar_seed: i64,
}

impl Room {
    fn game(&self) -> Game {
        Game::parse(&self.game).unwrap_or(Game::ConnectFour)
    }

    /// The board as `viewer` may see it (0 = nobody in particular).
    fn state(&self, viewer: Seat) -> Result<GameState, &'static str> {
        match self.game() {
            Game::Sonar => {
                sonar_state(&self.moves, [self.host_fleet.as_deref(), self.guest_fleet.as_deref()], self.first_seat as u8, viewer, self.sonar_setup())
            }
            g => replay(g, &self.moves),
        }
    }

    /// Sonar: this game's Tactics setup (None = Classic).
    fn sonar_setup(&self) -> Option<crate::sonar::tactics::Setup> {
        sonar_setup(self.sonar_mode == "tactics", self.sonar_seed as u32)
    }

    /// A fresh seed for the next Sonar game.
    fn new_sonar_seed(&mut self) {
        self.sonar_seed = i64::from(rand::Rng::gen::<u32>(&mut rand::thread_rng()));
    }

    /// Sonar: both fleets hidden, so firing can start.
    fn fleets_ready(&self) -> bool {
        self.game() != Game::Sonar || (self.host_fleet.is_some() && self.guest_fleet.is_some())
    }

    fn seat_of(&self, user: Uuid) -> Option<Seat> {
        if self.host_id == user {
            Some(1)
        } else if self.guest_id == Some(user) {
            Some(2)
        } else {
            None
        }
    }

    fn series(&self) -> Series {
        Series { best_of: self.best_of as u8, wins: [self.host_wins as u8, self.guest_wins as u8], draws: self.draws as u8 }
    }
}

#[derive(Serialize)]
pub struct PlayerView {
    pub username: String,
    pub is_guest: bool,
    /// Saved outfit (null = default look).
    pub avatar: Option<serde_json::Value>,
    /// Seen in the last few seconds.
    pub here: bool,
    pub emote: Option<String>,
    pub emote_at: Option<DateTime<Utc>>,
    pub rematch: bool,
}

#[derive(Serialize)]
pub struct RoomView {
    pub code: String,
    pub game: Game,
    pub best_of: i16,
    /// waiting | playing | finished | abandoned
    pub status: String,
    /// Your seat: 1 = host, 2 = joined.
    pub you: Seat,
    pub players: [Option<PlayerView>; 2],
    pub game_no: i16,
    /// Seat that moved first this game.
    pub first_seat: i16,
    pub board: GameState,
    /// This game's moves (digits), e.g. "3324".
    pub moves: String,
    pub your_turn: bool,
    pub game_over: bool,
    /// Wins of seat 1 and seat 2.
    pub wins: [i16; 2],
    pub draws: i16,
    /// Series result: 1/2 = that seat won, 0 = draw.
    pub winner: Option<i16>,
    /// Chess: the seat offering a draw right now.
    pub draw_offer: Option<i16>,
    pub version: i32,
}

#[derive(sqlx::FromRow)]
struct UserBits {
    username: String,
    is_guest: bool,
    avatar: Option<serde_json::Value>,
}

async fn user_bits(ex: impl sqlx::PgExecutor<'_>, id: Uuid) -> AppResult<UserBits> {
    Ok(sqlx::query_as(
        "SELECT u.username, u.is_guest, (SELECT a.loadout FROM avatars a WHERE a.user_id = u.id) AS avatar FROM users u WHERE u.id = $1",
    )
    .bind(id)
    .fetch_one(ex)
    .await?)
}

fn here(seen: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
    seen.is_some_and(|t| (now - t).num_seconds() <= 30)
}

async fn view(pool: &sqlx::PgPool, r: &Room, you: Seat) -> AppResult<RoomView> {
    let now = Utc::now();
    let board = r.state(you).map_err(|e| AppError::Internal(anyhow::anyhow!("room {}: {e}", r.code)))?;
    let host = user_bits(pool, r.host_id).await?;
    let guest = match r.guest_id {
        Some(g) => Some(user_bits(pool, g).await?),
        None => None,
    };
    let to_move = seat_of(board.next, r.first_seat as u8);
    let players = [
        Some(PlayerView {
            username: host.username,
            is_guest: host.is_guest,
            avatar: host.avatar,
            here: here(Some(r.host_seen), now),
            emote: r.host_emote.clone(),
            emote_at: r.host_emote_at,
            rematch: r.host_rematch,
        }),
        guest.map(|g| PlayerView {
            username: g.username,
            is_guest: g.is_guest,
            avatar: g.avatar,
            here: here(r.guest_seen, now),
            emote: r.guest_emote.clone(),
            emote_at: r.guest_emote_at,
            rematch: r.guest_rematch,
        }),
    ];
    Ok(RoomView {
        code: r.code.clone(),
        game: r.game(),
        best_of: r.best_of,
        status: r.status.clone(),
        you,
        players,
        game_no: r.game_no,
        first_seat: r.first_seat,
        your_turn: r.status == "playing" && !r.game_over && r.fleets_ready() && to_move == you,
        board,
        moves: r.moves.clone(),
        game_over: r.game_over,
        wins: [r.host_wins, r.guest_wins],
        draws: r.draws,
        winner: r.winner,
        draw_offer: r.draw_offer,
        version: r.version,
    })
}

async fn lock(tx: &mut Transaction<'_, Postgres>, code: &str) -> AppResult<Room> {
    let code = clean_code(code).ok_or(AppError::NotFound)?;
    sqlx::query_as("SELECT * FROM online_rooms WHERE code = $1 FOR UPDATE")
        .bind(code)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(AppError::NotFound)
}

/// Save every changeable column and bump the version.
async fn save(tx: &mut Transaction<'_, Postgres>, r: &Room) -> AppResult<()> {
    sqlx::query(
        r#"UPDATE online_rooms SET guest_id = $2, status = $3, moves = $4, game_no = $5, first_seat = $6,
               host_wins = $7, guest_wins = $8, draws = $9, game_over = $10, winner = $11, rewarded = $12,
               host_rematch = $13, guest_rematch = $14, host_emote = $15, host_emote_at = $16,
               guest_emote = $17, guest_emote_at = $18, host_seen = $19, guest_seen = $20,
               draw_offer = $21, host_fleet = $22, guest_fleet = $23, sonar_seed = $24, version = version + 1, updated_at = now()
           WHERE id = $1"#,
    )
    .bind(r.id)
    .bind(r.guest_id)
    .bind(&r.status)
    .bind(&r.moves)
    .bind(r.game_no)
    .bind(r.first_seat)
    .bind(r.host_wins)
    .bind(r.guest_wins)
    .bind(r.draws)
    .bind(r.game_over)
    .bind(r.winner)
    .bind(r.rewarded)
    .bind(r.host_rematch)
    .bind(r.guest_rematch)
    .bind(&r.host_emote)
    .bind(r.host_emote_at)
    .bind(&r.guest_emote)
    .bind(r.guest_emote_at)
    .bind(r.host_seen)
    .bind(r.guest_seen)
    .bind(r.draw_offer)
    .bind(&r.host_fleet)
    .bind(&r.guest_fleet)
    .bind(r.sonar_seed)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Pay XP once when the series is decided (no coins).
async fn pay_if_decided(tx: &mut Transaction<'_, Postgres>, r: &mut Room) -> AppResult<()> {
    let Some(w) = r.winner else { return Ok(()) };
    if r.rewarded {
        return Ok(());
    }
    r.rewarded = true;
    let abandoned = r.status == "abandoned";
    sqlx::query(
        "INSERT INTO online_results (room_id, game, host_id, guest_id, winner, abandoned) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(r.id)
    .bind(&r.game)
    .bind(r.host_id)
    .bind(r.guest_id)
    .bind(w)
    .bind(abandoned)
    .execute(&mut **tx)
    .await?;
    for (seat, user) in [(1u8, Some(r.host_id)), (2u8, r.guest_id)] {
        let Some(user) = user else { continue };
        // Whoever walked away gets nothing.
        if abandoned && i16::from(seat) != w {
            continue;
        }
        let xp = series_xp(Some(w as u8), seat);
        if xp > 0 {
            economy::grant(tx, user, Reward { coins: 0, tokens: 0, xp }, "online_series", false).await?;
        }
    }
    Ok(())
}

/// Forfeit for a player who has been away too long (only while playing).
fn check_away(r: &mut Room, now: DateTime<Utc>) -> bool {
    if r.status != "playing" {
        return false;
    }
    let host_away = (now - r.host_seen).num_seconds() > AWAY_SECS;
    let guest_away = r.guest_seen.map_or(true, |t| (now - t).num_seconds() > AWAY_SECS);
    let winner = match (host_away, guest_away) {
        (true, false) => 2,
        (false, true) => 1,
        _ => return false,
    };
    r.status = "abandoned".into();
    r.winner = Some(winner);
    true
}

fn mark_seen(r: &mut Room, seat: Seat, now: DateTime<Utc>) {
    if seat == 1 {
        r.host_seen = now;
    } else {
        r.guest_seen = Some(now);
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateRequest {
    pub game: String,
    #[serde(default = "default_best_of")]
    pub best_of: i16,
    /// Sonar only: "tactics" (the default and the only choice; old "classic"
    /// rooms still play).
    #[serde(default)]
    pub sonar_mode: Option<String>,
}

fn default_best_of() -> i16 {
    3
}

/// `POST /api/rooms`: open a room and wait for a friend.
pub async fn create(State(state): State<AppState>, user: AuthUser, Json(req): Json<CreateRequest>) -> AppResult<Json<RoomView>> {
    let game = Game::parse(&req.game).ok_or_else(|| AppError::Validation("game must be connect-four, tic-tac-toe, chess, sonar or checkers".into()))?;
    if ![1, 3, 5].contains(&req.best_of) {
        return Err(AppError::Validation("best_of must be 1, 3 or 5".into()));
    }
    // Every Sonar room is Tactics (ship powers). Other games store the unused
    // column's old default.
    let sonar_mode = match (game, req.sonar_mode.as_deref()) {
        (Game::Sonar, None | Some("tactics")) => "tactics",
        (_, None) => "classic",
        (Game::Sonar, Some("classic")) => return Err(AppError::Validation(CLASSIC_RETIRED.into())),
        (Game::Sonar, Some(_)) => return Err(AppError::Validation("sonar_mode must be tactics".into())),
        (_, Some(_)) => return Err(AppError::Validation("sonar_mode is only for Sonar rooms".into())),
    };
    let seed = i64::from(rand::Rng::gen::<u32>(&mut rand::thread_rng()));
    // A fresh code; retry on the rare clash.
    for _ in 0..5 {
        let code = new_code(&mut rand::thread_rng());
        let r: Option<Room> = sqlx::query_as(
            r#"INSERT INTO online_rooms (code, game, best_of, host_id, sonar_mode, sonar_seed) VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (code) DO NOTHING RETURNING *"#,
        )
        .bind(&code)
        .bind(game.as_str())
        .bind(req.best_of)
        .bind(user.user_id)
        .bind(sonar_mode)
        .bind(seed)
        .fetch_optional(&state.pool)
        .await?;
        if let Some(r) = r {
            return Ok(Json(view(&state.pool, &r, 1).await?));
        }
    }
    Err(AppError::Conflict("couldn't make a room code, try again".into()))
}

/// `POST /api/rooms/:code/join`: take the empty seat (or rejoin your own).
pub async fn join(State(state): State<AppState>, user: AuthUser, Path(code): Path<String>) -> AppResult<Json<RoomView>> {
    let mut tx = state.pool.begin().await?;
    let mut r = lock(&mut tx, &code).await?;
    let now = Utc::now();
    let seat = match r.seat_of(user.user_id) {
        Some(s) => s,
        None => {
            if r.guest_id.is_some() {
                return Err(AppError::Conflict("this room is already full".into()));
            }
            if r.status != "waiting" || (now - r.created_at).num_minutes() > WAITING_MINUTES {
                return Err(AppError::Conflict("this room has closed. Ask your friend for a new code.".into()));
            }
            r.guest_id = Some(user.user_id);
            r.status = "playing".into();
            2
        }
    };
    mark_seen(&mut r, seat, now);
    save(&mut tx, &r).await?;
    tx.commit().await?;
    let r = reload(&state.pool, r.id).await?;
    Ok(Json(view(&state.pool, &r, seat).await?))
}

async fn reload(pool: &sqlx::PgPool, id: Uuid) -> AppResult<Room> {
    Ok(sqlx::query_as("SELECT * FROM online_rooms WHERE id = $1").bind(id).fetch_one(pool).await?)
}

#[derive(Deserialize, Default)]
pub struct WaitQuery {
    /// Return as soon as the room's version is newer than this.
    pub since: Option<i32>,
}

/// `GET /api/rooms/:code?since=N`: the room, waiting up to 20 s for news.
pub async fn get(
    State(state): State<AppState>,
    user: AuthUser,
    Path(code): Path<String>,
    q: Option<Query<WaitQuery>>,
) -> AppResult<Json<RoomView>> {
    let since = q.and_then(|q| q.0.since);
    // Say we're here (and forfeit an opponent who left), then wait.
    let (id, seat) = {
        let mut tx = state.pool.begin().await?;
        let mut r = lock(&mut tx, &code).await?;
        let seat = r.seat_of(user.user_id).ok_or(AppError::NotFound)?;
        let now = Utc::now();
        mark_seen(&mut r, seat, now);
        if check_away(&mut r, now) {
            pay_if_decided(&mut tx, &mut r).await?;
            save(&mut tx, &r).await?;
        } else {
            // Presence only: no version bump, so nobody wakes up for it.
            sqlx::query("UPDATE online_rooms SET host_seen = $2, guest_seen = $3 WHERE id = $1")
                .bind(r.id)
                .bind(r.host_seen)
                .bind(r.guest_seen)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        (r.id, seat)
    };
    let deadline = tokio::time::Instant::now() + Duration::from_secs(WAIT_SECS);
    loop {
        let r = reload(&state.pool, id).await?;
        if since.map_or(true, |s| r.version > s) || tokio::time::Instant::now() >= deadline {
            return Ok(Json(view(&state.pool, &r, seat).await?));
        }
        tokio::time::sleep(Duration::from_millis(POLL_MS)).await;
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoveRequest {
    /// Column (Connect Four, 0–6) or square (Tic-Tac-Toe, 0–8).
    #[serde(default)]
    pub cell: Option<u8>,
    /// Chess move in UCI ("e2e4", "e7e8q", castling "e1g1").
    #[serde(default)]
    pub uci: Option<String>,
    /// Sonar: a sonar ping centred on `cell` instead of a shot.
    #[serde(default)]
    pub ping: Option<bool>,
}

/// A Sonar move from a request: a shot or ping at `cell`, or (Tactics) a
/// move code in `uci` ("a12h", "o2", …).
fn sonar_move(cell: Option<u8>, code: Option<&str>, ping: bool) -> Result<crate::sonar::rules::Move, &'static str> {
    match (cell, code) {
        (Some(c), _) => sonar_shot(c, ping),
        (None, Some(code)) => crate::sonar::rules::Move::parse(code).ok_or("that isn't a Sonar move"),
        (None, None) => Err("send the square to fire at"),
    }
}

/// `POST /api/rooms/:code/move`
pub async fn make_move(
    State(state): State<AppState>,
    user: AuthUser,
    Path(code): Path<String>,
    Json(req): Json<MoveRequest>,
) -> AppResult<Json<RoomView>> {
    let mut tx = state.pool.begin().await?;
    let mut r = lock(&mut tx, &code).await?;
    let seat = r.seat_of(user.user_id).ok_or(AppError::NotFound)?;
    let now = Utc::now();
    mark_seen(&mut r, seat, now);
    if r.status != "playing" || r.game_over {
        return Err(AppError::Conflict("there's no game in progress".into()));
    }
    if !r.fleets_ready() {
        return Err(AppError::Conflict("wait until both fleets are hidden".into()));
    }
    let board = r.state(0).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    if seat_of(board.next, r.first_seat as u8) != seat {
        return Err(AppError::Conflict("it's your friend's turn".into()));
    }
    r.moves = match (r.game(), req.cell, req.uci.as_deref()) {
        (Game::Sonar, cell, code) => sonar_move(cell, code, req.ping.unwrap_or(false)).and_then(|m| {
            play_sonar(
                &r.moves,
                [r.host_fleet.as_deref().unwrap_or_default(), r.guest_fleet.as_deref().unwrap_or_default()],
                r.first_seat as u8,
                r.sonar_setup(),
                m,
            )
        }),
        (Game::Chess, _, Some(uci)) => play_uci(&r.moves, uci),
        (Game::Chess, _, None) => Err("send a chess move as uci"),
        (Game::Checkers, _, Some(mv)) => play_checkers(&r.moves, mv),
        (Game::Checkers, _, None) => Err("send a checkers move as uci, e.g. 11-15"),
        (g, Some(cell), _) => play(g, &r.moves, cell),
        (_, None, _) => Err("send the cell to play"),
    }
    .map_err(|e| AppError::Validation(e.into()))?;
    r.draw_offer = None;
    let after = r.state(0).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    if after.outcome != Outcome::Ongoing {
        end_game(&mut tx, &mut r, after.outcome).await?;
    }
    save(&mut tx, &r).await?;
    tx.commit().await?;
    let r = reload(&state.pool, r.id).await?;
    Ok(Json(view(&state.pool, &r, seat).await?))
}

/// Count a finished game in the series; finish the series when decided.
async fn end_game(tx: &mut Transaction<'_, Postgres>, r: &mut Room, outcome: Outcome) -> AppResult<()> {
    r.game_over = true;
    r.draw_offer = None;
    let mut s = r.series();
    s.record(outcome, r.first_seat as u8);
    r.host_wins = i16::from(s.wins[0]);
    r.guest_wins = i16::from(s.wins[1]);
    r.draws = i16::from(s.draws);
    if let Some(w) = s.winner() {
        r.winner = Some(i16::from(w));
        r.status = "finished".into();
        pay_if_decided(tx, r).await?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DrawRequest {
    /// "offer", "accept" or "decline".
    pub action: String,
}

/// `POST /api/rooms/:code/draw`: offer a draw, or answer the other player's offer (chess).
pub async fn draw(
    State(state): State<AppState>,
    user: AuthUser,
    Path(code): Path<String>,
    Json(req): Json<DrawRequest>,
) -> AppResult<Json<RoomView>> {
    let mut tx = state.pool.begin().await?;
    let mut r = lock(&mut tx, &code).await?;
    let seat = r.seat_of(user.user_id).ok_or(AppError::NotFound)?;
    if r.game() != Game::Chess || r.status != "playing" || r.game_over {
        return Err(AppError::Conflict("there's no chess game to draw".into()));
    }
    let theirs = r.draw_offer.is_some_and(|s| s != i16::from(seat));
    match req.action.as_str() {
        "offer" => r.draw_offer = Some(i16::from(seat)),
        "accept" if theirs => end_game(&mut tx, &mut r, Outcome::Draw).await?,
        "decline" if theirs => r.draw_offer = None,
        "accept" | "decline" => return Err(AppError::Conflict("there's no draw offer to answer".into())),
        _ => return Err(AppError::Validation("action must be offer, accept or decline".into())),
    }
    mark_seen(&mut r, seat, Utc::now());
    save(&mut tx, &r).await?;
    tx.commit().await?;
    let r = reload(&state.pool, r.id).await?;
    Ok(Json(view(&state.pool, &r, seat).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FleetRequest {
    /// Fleet code, e.g. "a1h a3h a5h a7h a9h".
    pub fleet: String,
}

/// `POST /api/rooms/:code/fleet`: hide your Sonar fleet for this game.
pub async fn fleet(
    State(state): State<AppState>,
    user: AuthUser,
    Path(code): Path<String>,
    Json(req): Json<FleetRequest>,
) -> AppResult<Json<RoomView>> {
    let fleet = crate::sonar::rules::Fleet::parse(&req.fleet).map_err(|e| AppError::Validation(e.text().into()))?;
    let mut tx = state.pool.begin().await?;
    let mut r = lock(&mut tx, &code).await?;
    let seat = r.seat_of(user.user_id).ok_or(AppError::NotFound)?;
    if r.game() != Game::Sonar || r.status != "playing" || r.game_over {
        return Err(AppError::Conflict("there's no Sonar game to place a fleet in".into()));
    }
    if r.sonar_mode != "tactics" && !fleet.mines.is_empty() {
        return Err(AppError::Validation("mines are only for Tactics games".into()));
    }
    let slot = if seat == 1 { &mut r.host_fleet } else { &mut r.guest_fleet };
    if slot.is_some() {
        return Err(AppError::Conflict("your fleet is already hidden".into()));
    }
    *slot = Some(fleet.code());
    mark_seen(&mut r, seat, Utc::now());
    save(&mut tx, &r).await?;
    tx.commit().await?;
    let r = reload(&state.pool, r.id).await?;
    Ok(Json(view(&state.pool, &r, seat).await?))
}

/// `POST /api/rooms/:code/next`: start the next game of the series.
pub async fn next_game(State(state): State<AppState>, user: AuthUser, Path(code): Path<String>) -> AppResult<Json<RoomView>> {
    let mut tx = state.pool.begin().await?;
    let mut r = lock(&mut tx, &code).await?;
    let seat = r.seat_of(user.user_id).ok_or(AppError::NotFound)?;
    if r.status == "playing" && r.game_over {
        r.moves.clear();
        r.host_fleet = None;
        r.guest_fleet = None;
        r.new_sonar_seed();
        r.game_over = false;
        r.game_no += 1;
        r.first_seat = 3 - r.first_seat;
        save(&mut tx, &r).await?;
    }
    tx.commit().await?;
    let r = reload(&state.pool, r.id).await?;
    Ok(Json(view(&state.pool, &r, seat).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmoteRequest {
    pub emote: String,
}

/// `POST /api/rooms/:code/emote`: 👋 😀 😮 😢 🔥 for the other screen.
pub async fn emote(
    State(state): State<AppState>,
    user: AuthUser,
    Path(code): Path<String>,
    Json(req): Json<EmoteRequest>,
) -> AppResult<Json<RoomView>> {
    if !EMOTES.contains(&req.emote.as_str()) {
        return Err(AppError::Validation("unknown emote".into()));
    }
    let mut tx = state.pool.begin().await?;
    let mut r = lock(&mut tx, &code).await?;
    let seat = r.seat_of(user.user_id).ok_or(AppError::NotFound)?;
    let now = Utc::now();
    // At most one emote a second per player.
    let last = if seat == 1 { r.host_emote_at } else { r.guest_emote_at };
    if last.is_some_and(|t| (now - t).num_milliseconds() < 1000) {
        return Err(AppError::Conflict("slow down a little".into()));
    }
    if seat == 1 {
        r.host_emote = Some(req.emote);
        r.host_emote_at = Some(now);
    } else {
        r.guest_emote = Some(req.emote);
        r.guest_emote_at = Some(now);
    }
    mark_seen(&mut r, seat, now);
    save(&mut tx, &r).await?;
    tx.commit().await?;
    let r = reload(&state.pool, r.id).await?;
    Ok(Json(view(&state.pool, &r, seat).await?))
}

/// `POST /api/rooms/:code/leave`: give up (the other player wins the series).
pub async fn leave(State(state): State<AppState>, user: AuthUser, Path(code): Path<String>) -> AppResult<Json<RoomView>> {
    let mut tx = state.pool.begin().await?;
    let mut r = lock(&mut tx, &code).await?;
    let seat = r.seat_of(user.user_id).ok_or(AppError::NotFound)?;
    match r.status.as_str() {
        "waiting" => {
            r.status = "abandoned".into();
        }
        "playing" => {
            r.status = "abandoned".into();
            r.winner = Some(i16::from(3 - seat));
            pay_if_decided(&mut tx, &mut r).await?;
        }
        _ => {}
    }
    save(&mut tx, &r).await?;
    tx.commit().await?;
    let r = reload(&state.pool, r.id).await?;
    Ok(Json(view(&state.pool, &r, seat).await?))
}

/// `POST /api/rooms/:code/rematch`: when both ask, a new series starts.
pub async fn rematch(State(state): State<AppState>, user: AuthUser, Path(code): Path<String>) -> AppResult<Json<RoomView>> {
    let mut tx = state.pool.begin().await?;
    let mut r = lock(&mut tx, &code).await?;
    let seat = r.seat_of(user.user_id).ok_or(AppError::NotFound)?;
    if r.status != "finished" {
        return Err(AppError::Conflict("the series isn't over yet".into()));
    }
    if seat == 1 {
        r.host_rematch = true;
    } else {
        r.guest_rematch = true;
    }
    if r.host_rematch && r.guest_rematch {
        r.status = "playing".into();
        r.moves.clear();
        r.host_fleet = None;
        r.guest_fleet = None;
        r.new_sonar_seed();
        r.game_over = false;
        r.game_no = 1;
        r.first_seat = 3 - r.first_seat;
        r.host_wins = 0;
        r.guest_wins = 0;
        r.draws = 0;
        r.winner = None;
        r.rewarded = false;
        r.host_rematch = false;
        r.guest_rematch = false;
    }
    mark_seen(&mut r, seat, Utc::now());
    save(&mut tx, &r).await?;
    tx.commit().await?;
    let r = reload(&state.pool, r.id).await?;
    Ok(Json(view(&state.pool, &r, seat).await?))
}

#[derive(Deserialize)]
pub struct BoardQuery {
    pub game: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct OnlineEntry {
    pub rank: i64,
    pub username: String,
    pub wins: i64,
    pub played: i64,
    pub avatar: Option<serde_json::Value>,
}

/// `GET /api/rooms/leaderboard?game=connect-four`: most online series won.
pub async fn leaderboard(State(state): State<AppState>, Query(q): Query<BoardQuery>) -> AppResult<Json<Vec<OnlineEntry>>> {
    let game = Game::parse(&q.game).ok_or_else(|| AppError::Validation("unknown game".into()))?;
    Ok(Json(
        sqlx::query_as(
            r#"WITH seats AS (
                   SELECT host_id AS user_id, winner = 1 AS won FROM online_results WHERE game = $1
                   UNION ALL
                   SELECT guest_id, winner = 2 FROM online_results WHERE game = $1 AND guest_id IS NOT NULL
               )
               SELECT ROW_NUMBER() OVER (ORDER BY COUNT(*) FILTER (WHERE s.won) DESC, COUNT(*) ASC) AS rank,
                      u.username, COUNT(*) FILTER (WHERE s.won) AS wins, COUNT(*) AS played,
                      (SELECT a.loadout FROM avatars a WHERE a.user_id = u.id) AS avatar
               FROM seats s JOIN users u ON u.id = s.user_id
               WHERE NOT u.is_guest AND NOT u.hide_on_leaderboards AND u.delete_requested_at IS NULL
               GROUP BY u.id, u.username
               HAVING COUNT(*) FILTER (WHERE s.won) > 0
               ORDER BY rank
               LIMIT 20"#,
        )
        .bind(game.as_str())
        .fetch_all(&state.pool)
        .await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn room() -> Room {
        let t = Utc::now();
        Room {
            id: Uuid::nil(),
            code: "ABCDEF".into(),
            game: "tic-tac-toe".into(),
            best_of: 3,
            host_id: Uuid::from_u128(1),
            guest_id: Some(Uuid::from_u128(2)),
            status: "playing".into(),
            moves: String::new(),
            game_no: 1,
            first_seat: 1,
            host_wins: 0,
            guest_wins: 0,
            draws: 0,
            game_over: false,
            winner: None,
            rewarded: false,
            host_rematch: false,
            guest_rematch: false,
            host_emote: None,
            host_emote_at: None,
            guest_emote: None,
            guest_emote_at: None,
            host_seen: t,
            guest_seen: Some(t),
            version: 1,
            created_at: t,
            draw_offer: None,
            host_fleet: None,
            guest_fleet: None,
            sonar_mode: "classic".into(),
            sonar_seed: 0,
        }
    }

    #[test]
    fn seats_belong_to_the_two_players_only() {
        let r = room();
        assert_eq!(r.seat_of(Uuid::from_u128(1)), Some(1));
        assert_eq!(r.seat_of(Uuid::from_u128(2)), Some(2));
        assert_eq!(r.seat_of(Uuid::from_u128(3)), None);
    }

    #[test]
    fn a_player_away_for_two_minutes_forfeits() {
        let now = Utc::now();
        let mut r = room();
        assert!(!check_away(&mut r, now));
        r.guest_seen = Some(now - chrono::Duration::seconds(AWAY_SECS + 5));
        assert!(check_away(&mut r, now));
        assert_eq!((r.status.as_str(), r.winner), ("abandoned", Some(1)));
        // Waiting rooms never forfeit.
        let mut w = room();
        w.status = "waiting".into();
        w.guest_seen = None;
        assert!(!check_away(&mut w, now));
    }
}
