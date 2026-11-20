//! Online play: two people on two devices play Connect Four, Tic-Tac-Toe, chess, Sonar or checkers
//! in a room joined by a 6-character code. The server keeps the moves and
//! checks every one with the same rules as the AI games; clients only send
//! the cell they want and poll for news (Vercel can't hold sockets open).
//!
//! This file is the pure part (rules, series, codes); `api` does the DB work.

pub mod api;

use rand::Rng;
use serde::Serialize;
use serde_json::{json, Value};

use crate::connect_four::board::{Board as CfBoard, Outcome, Player};
use crate::tic_tac_toe::board::Board as TttBoard;

/// Room codes avoid look-alike characters (0/O, 1/I/L).
const CODE_CHARS: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
pub const CODE_LEN: usize = 6;

pub fn new_code(rng: &mut impl Rng) -> String {
    (0..CODE_LEN).map(|_| CODE_CHARS[rng.gen_range(0..CODE_CHARS.len())] as char).collect()
}

/// Normalize what someone typed ("ab c12 3" -> "ABC123"); None if it can't be a code.
pub fn clean_code(s: &str) -> Option<String> {
    let c: String = s.chars().filter(|c| !c.is_whitespace() && *c != '-').collect::<String>().to_uppercase();
    (c.len() == CODE_LEN && c.bytes().all(|b| CODE_CHARS.contains(&b))).then_some(c)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Game {
    #[serde(rename = "connect-four")]
    ConnectFour,
    #[serde(rename = "tic-tac-toe")]
    TicTacToe,
    #[serde(rename = "chess")]
    Chess,
    #[serde(rename = "sonar")]
    Sonar,
    #[serde(rename = "checkers")]
    Checkers,
}

impl Game {
    pub fn parse(s: &str) -> Option<Game> {
        match s {
            "connect-four" => Some(Game::ConnectFour),
            "tic-tac-toe" => Some(Game::TicTacToe),
            "chess" => Some(Game::Chess),
            "sonar" => Some(Game::Sonar),
            "checkers" => Some(Game::Checkers),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Game::ConnectFour => "connect-four",
            Game::TicTacToe => "tic-tac-toe",
            Game::Chess => "chess",
            Game::Sonar => "sonar",
            Game::Checkers => "checkers",
        }
    }
}

/// One game's board after replaying its moves.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GameState {
    /// Connect Four: 7 columns of 6 (bottom up); Tic-Tac-Toe: 9 cells. 0 empty, 1 = P1, 2 = P2.
    pub cells: Value,
    pub outcome: Outcome,
    /// Winning cells (Connect Four: [col,row] pairs; Tic-Tac-Toe: 3 cell indexes).
    pub highlight: Value,
    /// Whose move it is (P1 moved first).
    pub next: Player,
}

/// Replay a move string ("3324"; chess: "e2e4 e7e5") into a board state.
/// Chess: `cells` is the FEN, `highlight` holds the move list, last move,
/// check and the legal moves; P1 = White.
pub fn replay(game: Game, moves: &str) -> Result<GameState, &'static str> {
    match game {
        // Sonar needs the secret fleets: see `sonar_state`.
        Game::Sonar => sonar_state(moves, [None, None], 1, 0, None),
        Game::Chess => {
            use crate::chess::{Outcome as C, Side};
            let g = crate::chess::Game::replay(crate::chess::START_FEN, moves).map_err(|_| "bad moves")?;
            let outcome = match g.outcome() {
                C::Ongoing => Outcome::Ongoing,
                C::Checkmate(Side::White) => Outcome::Win(Player::P1),
                C::Checkmate(Side::Black) => Outcome::Win(Player::P2),
                _ => Outcome::Draw,
            };
            let ending = match g.outcome() {
                C::Checkmate(_) => "checkmate",
                C::Stalemate => "stalemate",
                C::Repetition => "repetition",
                C::FiftyMoves => "fifty_moves",
                C::InsufficientMaterial => "insufficient_material",
                C::Ongoing => "",
            };
            Ok(GameState {
                cells: json!(g.fen()),
                outcome,
                highlight: json!({
                    "san": g.san(),
                    "last": g.moves().last(),
                    "check": g.in_check(),
                    "legal": g.legal_moves(),
                    "ending": ending,
                }),
                next: if g.to_move() == Side::White { Player::P1 } else { Player::P2 },
            })
        }
        Game::Checkers => {
            use crate::checkers::rules::{Game as Ck, Move, Outcome as O, Side};
            let g = Ck::replay(moves).map_err(|_| "bad moves")?;
            let seat = |s: Side| if s == Side::Dark { Player::P1 } else { Player::P2 };
            let outcome = match g.outcome() {
                O::Ongoing => Outcome::Ongoing,
                O::Win(s) => Outcome::Win(seat(s)),
                O::Draw => Outcome::Draw,
            };
            Ok(GameState {
                cells: json!(g.cells.to_vec()),
                outcome,
                highlight: json!({
                    "moves": g.moves.iter().map(Move::notation).collect::<Vec<_>>(),
                    "legal": g.legal_moves().iter().map(Move::notation).collect::<Vec<_>>(),
                    "ending": crate::checkers::api::ending_of(&g),
                    "quiet_left": crate::checkers::rules::QUIET_LIMIT.saturating_sub(g.quiet),
                }),
                next: seat(g.turn),
            })
        }
        Game::ConnectFour => {
            let b = CfBoard::from_move_string(moves).map_err(|_| "bad moves")?;
            Ok(GameState { cells: json!(b.cells()), outcome: b.outcome(), highlight: json!(b.winning_cells()), next: b.to_move() })
        }
        Game::TicTacToe => {
            let b = TttBoard::from_move_string(moves).map_err(|_| "bad moves")?;
            Ok(GameState { cells: json!(b.cells().to_vec()), outcome: b.outcome(), highlight: json!(b.winning_line()), next: b.to_move() })
        }
    }
}

/// A Sonar Tactics room's setup for one game (None = Classic): Mk I powers
/// for both (Workshop upgrades don't count online) and that game's seed.
pub fn sonar_setup(tactics: bool, seed: u32) -> Option<crate::sonar::tactics::Setup> {
    use crate::sonar::tactics::{Setup, MK1};
    tactics.then(|| Setup::new([MK1, MK1], seed))
}

/// Sonar fleets by seat ([host, guest]) turned into the duel's sides:
/// side 0 = the seat that fires first this game.
fn sonar_duel(moves: &str, fleets: [&str; 2], first_seat: Seat, setup: Option<crate::sonar::tactics::Setup>) -> Result<crate::sonar::rules::Duel, &'static str> {
    use crate::sonar::rules::{Duel, Fleet};
    let f = |seat: Seat| Fleet::parse(fleets[seat as usize - 1]).map_err(|e| e.text());
    let (a, b) = (f(first_seat)?, f(3 - first_seat)?);
    match setup {
        Some(s) => Duel::replay_tactics([&a, &b], 0, s, moves),
        None => Duel::replay([&a, &b], 0, moves),
    }
    .map_err(|e| e.text())
}

/// Sonar as `viewer` (seat 1 or 2; 0 = nobody) may see it. Until both fleets
/// are hidden the game is in its "placing" phase. Your own fleet is always
/// yours to see; the other fleet only once the game is over.
pub fn sonar_state(
    moves: &str,
    fleets: [Option<&str>; 2],
    first_seat: Seat,
    viewer: Seat,
    setup: Option<crate::sonar::tactics::Setup>,
) -> Result<GameState, &'static str> {
    use crate::sonar::view::{log_for, PowersView, SeaView};
    let placed = [fleets[0].is_some(), fleets[1].is_some()];
    let your_fleet = (viewer == 1 || viewer == 2).then(|| fleets[viewer as usize - 1]).flatten();
    let mode = if setup.is_some() { "tactics" } else { "classic" };
    let (Some(h), Some(g)) = (fleets[0], fleets[1]) else {
        return Ok(GameState {
            cells: json!({ "phase": "placing", "mode": mode, "placed": placed, "your_fleet": your_fleet }),
            outcome: Outcome::Ongoing,
            highlight: Value::Null,
            next: Player::P1,
        });
    };
    let d = sonar_duel(moves, [h, g], first_seat, setup)?;
    let outcome = match d.winner() {
        Some(0) => Outcome::Win(Player::P1),
        Some(_) => Outcome::Win(Player::P2),
        None => Outcome::Ongoing,
    };
    let next = if d.to_move() == 0 { Player::P1 } else { Player::P2 };
    let cells = if viewer == 1 || viewer == 2 {
        let me = if viewer == first_seat { 0 } else { 1 };
        let theirs = fleets[2 - viewer as usize];
        json!({
            "phase": "firing",
            "mode": mode,
            "placed": placed,
            "your_fleet": your_fleet,
            "your_sea": SeaView::of(&d.seas[me]),
            "target": SeaView::of(&d.seas[1 - me]),
            "log": log_for(&d, me),
            "their_fleet": d.winner().map(|_| theirs),
            "powers": PowersView::of(&d, me),
            "their_powers": PowersView::of(&d, 1 - me),
        })
    } else {
        json!({ "phase": "firing", "mode": mode, "placed": placed })
    };
    Ok(GameState { cells, outcome, highlight: Value::Null, next })
}

/// A Sonar shot (or ping) at `cell`.
pub fn sonar_shot(cell: u8, ping: bool) -> Result<crate::sonar::rules::Move, &'static str> {
    use crate::sonar::rules::{Move, CELLS};
    if usize::from(cell) >= CELLS {
        return Err("that isn't a square on the grid");
    }
    Ok(if ping { Move::Ping(cell.into()) } else { Move::Fire(cell.into()) })
}

/// Play a Sonar move (a shot, a ping, or in Tactics a power); returns the
/// new move string.
pub fn play_sonar(
    moves: &str,
    fleets: [&str; 2],
    first_seat: Seat,
    setup: Option<crate::sonar::tactics::Setup>,
    m: crate::sonar::rules::Move,
) -> Result<String, &'static str> {
    let mut d = sonar_duel(moves, fleets, first_seat, setup)?;
    d.play(m).map_err(|e| e.text())?;
    Ok(d.move_string())
}

/// Play a chess move (UCI) after `moves`; returns the new move string.
/// Checkers: play a move in notation ("11-15", "22x15x8"); dark (P1) starts.
pub fn play_checkers(moves: &str, mv: &str) -> Result<String, &'static str> {
    let mut g = crate::checkers::rules::Game::replay(moves).map_err(|_| "bad moves")?;
    if g.outcome() != crate::checkers::rules::Outcome::Ongoing {
        return Err("the game is already over");
    }
    g.play_str(mv)?;
    Ok(g.move_string())
}

pub fn play_uci(moves: &str, uci: &str) -> Result<String, &'static str> {
    let mut g = crate::chess::Game::replay(crate::chess::START_FEN, moves).map_err(|_| "bad moves")?;
    g.play(uci).map_err(|e| e.text())?;
    Ok(g.move_string())
}

/// Play `cell` (a column or a square) after `moves`; returns the new move string.
pub fn play(game: Game, moves: &str, cell: u8) -> Result<String, &'static str> {
    match game {
        Game::Chess => Err("send a chess move as uci"),
        Game::Checkers => Err("send a checkers move as uci, e.g. 11-15"),
        Game::Sonar => Err("hide your fleet first"),
        Game::ConnectFour => {
            let mut b = CfBoard::from_move_string(moves).map_err(|_| "bad moves")?;
            b.play(cell).map_err(|e| match e {
                crate::connect_four::board::MoveError::ColumnFull => "that column is full",
                crate::connect_four::board::MoveError::GameOver => "the game is already over",
                _ => "pick a column from 1 to 7",
            })?;
            Ok(b.move_string())
        }
        Game::TicTacToe => {
            let mut b = TttBoard::from_move_string(moves).map_err(|_| "bad moves")?;
            b.play(cell).map_err(|e| match e {
                crate::connect_four::board::MoveError::GameOver => "the game is already over",
                crate::connect_four::board::MoveError::ColumnFull => "that square is taken",
                _ => "pick a square from 1 to 9",
            })?;
            Ok(b.move_string())
        }
    }
}

/// Seat 1 = the room's host, seat 2 = the friend who joined.
pub type Seat = u8;

/// The seat that plays as P1 (moves first) in a game.
pub fn seat_of(player: Player, first: Seat) -> Seat {
    match player {
        Player::P1 => first,
        Player::P2 => 3 - first,
    }
}

/// A best-of series between the two seats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Series {
    pub best_of: u8,
    /// Wins of seat 1 and seat 2.
    pub wins: [u8; 2],
    pub draws: u8,
}

impl Series {
    pub fn new(best_of: u8) -> Series {
        Series { best_of, wins: [0, 0], draws: 0 }
    }

    pub fn games_played(&self) -> u8 {
        self.wins[0] + self.wins[1] + self.draws
    }

    /// Count a finished game. `first` = the seat that moved first.
    pub fn record(&mut self, outcome: Outcome, first: Seat) {
        match outcome {
            Outcome::Win(p) => self.wins[usize::from(seat_of(p, first) - 1)] += 1,
            Outcome::Draw => self.draws += 1,
            Outcome::Ongoing => {}
        }
    }

    /// The series result once decided: Some(seat) for a winner, Some(0) for a draw.
    pub fn winner(&self) -> Option<u8> {
        let need = self.best_of / 2 + 1;
        if self.wins[0] >= need {
            return Some(1);
        }
        if self.wins[1] >= need {
            return Some(2);
        }
        if self.games_played() >= self.best_of {
            return Some(match self.wins[0].cmp(&self.wins[1]) {
                std::cmp::Ordering::Greater => 1,
                std::cmp::Ordering::Less => 2,
                std::cmp::Ordering::Equal => 0,
            });
        }
        None
    }
}

/// XP for an online series: win 30, draw 15, loss 10 (no coins, so two
/// accounts can't farm each other).
pub fn series_xp(result_for_me: Option<u8>, my_seat: Seat) -> i64 {
    match result_for_me {
        Some(0) => 15,
        Some(s) if s == my_seat => 30,
        Some(_) => 10,
        None => 0,
    }
}

pub const EMOTES: [&str; 5] = ["wave", "happy", "wow", "sad", "fire"];

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    #[test]
    fn codes_are_six_safe_characters() {
        let mut r = ChaCha8Rng::seed_from_u64(1);
        for _ in 0..200 {
            let c = new_code(&mut r);
            assert_eq!(clean_code(&c).as_deref(), Some(c.as_str()));
            assert!(!c.contains('O') && !c.contains('0') && !c.contains('I') && !c.contains('1'));
        }
        assert_eq!(clean_code(" ab-c2 34 ").as_deref(), Some("ABC234"));
        assert_eq!(clean_code("ABC10O"), None);
        assert_eq!(clean_code("ABC"), None);
    }

    #[test]
    fn connect_four_moves_are_checked() {
        let mut m = String::new();
        for c in [3u8, 3, 4, 4, 5, 5] {
            m = play(Game::ConnectFour, &m, c).unwrap();
        }
        assert_eq!(replay(Game::ConnectFour, &m).unwrap().outcome, Outcome::Ongoing);
        m = play(Game::ConnectFour, &m, 6).unwrap(); // P1 makes four in a row
        let s = replay(Game::ConnectFour, &m).unwrap();
        assert_eq!(s.outcome, Outcome::Win(Player::P1));
        assert_eq!(play(Game::ConnectFour, &m, 0), Err("the game is already over"));
        assert_eq!(play(Game::ConnectFour, "", 9), Err("pick a column from 1 to 7"));
    }

    #[test]
    fn tic_tac_toe_moves_are_checked() {
        let mut m = String::new();
        for c in [0u8, 3, 1, 4] {
            m = play(Game::TicTacToe, &m, c).unwrap();
        }
        assert_eq!(play(Game::TicTacToe, &m, 0), Err("that square is taken"));
        m = play(Game::TicTacToe, &m, 2).unwrap();
        let s = replay(Game::TicTacToe, &m).unwrap();
        assert_eq!(s.outcome, Outcome::Win(Player::P1));
        assert_eq!(s.highlight, json!([0, 1, 2]));
    }

    #[test]
    fn sonar_hides_the_other_fleet_until_the_end() {
        let host = "a1h a3h a5h a7h a9h";
        let guest = "a1v c1v e1v g1v i1v";
        let s = sonar_state("", [Some(host), None], 1, 2, None).unwrap();
        assert_eq!(s.cells["phase"], "placing");
        assert_eq!(s.cells["your_fleet"], Value::Null, "the guest hasn't placed yet");
        assert!(!s.cells.to_string().contains(host), "the host's fleet never reaches the guest");
        // Host fires first at the guest's destroyer (i1, i2 = cells 8, 18).
        let mut m = String::new();
        for (cell, ping) in [(8, false), (55, true), (18, false)] {
            m = play_sonar(&m, [host, guest], 1, None, sonar_shot(cell, ping).unwrap()).unwrap();
        }
        let for_guest = sonar_state(&m, [Some(host), Some(guest)], 1, 2, None).unwrap();
        assert!(!for_guest.cells.to_string().contains(host));
        assert_eq!(for_guest.cells["target"]["sunk"].as_array().unwrap().len(), 0);
        assert_eq!(for_guest.cells["your_sea"]["sunk"][0]["ship"], 4);
        assert_eq!(for_guest.next, Player::P2, "the guest's turn");
        assert_eq!(sonar_shot(100, false).err(), Some("that isn't a square on the grid"));
        // Sink everything of the guest's: the host wins and the fleets show.
        let targets = [0, 10, 20, 30, 40, 2, 12, 22, 32, 4, 14, 24, 6, 16, 26];
        let mut spare = (60..100).filter(|c| c % 10 > 1);
        for t in targets {
            // The guest fires somewhere, then the host fires at the guest's fleet.
            m = play_sonar(&m, [host, guest], 1, None, sonar_shot(spare.next().unwrap(), false).unwrap()).unwrap();
            m = play_sonar(&m, [host, guest], 1, None, sonar_shot(t, false).unwrap()).unwrap();
        }
        let end = sonar_state(&m, [Some(host), Some(guest)], 1, 2, None).unwrap();
        assert_eq!(end.outcome, Outcome::Win(Player::P1));
        assert_eq!(end.cells["their_fleet"], host);
    }

    #[test]
    fn sonar_tactics_rooms_share_powers_and_keep_mines_secret() {
        use crate::sonar::rules::Move;
        let host = "a1h a3h a5h a7h a9h mh2 mh4";
        let guest = "a1v c1v e1v g1v i1v ma8 mj9";
        let setup = sonar_setup(true, 5);
        let placing = sonar_state("", [Some(host), None], 1, 2, setup).unwrap();
        assert_eq!(placing.cells["mode"], "tactics");
        // The host (first) fires; powers are public, the other side's mines aren't.
        let m = play_sonar("", [host, guest], 1, setup, Move::Fire(0)).unwrap();
        let s = sonar_state(&m, [Some(host), Some(guest)], 1, 2, setup).unwrap();
        assert_eq!(s.cells["mode"], "tactics");
        assert_eq!(s.cells["powers"]["charge"], json!([3, 2, 2, 2, 2]));
        assert_eq!(s.cells["their_powers"]["charge"], json!([4, 3, 3, 3, 3]));
        assert!(!s.cells.to_string().contains("mh2"), "the host's mines never reach the guest");
        // A Classic room refuses powers.
        assert_eq!(play_sonar("", [host, guest], 1, None, Move::Flare(55)).err(), Some("ship powers are only in Tactics games"));
        // Same moves, same seed: the same game.
        let again = sonar_state(&m, [Some(host), Some(guest)], 1, 2, sonar_setup(true, 5)).unwrap();
        assert_eq!(again.cells, s.cells);
    }

    #[test]
    fn chess_moves_are_checked() {
        let mut m = String::new();
        for mv in ["f2f3", "e7e5", "g2g4"] {
            m = play_uci(&m, mv).unwrap();
        }
        assert_eq!(play_uci(&m, "e8e6").err(), Some("that move isn't allowed here"));
        m = play_uci(&m, "d8h4").unwrap();
        let s = replay(Game::Chess, &m).unwrap();
        assert_eq!(s.outcome, Outcome::Win(Player::P2), "black mated white");
        assert_eq!(s.highlight["ending"], "checkmate");
        assert_eq!(s.highlight["san"][3], "Qh4#");
        assert_eq!(play(Game::Chess, &m, 3).err(), Some("send a chess move as uci"));
        assert_eq!(Game::parse("chess"), Some(Game::Chess));
    }

    #[test]
    fn series_counts_wins_by_seat_and_ends() {
        let mut s = Series::new(3);
        // Game 1: seat 1 moves first and wins.
        s.record(Outcome::Win(Player::P1), 1);
        // Game 2: seat 2 moves first; P1 (seat 2) wins.
        s.record(Outcome::Win(Player::P1), 2);
        assert_eq!(s.wins, [1, 1]);
        assert_eq!(s.winner(), None);
        s.record(Outcome::Draw, 1);
        assert_eq!(s.winner(), Some(0), "3 games played, 1-1: a drawn series");
        let mut b = Series::new(3);
        b.record(Outcome::Win(Player::P2), 1);
        b.record(Outcome::Win(Player::P1), 2);
        assert_eq!(b.winner(), Some(2), "2 wins of 3 decide it early");
        assert_eq!(Series::new(1).winner(), None);
    }

    #[test]
    fn xp_never_pays_coins_and_rewards_the_winner_most() {
        assert_eq!(series_xp(Some(1), 1), 30);
        assert_eq!(series_xp(Some(1), 2), 10);
        assert_eq!(series_xp(Some(0), 2), 15);
        assert_eq!(series_xp(None, 1), 0);
    }
}
