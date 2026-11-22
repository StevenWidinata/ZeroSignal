//! Sonar vs Zero-Bot: the server keeps both fleets, checks every shot and
//! plays Zero-Bot's reply. Zero-Bot's fleet is only sent once the game ends.
//! Games are Classic, Tactics (ship powers, mines, crates, Overdrive; see
//! `tactics.rs`) or a Campaign mission (`campaign.rs`). Also the fleet / sea
//! collection and shop.

use axum::extract::{Path, State};
use axum::Json;
use rand::Rng as _;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::ai::{bot_mines, choose_for, Level};
use super::campaign;
use super::items::{self, Kind};
use super::rules::{random_fleet, Duel, Fleet, Move, ShotResult, CELLS};
use super::tactics::{levels_code, parse_levels, tactics_rules, Levels, Setup};
use super::workshop::{bot_levels, levels_of};
use super::view::{log_for, LogEntry, PowersView, SeaView};
use crate::auth::jwt::AuthUser;
use crate::economy::{self, game_xp, GameResult, Granted, Reward};
use crate::error::{AppError, AppResult};
use crate::quests;
use crate::sonar::CLASSIC_RETIRED;
use crate::state::AppState;

pub const GAME_ID: &str = "sonar";
/// The player is side 0 and fires first; Zero-Bot is side 1.
const YOU: usize = 0;
const BOT: usize = 1;

#[derive(sqlx::FromRow)]
struct GameRow {
    id: Uuid,
    level: String,
    player_fleet: String,
    ai_fleet: String,
    moves: String,
    status: String,
    fleet_skin: String,
    sea: String,
    mode: String,
    seed: i64,
    levels: Option<String>,
    crates: i16,
    /// Campaign: the mission.
    op: Option<i16>,
}

const COLUMNS: &str = "id, level, player_fleet, ai_fleet, moves, status, fleet_skin, sea, mode, seed, levels, crates, op";

/// Classic (shots and 2 pings), Tactics (ship powers, mines, crates) or a
/// Campaign mission (Tactics with twists).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Classic,
    Tactics,
    Campaign,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        match s {
            "classic" => Some(Mode::Classic),
            "tactics" => Some(Mode::Tactics),
            "campaign" => Some(Mode::Campaign),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Classic => "classic",
            Mode::Tactics => "tactics",
            Mode::Campaign => "campaign",
        }
    }
}

/// "1,1,1,1,1 2,1,1,1,1" -> both sides' Mk levels.
fn parse_both_levels(s: &str) -> Option<[Levels; 2]> {
    let (a, b) = s.split_once(' ')?;
    Some([parse_levels(a)?, parse_levels(b)?])
}

impl GameRow {
    fn level(&self) -> Level {
        Level::parse(&self.level).unwrap_or(Level::Easy)
    }
    fn fleets(&self) -> AppResult<(Fleet, Fleet)> {
        let bad = |e: super::rules::FleetError| AppError::Internal(anyhow::anyhow!("sonar game {}: {}", self.id, e.text()));
        // Zero-Bot hides more mines in some missions.
        let bot_mines = self.mission().map_or(tactics_rules().mines, |o| o.bot_mines);
        Ok((Fleet::parse(&self.player_fleet).map_err(bad)?, Fleet::parse_with_mines(&self.ai_fleet, bot_mines).map_err(bad)?))
    }
    fn mission(&self) -> Option<&'static campaign::Op> {
        self.op.and_then(campaign::op)
    }
    fn mode(&self) -> Mode {
        Mode::parse(&self.mode).unwrap_or(Mode::Classic)
    }
    /// The Tactics setup this game was started with (None for Classic).
    fn setup(&self) -> AppResult<Option<Setup>> {
        if self.mode() == Mode::Classic {
            return Ok(None);
        }
        let levels = self
            .levels
            .as_deref()
            .and_then(parse_both_levels)
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("sonar game {}: bad levels", self.id)))?;
        let twists = self.mission().map(|o| o.setup(levels[0], 0).twists).unwrap_or_default();
        Ok(Some(Setup { levels, seed: self.seed as u32, crates: self.crates as u8, twists }))
    }
    fn duel(&self) -> AppResult<Duel> {
        let (you, bot) = self.fleets()?;
        let bad = |e: super::rules::ShotError| AppError::Internal(anyhow::anyhow!("sonar game {}: {}", self.id, e.text()));
        match self.setup()? {
            Some(setup) => Duel::replay_tactics([&you, &bot], YOU, setup, &self.moves).map_err(bad),
            None => Duel::replay([&you, &bot], YOU, &self.moves).map_err(bad),
        }
    }
}

#[derive(Serialize)]
pub struct GameView {
    pub id: Uuid,
    pub level: Level,
    /// classic | tactics | campaign
    pub mode: &'static str,
    /// Campaign: the mission, its move limit and (once won) the stars.
    pub op: Option<i16>,
    pub move_limit: Option<i16>,
    pub stars: Option<StarsView>,
    /// active | won | lost | resigned
    pub status: String,
    /// Your fleet code.
    pub fleet: String,
    /// Your sea, as Zero-Bot has shot at it.
    pub your_sea: SeaView,
    /// Zero-Bot's sea, as you have shot at it.
    pub target: SeaView,
    pub log: Vec<LogEntry>,
    pub your_turn: bool,
    /// Tactics: your ship powers, combo and Overdrive.
    pub powers: Option<PowersView>,
    /// Tactics: Zero-Bot's (public too: they follow from the moves).
    pub bot_powers: Option<PowersView>,
    /// Zero-Bot's fleet, only once the game is over.
    pub ai_fleet: Option<String>,
    pub fleet_skin: String,
    pub sea: String,
    pub rewards: Option<Granted>,
    pub points: Option<i32>,
    pub drop: Option<String>,
}

/// Campaign stars for a finished mission.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct StarsView {
    pub stars: i16,
    /// Stars earned for the first time (they paid `coins`).
    pub new_stars: i16,
    pub coins: i64,
}

/// What finishing a game gave.
#[derive(Default)]
struct Finished {
    rewards: Option<Granted>,
    points: Option<i32>,
    drop: Option<String>,
    stars: Option<StarsView>,
}

fn view(row: &GameRow, d: &Duel, f: Finished) -> GameView {
    let Finished { rewards, points, drop, stars } = f;
    GameView {
        id: row.id,
        level: row.level(),
        mode: row.mode().as_str(),
        op: row.op,
        move_limit: row.mission().and_then(|o| o.move_limit),
        stars,
        status: row.status.clone(),
        fleet: row.player_fleet.clone(),
        your_sea: SeaView::of(&d.seas[YOU]),
        target: SeaView::of(&d.seas[BOT]),
        log: log_for(d, YOU),
        your_turn: row.status == "active" && d.to_move() == YOU,
        powers: PowersView::of(d, YOU),
        bot_powers: PowersView::of(d, BOT),
        ai_fleet: (row.status != "active").then(|| row.ai_fleet.clone()),
        fleet_skin: row.fleet_skin.clone(),
        sea: row.sea.clone(),
        rewards,
        points,
        drop,
    }
}

/// Coins for beating each level (token chance in %).
pub fn win_coins(level: Level) -> (i64, u32) {
    match level {
        Level::Easy => (6, 5),
        Level::Medium => (15, 10),
        Level::Hard => (30, 20),
        Level::Master => (60, 40),
    }
}

/// Leaderboard points for a game (running total, like chess).
pub fn points(level: Level, result: GameResult, ships_lost: usize) -> i32 {
    match result {
        GameResult::Win => 10 * level.mult() as i32 + if ships_lost == 0 { 5 } else { 0 },
        _ => 0,
    }
}

pub fn reward(level: Level, result: GameResult, rng: &mut impl rand::Rng) -> Reward {
    let xp = game_xp(result, level.mult());
    if result != GameResult::Win {
        return Reward { coins: 0, tokens: 0, xp };
    }
    let (coins, pct) = win_coins(level);
    Reward { coins, tokens: economy::roll_token(f64::from(pct) / 100.0, rng), xp }
}

async fn owned_keys(ex: impl sqlx::PgExecutor<'_>, user_id: Uuid) -> AppResult<Vec<String>> {
    Ok(sqlx::query_scalar("SELECT item_key FROM sonar_items WHERE user_id = $1").bind(user_id).fetch_all(ex).await?)
}

/// Check a fleet look and sea you asked for (default: the first free ones).
pub async fn pick_look(pool: &sqlx::PgPool, user_id: Uuid, fleet_skin: Option<String>, sea: Option<String>) -> AppResult<(String, String)> {
    let cat = items::items();
    let owned = owned_keys(pool, user_id).await?;
    let fleet_skin = fleet_skin.unwrap_or_else(|| cat.default_id(Kind::Fleet).to_string());
    let sea = sea.unwrap_or_else(|| cat.default_id(Kind::Sea).to_string());
    if !cat.owns(Kind::Fleet, &fleet_skin, &owned) {
        return Err(AppError::Validation("you don't own that fleet look".into()));
    }
    if !cat.owns(Kind::Sea, &sea, &owned) {
        return Err(AppError::Validation("you don't own that sea".into()));
    }
    Ok((fleet_skin, sea))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateRequest {
    pub level: String,
    /// "tactics" (default) or "campaign" (with `op`); "classic" is refused.
    #[serde(default)]
    pub mode: Option<String>,
    /// Campaign: the mission to play.
    #[serde(default)]
    pub op: Option<i16>,
    /// Your fleet code ("a1h a3h a5h a7h a9h").
    pub fleet: String,
    #[serde(default)]
    pub fleet_skin: Option<String>,
    #[serde(default)]
    pub sea: Option<String>,
}

/// `POST /api/games/sonar/games`: a new game vs Zero-Bot (an unfinished one is resigned).
pub async fn create(State(state): State<AppState>, user: AuthUser, Json(req): Json<CreateRequest>) -> AppResult<Json<GameView>> {
    let mut level = Level::parse(&req.level).ok_or_else(|| AppError::Validation("level must be easy, medium, hard or master".into()))?;
    // Every new battle has ship powers; unfinished Classic games still play.
    let mode = match req.mode.as_deref() {
        None | Some("tactics") => Mode::Tactics,
        Some("campaign") => Mode::Campaign,
        Some("classic") => return Err(AppError::Validation(CLASSIC_RETIRED.into())),
        Some(_) => return Err(AppError::Validation("mode must be tactics or campaign".into())),
    };
    let mission = match (mode, req.op) {
        (Mode::Campaign, Some(id)) => {
            let o = campaign::op(id).ok_or_else(|| AppError::Validation(format!("there's no mission {id}")))?;
            if !campaign::unlocked(&state.pool, user.user_id, id).await? {
                return Err(AppError::Conflict(format!("win mission {} first", id - 1)));
            }
            level = o.level;
            Some(o)
        }
        (Mode::Campaign, None) => return Err(AppError::Validation("pick a mission".into())),
        (_, Some(_)) => return Err(AppError::Validation("missions are only in campaign mode".into())),
        _ => None,
    };
    let fleet = Fleet::parse(&req.fleet).map_err(|e| AppError::Validation(e.text().into()))?;
    let (fleet_skin, sea) = pick_look(&state.pool, user.user_id, req.fleet_skin, req.sea).await?;
    let (ai_fleet, seed) = {
        let mut rng = rand::thread_rng();
        let mut f = random_fleet(&mut rng);
        f.mines = bot_mines(&f, mission.map_or(tactics_rules().mines, |o| o.bot_mines), level, &mut rng);
        (f, rng.gen::<u32>())
    };
    let (seed, levels, crates) = match mode {
        Mode::Classic => unreachable!("new games are never Classic"),
        Mode::Tactics => {
            // Your Workshop upgrades against Zero-Bot's level (Hard Mk II, Master Mk III).
            let yours = levels_of(&state.pool, user.user_id).await?;
            (i64::from(seed), Some(format!("{} {}", levels_code(&yours), levels_code(&bot_levels(level)))), i16::from(tactics_rules().crates))
        }
        Mode::Campaign => {
            let o = mission.expect("campaign games have a mission");
            let yours = levels_of(&state.pool, user.user_id).await?;
            let setup = o.setup(yours, 0);
            (i64::from(seed), Some(format!("{} {}", levels_code(&setup.levels[0]), levels_code(&setup.levels[1]))), i16::from(setup.crates))
        }
    };

    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE sonar_games SET status = 'resigned', finished_at = now() WHERE user_id = $1 AND status = 'active'")
        .bind(user.user_id)
        .execute(&mut *tx)
        .await?;
    let row: GameRow = sqlx::query_as(&format!(
        "INSERT INTO sonar_games (user_id, level, player_fleet, ai_fleet, fleet_skin, sea, mode, seed, levels, crates, op) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING {COLUMNS}"
    ))
    .bind(user.user_id)
    .bind(level.as_str())
    .bind(fleet.code())
    .bind(ai_fleet.code())
    .bind(&fleet_skin)
    .bind(&sea)
    .bind(mode.as_str())
    .bind(seed)
    .bind(&levels)
    .bind(crates)
    .bind(mission.map(|o| o.id))
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    let d = row.duel()?;
    Ok(Json(view(&row, &d, Finished::default())))
}

/// `GET /api/games/sonar/games/active`
pub async fn active(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Option<GameView>>> {
    let row: Option<GameRow> = sqlx::query_as(&format!("SELECT {COLUMNS} FROM sonar_games WHERE user_id = $1 AND status = 'active'"))
        .bind(user.user_id)
        .fetch_optional(&state.pool)
        .await?;
    match row {
        Some(r) => {
            let d = r.duel()?;
            Ok(Json(Some(view(&r, &d, Finished::default()))))
        }
        None => Ok(Json(None)),
    }
}

async fn lock(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, id: Uuid, user: Uuid) -> AppResult<GameRow> {
    sqlx::query_as(&format!("SELECT {COLUMNS} FROM sonar_games WHERE id = $1 AND user_id = $2 FOR UPDATE"))
        .bind(id)
        .bind(user)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(AppError::NotFound)
}

/// Record a finished game: status, points, quests, rewards and a lucky drop.
async fn finish(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    row: &mut GameRow,
    d: &Duel,
    result: GameResult,
    resigned: bool,
) -> AppResult<Finished> {
    row.status = match result {
        GameResult::Win => "won",
        _ if resigned => "resigned",
        _ => "lost",
    }
    .into();
    let level = row.level();
    let ships_lost = d.seas[YOU].sunk_ships().len();
    let mission = row.mission();
    // Campaign missions pay in stars, not leaderboard points.
    let pts = if mission.is_some() { 0 } else { points(level, result, ships_lost) };
    if pts > 0 {
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
    }
    let (powers_used, crates_opened) = tally(d, YOU);
    if !resigned {
        let mut events = vec![quests::Event::SonarGame { level: level.mult(), result }];
        if row.mode() != Mode::Classic {
            events.push(quests::Event::SonarTactics { result, powers: powers_used, crates: crates_opened });
        }
        quests::api::record(tx, user_id, &events).await?;
    }
    let (mut pay, lucky, seed) = {
        let mut rng = rand::thread_rng();
        (reward(level, result, &mut rng), rng.gen_bool(0.2), rng.gen::<u64>())
    };
    let mut stars = None;
    if let Some(o) = mission {
        // XP as usual; coins only for stars earned for the first time.
        pay.coins = 0;
        pay.tokens = 0;
        let moves = d.seas[BOT].shots() as i16;
        let earned = o.stars(result == GameResult::Win, moves, ships_lost);
        if earned > 0 {
            let new_stars = campaign::record(tx, user_id, o.id, earned, moves).await?;
            pay.coins = o.coins_for(new_stars);
            stars = Some(StarsView { stars: earned, new_stars, coins: pay.coins });
        }
    }
    let granted = economy::grant(tx, user_id, pay, if mission.is_some() { "sonar_campaign" } else { "sonar_game" }, true).await?;
    let mut drop = None;
    if result == GameResult::Win && level.mult() >= 3 && lucky && mission.is_none() {
        let owned = owned_keys(&mut **tx, user_id).await?;
        let pick = {
            use rand::SeedableRng;
            items::items().random_unowned(&owned, &mut rand_chacha::ChaCha8Rng::seed_from_u64(seed))
        };
        if let Some(k) = pick {
            sqlx::query("INSERT INTO sonar_items (user_id, item_key, source) VALUES ($1, $2, 'drop') ON CONFLICT DO NOTHING")
                .bind(user_id)
                .bind(&k)
                .execute(&mut **tx)
                .await?;
            drop = Some(k);
        }
    }
    let tactics = row.mode() != Mode::Classic;
    sqlx::query(
        "UPDATE sonar_games SET status = $2, moves = $3, ships_lost = $4, shots = $5, powers_used = $6, crates_opened = $7, finished_at = now() \
         WHERE id = $1",
    )
    .bind(row.id)
    .bind(&row.status)
    .bind(&row.moves)
    .bind(ships_lost as i16)
    .bind(d.seas[BOT].shots() as i16)
    .bind(tactics.then_some(powers_used as i16))
    .bind(tactics.then_some(crates_opened as i16))
        .execute(&mut **tx)
        .await?;
    Ok(Finished { rewards: Some(granted), points: Some(pts), drop, stars })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FireRequest {
    /// 0–99 (row * 10 + column).
    #[serde(default)]
    pub cell: Option<usize>,
    /// A sonar ping centred on `cell` instead of a shot.
    #[serde(default)]
    pub ping: bool,
    /// Any move as a move code instead ("a12h", "o2", …; see `rules::Move`).
    #[serde(default, rename = "move")]
    pub mv: Option<String>,
}

impl FireRequest {
    pub fn to_move(&self) -> AppResult<Move> {
        if let Some(code) = &self.mv {
            return Move::parse(code).ok_or_else(|| AppError::Validation(format!("unknown move: {code}")));
        }
        let cell = self.cell.filter(|&c| c < CELLS).ok_or_else(|| AppError::Validation("that isn't a square on the grid".into()))?;
        Ok(if self.ping { Move::Ping(cell) } else { Move::Fire(cell) })
    }
}

/// Ship powers (Overdrive too) used and crates opened by `side`.
pub fn tally(d: &Duel, side: usize) -> (i64, i64) {
    let mine = || d.log.iter().filter(move |t| t.side == side);
    let powers = mine().filter(|t| t.mv.power().is_some() || matches!(t.mv, Move::Overdrive(_))).count();
    let crates = mine().flat_map(|t| &t.results).filter(|(_, r)| matches!(r, ShotResult::Crate { .. })).count();
    (powers as i64, crates as i64)
}

/// Campaign: you've used every move of the mission's limit without winning
/// (a loss). Overdrive isn't a move; powers, pings and shots are.
fn out_of_moves(limit: Option<i16>, d: &Duel) -> bool {
    d.winner().is_none() && limit.is_some_and(|l| d.seas[BOT].shots() >= usize::try_from(l).unwrap_or(0))
}

/// Zero-Bot's moves until it's your turn again (an extra shot or Overdrive
/// keeps its turn) or the game ends.
fn bot_turn(d: &mut Duel, level: Level) -> AppResult<()> {
    let mut rng = rand::thread_rng();
    for _ in 0..16 {
        if d.winner().is_some() || d.to_move() != BOT {
            return Ok(());
        }
        let m = choose_for(d, BOT, level, &mut rng);
        d.play(m).map_err(|e| AppError::Internal(anyhow::anyhow!("Zero-Bot made a bad move {}: {}", m.code(), e.text())))?;
    }
    Err(AppError::Internal(anyhow::anyhow!("Zero-Bot kept the turn too long")))
}

/// `POST /api/games/sonar/games/:id/fire`: your shot or ping, then Zero-Bot's.
pub async fn fire(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<FireRequest>,
) -> AppResult<Json<GameView>> {
    let mv = req.to_move()?;
    let mut tx = state.pool.begin().await?;
    let mut row = lock(&mut tx, id, user.user_id).await?;
    if row.status != "active" {
        return Err(AppError::Conflict("this game is over".into()));
    }
    let mut d = row.duel()?;
    if d.to_move() != YOU {
        return Err(AppError::Conflict("wait for Zero-Bot".into()));
    }
    d.play(mv).map_err(|e| AppError::Validation(e.text().into()))?;
    bot_turn(&mut d, row.level())?;
    row.moves = d.move_string();
    let out_of_moves = out_of_moves(row.mission().and_then(|o| o.move_limit), &d);
    let fin = match d.winner() {
        Some(w) => {
            let result = if w == YOU { GameResult::Win } else { GameResult::Loss };
            finish(&mut tx, user.user_id, &mut row, &d, result, false).await?
        }
        None if out_of_moves => finish(&mut tx, user.user_id, &mut row, &d, GameResult::Loss, false).await?,
        None => {
            sqlx::query("UPDATE sonar_games SET moves = $2 WHERE id = $1").bind(row.id).bind(&row.moves).execute(&mut *tx).await?;
            Finished::default()
        }
    };
    tx.commit().await?;
    Ok(Json(view(&row, &d, fin)))
}

/// `POST /api/games/sonar/games/:id/resign`
pub async fn resign(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<GameView>> {
    let mut tx = state.pool.begin().await?;
    let mut row = lock(&mut tx, id, user.user_id).await?;
    if row.status != "active" {
        return Err(AppError::Conflict("this game is over".into()));
    }
    let d = row.duel()?;
    let mut fin = finish(&mut tx, user.user_id, &mut row, &d, GameResult::Loss, true).await?;
    fin.drop = None;
    tx.commit().await?;
    Ok(Json(view(&row, &d, fin)))
}

// ---------------------------------------------------------------------------
// Fleets and seas
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
    pub fleets: Vec<ItemView>,
    pub seas: Vec<ItemView>,
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
    Ok(Collection { fleets: view(Kind::Fleet), seas: view(Kind::Sea) })
}

/// `GET /api/games/sonar/collection`
pub async fn collection(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Collection>> {
    Ok(Json(collection_of(&state, user.user_id).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuyRequest {
    pub kind: Kind,
    pub id: String,
}

/// `POST /api/games/sonar/buy`
pub async fn buy(State(state): State<AppState>, user: AuthUser, Json(req): Json<BuyRequest>) -> AppResult<Json<Collection>> {
    let it = items::items().find(req.kind, &req.id).ok_or_else(|| AppError::Validation(format!("unknown item: {}", req.id)))?;
    let price = it.price.ok_or_else(|| AppError::Validation(format!("{} is already free", it.name)))?;
    let key = items::key(req.kind, &it.id);
    let mut tx = state.pool.begin().await?;
    let inserted = sqlx::query("INSERT INTO sonar_items (user_id, item_key, source) VALUES ($1, $2, 'shop') ON CONFLICT DO NOTHING")
        .bind(user.user_id)
        .bind(&key)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict(format!("you already own {}", it.name)));
    }
    economy::spend(&mut tx, user.user_id, price, 0, &format!("sonar_shop:{key}")).await?;
    tx.commit().await?;
    Ok(Json(collection_of(&state, user.user_id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    #[test]
    fn harder_levels_pay_more_and_flawless_wins_score_more() {
        let mut r = ChaCha8Rng::seed_from_u64(1);
        let easy = reward(Level::Easy, GameResult::Win, &mut r);
        let master = reward(Level::Master, GameResult::Win, &mut r);
        assert!(master.coins > easy.coins && master.xp > easy.xp);
        assert_eq!(reward(Level::Hard, GameResult::Loss, &mut r).coins, 0);
        assert!(reward(Level::Hard, GameResult::Loss, &mut r).xp > 0);
        assert_eq!(points(Level::Master, GameResult::Win, 0), 45);
        assert_eq!(points(Level::Master, GameResult::Win, 2), 40);
        assert_eq!(points(Level::Easy, GameResult::Loss, 0), 0);
    }

    #[test]
    fn moves_come_as_cells_or_codes() {
        let req = |j: &str| serde_json::from_str::<FireRequest>(j).unwrap().to_move();
        assert_eq!(req(r#"{"cell": 37}"#).unwrap(), Move::Fire(37));
        assert_eq!(req(r#"{"cell": 44, "ping": true}"#).unwrap(), Move::Ping(44));
        assert_eq!(req(r#"{"move": "a12h"}"#).unwrap(), Move::AirStrike { cell: 12, horizontal: true });
        assert!(req(r#"{"cell": 100}"#).is_err());
        assert!(req(r#"{"move": "z9"}"#).is_err());
        assert!(req("{}").is_err());
        assert_eq!(parse_both_levels("1,1,1,1,1 3,2,1,1,1"), Some([[1; 5], [3, 2, 1, 1, 1]]));
        assert_eq!(parse_both_levels("1,1,1,1,1"), None);
    }

    #[test]
    fn a_move_limit_ends_the_mission() {
        let you = Fleet::parse("a1h a3h a5h a7h a9h").unwrap();
        let bot = Fleet::parse("a1v c1v e1v g1v i1v").unwrap();
        // You (side 0) fire 3 times at water; Zero-Bot replies at water too.
        let d = Duel::replay([&you, &bot], YOU, "f99 f99 f98 f98 f97").unwrap();
        assert!(!out_of_moves(None, &d));
        assert!(!out_of_moves(Some(4), &d));
        assert!(out_of_moves(Some(3), &d));
        // A won game is never "out of moves".
        let sink = [0, 10, 20, 30, 40, 2, 12, 22, 32, 4, 14, 24, 6, 16, 26, 8, 18];
        let water = (10..20).chain(30..37); // rows 2 and 4 of your sea: open water
        let moves: Vec<String> = sink.iter().zip(water).flat_map(|(c, w)| [format!("f{c}"), format!("f{w}")]).collect();
        let won = Duel::replay([&you, &bot], YOU, moves[..33].join(" ").as_str()).unwrap();
        assert_eq!(won.winner(), Some(YOU));
        assert!(!out_of_moves(Some(17), &won));
    }

    #[test]
    fn zero_bot_keeps_playing_while_it_has_the_turn() {
        use crate::sonar::tactics::MK1;
        // A whole Tactics game played the way `fire` plays it: always a legal
        // move for you, then Zero-Bot until it's your turn again.
        let mut rng = ChaCha8Rng::seed_from_u64(4);
        let you = random_fleet(&mut rng);
        let mut bot = random_fleet(&mut rng);
        bot.mines = bot_mines(&bot, 2, Level::Master, &mut rng);
        let mut d = Duel::new_tactics([&you, &bot], YOU, Setup::new([MK1, bot_levels(Level::Master)], 99));
        let mut turns = 0;
        while d.winner().is_none() {
            assert_eq!(d.to_move(), YOU);
            let m = choose_for(&d, YOU, Level::Hard, &mut rng);
            d.play(m).unwrap();
            bot_turn(&mut d, Level::Master).unwrap();
            turns += 1;
            assert!(turns < 200);
        }
        let again = Duel::replay_tactics([&you, &bot], YOU, Setup::new([MK1, bot_levels(Level::Master)], 99), &d.move_string()).unwrap();
        assert_eq!(again.winner(), d.winner());
        let (powers, _) = tally(&d, YOU);
        assert!(powers > 0);
    }
}
