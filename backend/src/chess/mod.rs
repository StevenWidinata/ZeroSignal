//! Chess rules for the server, on top of the `cozy-chess` library (legal
//! moves, castling, en passant, promotion, check, checkmate, stalemate and
//! the 50-move rule). This adds what a game needs around it: the move list,
//! threefold repetition, insufficient material, and standard UCI moves
//! ("e2e4", "e7e8q", castling as "e1g1").

pub mod ai;
pub mod api;
pub mod puzzles;

use cozy_chess::util::{display_san_move, display_uci_move, parse_uci_move};
use cozy_chess::{Board, Color, GameStatus, Move, Piece};
use serde::Serialize;

/// How a game ended (or that it hasn't).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "winner")]
pub enum Outcome {
    Ongoing,
    /// The side that delivered mate.
    Checkmate(Side),
    Stalemate,
    Repetition,
    FiftyMoves,
    InsufficientMaterial,
}

impl Outcome {
    pub fn is_over(self) -> bool {
        self != Outcome::Ongoing
    }
    pub fn is_draw(self) -> bool {
        self.is_over() && !matches!(self, Outcome::Checkmate(_))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    White,
    Black,
}

impl Side {
    pub fn of(c: Color) -> Side {
        match c {
            Color::White => Side::White,
            Color::Black => Side::Black,
        }
    }
    pub fn other(self) -> Side {
        match self {
            Side::White => Side::Black,
            Side::Black => Side::White,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChessError {
    BadMove,
    IllegalMove,
    GameOver,
    BadPosition,
}

impl ChessError {
    pub fn text(self) -> &'static str {
        match self {
            ChessError::BadMove => "that isn't a move (use e.g. e2e4)",
            ChessError::IllegalMove => "that move isn't allowed here",
            ChessError::GameOver => "the game is already over",
            ChessError::BadPosition => "bad position",
        }
    }
}

/// A game in progress: the board plus everything needed for draw rules.
#[derive(Debug, Clone)]
pub struct Game {
    start_fen: String,
    board: Board,
    /// Position hashes after every move (for threefold repetition).
    history: Vec<u64>,
    /// Moves so far in UCI ("e2e4").
    moves: Vec<String>,
    /// The same moves in SAN ("e4"), for the move list.
    san: Vec<String>,
}

pub const START_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

impl Game {
    pub fn new() -> Game {
        Game::from_fen(START_FEN).expect("start position")
    }

    pub fn from_fen(fen: &str) -> Result<Game, ChessError> {
        let board = Board::from_fen(fen, false).map_err(|_| ChessError::BadPosition)?;
        Ok(Game { start_fen: fen.to_string(), history: vec![board.hash()], board, moves: Vec::new(), san: Vec::new() })
    }

    /// Replay a space-separated UCI move list from a start position.
    pub fn replay(start_fen: &str, moves: &str) -> Result<Game, ChessError> {
        let mut g = Game::from_fen(start_fen)?;
        for m in moves.split_whitespace() {
            g.play(m)?;
        }
        Ok(g)
    }

    pub fn board(&self) -> &Board {
        &self.board
    }

    pub fn start_fen(&self) -> &str {
        &self.start_fen
    }

    pub fn fen(&self) -> String {
        format!("{}", self.board)
    }

    pub fn moves(&self) -> &[String] {
        &self.moves
    }

    pub fn move_string(&self) -> String {
        self.moves.join(" ")
    }

    pub fn san(&self) -> &[String] {
        &self.san
    }

    pub fn to_move(&self) -> Side {
        Side::of(self.board.side_to_move())
    }

    pub fn in_check(&self) -> bool {
        !self.board.checkers().is_empty()
    }

    /// Every legal move in UCI.
    pub fn legal_moves(&self) -> Vec<String> {
        let mut out = Vec::new();
        if self.outcome().is_over() {
            return out;
        }
        self.board.generate_moves(|pm| {
            for mv in pm {
                out.push(display_uci_move(&self.board, mv).to_string());
            }
            false
        });
        out
    }

    /// Parse a UCI move and check it's legal here.
    pub fn parse(&self, uci: &str) -> Result<Move, ChessError> {
        let mv = parse_uci_move(&self.board, uci.trim()).map_err(|_| ChessError::BadMove)?;
        if !self.board.is_legal(mv) {
            return Err(ChessError::IllegalMove);
        }
        Ok(mv)
    }

    /// Play a UCI move ("e2e4", "e7e8q", castling "e1g1").
    pub fn play(&mut self, uci: &str) -> Result<(), ChessError> {
        if self.outcome().is_over() {
            return Err(ChessError::GameOver);
        }
        let mv = self.parse(uci)?;
        self.play_move(mv);
        Ok(())
    }

    /// Play an already-legal move (used by the AI and puzzles).
    pub fn play_move(&mut self, mv: Move) {
        let uci = display_uci_move(&self.board, mv).to_string();
        let san = display_san_move(&self.board, mv).to_string();
        self.board.play_unchecked(mv);
        self.history.push(self.board.hash());
        self.moves.push(uci);
        self.san.push(san);
    }

    /// Undo the last move (replays from the start; games are short).
    pub fn undo(&mut self) -> Option<String> {
        let last = self.moves.pop()?;
        let rest = self.moves.join(" ");
        *self = Game::replay(&self.start_fen, &rest).expect("replaying our own moves");
        Some(last)
    }

    pub fn outcome(&self) -> Outcome {
        match self.board.status() {
            GameStatus::Won => return Outcome::Checkmate(Side::of(!self.board.side_to_move())),
            GameStatus::Drawn if !self.board.checkers().is_empty() || self.board.halfmove_clock() >= 100 => {
                return Outcome::FiftyMoves
            }
            GameStatus::Drawn => return Outcome::Stalemate,
            GameStatus::Ongoing => {}
        }
        let now = self.board.hash();
        if self.history.iter().filter(|&&h| h == now).count() >= 3 {
            return Outcome::Repetition;
        }
        if insufficient_material(&self.board) {
            return Outcome::InsufficientMaterial;
        }
        Outcome::Ongoing
    }
}

impl Default for Game {
    fn default() -> Self {
        Game::new()
    }
}

/// Neither side can ever mate: K v K, K+minor v K, or K+B v K+B with the
/// bishops on the same colour.
pub fn insufficient_material(b: &Board) -> bool {
    let heavy = b.pieces(Piece::Pawn) | b.pieces(Piece::Rook) | b.pieces(Piece::Queen);
    if !heavy.is_empty() {
        return false;
    }
    let minors = b.pieces(Piece::Knight) | b.pieces(Piece::Bishop);
    match minors.len() {
        0 | 1 => true,
        2 => {
            let bishops = b.pieces(Piece::Bishop);
            if bishops.len() != 2 || b.colors(Color::White).len() != 2 {
                return false;
            }
            // One bishop each, on the same square colour.
            let light = cozy_chess::BitBoard::LIGHT_SQUARES;
            (bishops & light).len() != 1
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perft(b: &Board, depth: u8) -> u64 {
        if depth == 0 {
            return 1;
        }
        let mut n = 0;
        b.generate_moves(|pm| {
            for mv in pm {
                let mut c = b.clone();
                c.play_unchecked(mv);
                n += perft(&c, depth - 1);
            }
            false
        });
        n
    }

    #[test]
    fn perft_matches_known_counts() {
        // Standard reference numbers (chessprogramming.org "Perft Results").
        let start = Board::default();
        assert_eq!(perft(&start, 3), 8_902);
        let kiwipete = Board::from_fen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", false).unwrap();
        assert_eq!(perft(&kiwipete, 2), 2_039);
        let pos3 = Board::from_fen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", false).unwrap();
        assert_eq!(perft(&pos3, 3), 2_812);
    }

    #[test]
    fn uci_moves_castling_and_promotion() {
        let mut g = Game::new();
        for m in ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"] {
            g.play(m).unwrap();
        }
        assert!(g.legal_moves().contains(&"e1g1".to_string()), "castling is e1g1 in UCI");
        g.play("e1g1").unwrap();
        assert_eq!(g.san().last().unwrap(), "O-O");
        assert_eq!(g.play("e1g1"), Err(ChessError::IllegalMove));
        assert_eq!(g.play("zz"), Err(ChessError::BadMove));
        let mut p = Game::from_fen("8/4P3/8/8/8/8/k7/4K3 w - - 0 1").unwrap();
        p.play("e7e8q").unwrap();
        assert_eq!(p.san().last().unwrap(), "e8=Q");
    }

    #[test]
    fn fools_mate_and_undo() {
        let mut g = Game::replay(START_FEN, "f2f3 e7e5 g2g4").unwrap();
        g.play("d8h4").unwrap();
        assert_eq!(g.outcome(), Outcome::Checkmate(Side::Black));
        assert_eq!(g.play("a2a3"), Err(ChessError::GameOver));
        assert!(g.legal_moves().is_empty());
        assert_eq!(g.undo().as_deref(), Some("d8h4"));
        assert_eq!(g.outcome(), Outcome::Ongoing);
        assert_eq!(g.move_string(), "f2f3 e7e5 g2g4");
    }

    #[test]
    fn draw_rules() {
        let stale = Game::from_fen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").unwrap();
        assert_eq!(stale.outcome(), Outcome::Stalemate);
        let mut rep = Game::new();
        for m in ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"] {
            rep.play(m).unwrap();
        }
        assert_eq!(rep.outcome(), Outcome::Repetition);
        assert!(insufficient_material(Game::from_fen("8/8/8/4k3/8/8/8/4KB2 w - - 0 1").unwrap().board()));
        assert!(!insufficient_material(Game::from_fen("8/8/8/4k3/8/8/8/4KR2 w - - 0 1").unwrap().board()));
        let fifty = Game::from_fen("8/8/8/4k3/8/8/8/R3K3 w - - 100 80").unwrap();
        assert_eq!(fifty.outcome(), Outcome::FiftyMoves);
        assert!(Outcome::Stalemate.is_draw() && !Outcome::Checkmate(Side::White).is_draw());
    }
}
