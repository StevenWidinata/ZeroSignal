//! Checkers rules (English draughts, 8×8). Dark moves first from the top
//! (squares 1–12) towards the bottom; Light starts on 21–32.
//!
//! - Men move one step diagonally forward; kings one step in any diagonal.
//! - Captures are forced. A capture is a jump over an enemy piece onto an
//!   empty square; the same piece keeps jumping while it can (any sequence
//!   may be chosen, not necessarily the longest). Men only capture forward.
//! - A man that reaches the far row is crowned, and that ends the move.
//! - You lose when you have no legal move (no pieces or all blocked).
//! - Draw after 80 plies in a row without a capture or a man moving, or when
//!   the same position (and side to move) comes up a third time.
//!
//! The browser has a line-for-line copy in `frontend/src/games/checkers/
//! rules.ts`; both are checked against `shared/checkers_vectors.json`.
//! Change both files together.

use serde::{Deserialize, Serialize};

pub const SQUARES: usize = 32;
/// 0 empty, 1 dark man, 2 dark king, -1 light man, -2 light king.
pub type Cells = [i8; SQUARES];
/// Plies without a capture or a man move before the game is a draw.
pub const QUIET_LIMIT: u32 = 80;
/// Diagonal directions (row, col), always in this order.
const DIRS: [(i32, i32); 4] = [(-1, -1), (-1, 1), (1, -1), (1, 1)];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Dark,
    Light,
}

impl Side {
    pub fn other(self) -> Side {
        match self {
            Side::Dark => Side::Light,
            Side::Light => Side::Dark,
        }
    }

    /// +1 for Dark pieces, -1 for Light pieces (also the forward row step).
    pub fn sign(self) -> i8 {
        match self {
            Side::Dark => 1,
            Side::Light => -1,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Side::Dark => "dark",
            Side::Light => "light",
        }
    }

    pub fn parse(s: &str) -> Option<Side> {
        match s {
            "dark" => Some(Side::Dark),
            "light" => Some(Side::Light),
            _ => None,
        }
    }
}

/// Row and column (0..8) of a playable square (0..32).
pub fn rc(sq: usize) -> (i32, i32) {
    let r = (sq / 4) as i32;
    let c = ((sq % 4) * 2) as i32 + if r % 2 == 0 { 1 } else { 0 };
    (r, c)
}

/// The playable square at (row, col), if it is one.
pub fn sq_at(r: i32, c: i32) -> Option<usize> {
    if !(0..8).contains(&r) || !(0..8).contains(&c) || (r + c) % 2 == 0 {
        return None;
    }
    Some((r * 4 + c / 2) as usize)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Move {
    /// Squares visited, start first (0-based).
    pub path: Vec<u8>,
    /// Squares of the pieces taken (0-based).
    pub captures: Vec<u8>,
}

impl Move {
    /// Standard notation with squares 1–32: "9-13" or "9x18x27".
    pub fn notation(&self) -> String {
        let sep = if self.captures.is_empty() { "-" } else { "x" };
        self.path.iter().map(|s| (s + 1).to_string()).collect::<Vec<_>>().join(sep)
    }
}

/// "9x18x27" → [8, 17, 26]. None if it isn't a list of squares 1–32.
pub fn parse_path(s: &str) -> Option<Vec<u8>> {
    let parts: Vec<&str> = s.split(['-', 'x']).collect();
    if parts.len() < 2 {
        return None;
    }
    let mut out = Vec::with_capacity(parts.len());
    for p in parts {
        let n: u8 = p.parse().ok()?;
        if !(1..=32).contains(&n) {
            return None;
        }
        out.push(n - 1);
    }
    Some(out)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Ongoing,
    Win(Side),
    Draw,
}

#[derive(Debug, Clone)]
pub struct Game {
    pub cells: Cells,
    pub turn: Side,
    /// Plies since the last capture or man move.
    pub quiet: u32,
    /// Every position so far (for repetition), current one last.
    history: Vec<(Cells, Side)>,
    pub moves: Vec<Move>,
}

impl Default for Game {
    fn default() -> Self {
        Game::new()
    }
}

impl Game {
    pub fn new() -> Game {
        let mut cells = [0i8; SQUARES];
        for (i, c) in cells.iter_mut().enumerate() {
            if i < 12 {
                *c = 1;
            } else if i >= 20 {
                *c = -1;
            }
        }
        Game::from_position(cells, Side::Dark)
    }

    pub fn from_position(cells: Cells, turn: Side) -> Game {
        Game { cells, turn, quiet: 0, history: vec![(cells, turn)], moves: Vec::new() }
    }

    /// Every legal move for the side to move (only captures if any exist).
    pub fn legal_moves(&self) -> Vec<Move> {
        let s = self.turn.sign();
        let mut jumps = Vec::new();
        for sq in 0..SQUARES {
            let piece = self.cells[sq];
            if piece * s > 0 {
                let mut board = self.cells;
                board[sq] = 0;
                let mut path = vec![sq as u8];
                let mut caps = Vec::new();
                jump_from(&board, sq, piece, &mut path, &mut caps, &mut jumps);
            }
        }
        if !jumps.is_empty() {
            return jumps;
        }
        let mut out = Vec::new();
        for sq in 0..SQUARES {
            let piece = self.cells[sq];
            if piece * s <= 0 {
                continue;
            }
            let (r, c) = rc(sq);
            for (dr, dc) in DIRS {
                if !can_go(piece, dr) {
                    continue;
                }
                if let Some(t) = sq_at(r + dr, c + dc) {
                    if self.cells[t] == 0 {
                        out.push(Move { path: vec![sq as u8, t as u8], captures: Vec::new() });
                    }
                }
            }
        }
        out
    }

    /// Plays a move that `legal_moves` returned (not checked).
    pub fn apply(&mut self, m: &Move) {
        let from = m.path[0] as usize;
        let to = *m.path.last().expect("a move has 2+ squares") as usize;
        let mut piece = self.cells[from];
        self.cells[from] = 0;
        for &c in &m.captures {
            self.cells[c as usize] = 0;
        }
        let man = piece.abs() == 1;
        if man && rc(to).0 == king_row(piece) {
            piece *= 2;
        }
        self.cells[to] = piece;
        self.quiet = if !m.captures.is_empty() || man { 0 } else { self.quiet + 1 };
        self.turn = self.turn.other();
        self.history.push((self.cells, self.turn));
        self.moves.push(m.clone());
    }

    /// Plays a move given as squares (0-based path); must be legal.
    pub fn play_path(&mut self, path: &[u8]) -> Result<Move, &'static str> {
        let m = self
            .legal_moves()
            .into_iter()
            .find(|m| m.path == path)
            .ok_or("illegal move")?;
        self.apply(&m);
        Ok(m)
    }

    /// Plays a move in notation ("11-15", "22x15x8").
    pub fn play_str(&mut self, s: &str) -> Result<Move, &'static str> {
        let path = parse_path(s).ok_or("bad move")?;
        self.play_path(&path)
    }

    pub fn outcome(&self) -> Outcome {
        if self.legal_moves().is_empty() {
            return Outcome::Win(self.turn.other());
        }
        if self.quiet >= QUIET_LIMIT {
            return Outcome::Draw;
        }
        let now = self.history.last().expect("history is never empty");
        if self.history.iter().filter(|h| *h == now).count() >= 3 {
            return Outcome::Draw;
        }
        Outcome::Ongoing
    }

    /// The game's moves, space separated (what the server stores).
    pub fn move_string(&self) -> String {
        self.moves.iter().map(Move::notation).collect::<Vec<_>>().join(" ")
    }

    /// Replays a stored move string from the start.
    pub fn replay(moves: &str) -> Result<Game, &'static str> {
        let mut g = Game::new();
        for m in moves.split_whitespace() {
            if g.outcome() != Outcome::Ongoing {
                return Err("move after the game ended");
            }
            g.play_str(m)?;
        }
        Ok(g)
    }

    /// Replays moves from a given position (puzzles start mid-game).
    pub fn replay_from(cells: Cells, turn: Side, moves: &str) -> Result<Game, &'static str> {
        let mut g = Game::from_position(cells, turn);
        for m in moves.split_whitespace() {
            if g.outcome() != Outcome::Ongoing {
                return Err("move after the game ended");
            }
            g.play_str(m)?;
        }
        Ok(g)
    }

    /// Pieces left: (men, kings) of a side.
    pub fn count(&self, side: Side) -> (u32, u32) {
        let s = side.sign();
        let mut men = 0;
        let mut kings = 0;
        for &c in &self.cells {
            if c * s == 1 {
                men += 1;
            } else if c * s == 2 {
                kings += 1;
            }
        }
        (men, kings)
    }
}

/// Men move (and capture) forward only: Dark down (+1 row), Light up.
fn can_go(piece: i8, dr: i32) -> bool {
    piece.abs() == 2 || dr == i32::from(piece.signum())
}

/// The row where a man of this colour is crowned.
fn king_row(piece: i8) -> i32 {
    if piece > 0 {
        7
    } else {
        0
    }
}

/// Depth-first search of every capture chain from `sq` (the moving piece is
/// already lifted off `board`; taken pieces stay until the move ends).
fn jump_from(board: &Cells, sq: usize, piece: i8, path: &mut Vec<u8>, caps: &mut Vec<u8>, out: &mut Vec<Move>) {
    let (r, c) = rc(sq);
    let mut found = false;
    for (dr, dc) in DIRS {
        if !can_go(piece, dr) {
            continue;
        }
        let (Some(mid), Some(land)) = (sq_at(r + dr, c + dc), sq_at(r + 2 * dr, c + 2 * dc)) else {
            continue;
        };
        if board[mid] * piece >= 0 || caps.contains(&(mid as u8)) || board[land] != 0 {
            continue;
        }
        found = true;
        path.push(land as u8);
        caps.push(mid as u8);
        if piece.abs() == 1 && rc(land).0 == king_row(piece) {
            // Crowned: the move ends here.
            out.push(Move { path: path.clone(), captures: caps.clone() });
        } else {
            jump_from(board, land, piece, path, caps, out);
        }
        path.pop();
        caps.pop();
    }
    if !found && path.len() > 1 {
        out.push(Move { path: path.clone(), captures: caps.clone() });
    }
}

/// Counts leaf positions `depth` plies ahead (for testing the rules).
pub fn perft(g: &Game, depth: u32) -> u64 {
    if depth == 0 {
        return 1;
    }
    let moves = g.legal_moves();
    if depth == 1 {
        return moves.len() as u64;
    }
    moves
        .iter()
        .map(|m| {
            let mut next = g.clone();
            next.apply(m);
            perft(&next, depth - 1)
        })
        .sum()
}

/// A position as text: 32 chars (b B dark man/king, w W light, . empty) +
/// " d" or " l" for the side to move. Used by tests and puzzles.
pub fn encode(cells: &Cells, turn: Side) -> String {
    let mut s: String = cells
        .iter()
        .map(|&c| match c {
            1 => 'b',
            2 => 'B',
            -1 => 'w',
            -2 => 'W',
            _ => '.',
        })
        .collect();
    s.push(' ');
    s.push(if turn == Side::Dark { 'd' } else { 'l' });
    s
}

pub fn decode(s: &str) -> Option<(Cells, Side)> {
    let (board, side) = s.split_once(' ')?;
    let chars: Vec<char> = board.chars().collect();
    if chars.len() != SQUARES {
        return None;
    }
    let mut cells = [0i8; SQUARES];
    for (i, ch) in chars.into_iter().enumerate() {
        cells[i] = match ch {
            'b' => 1,
            'B' => 2,
            'w' => -1,
            'W' => -2,
            '.' => 0,
            _ => return None,
        };
    }
    let turn = match side {
        "d" => Side::Dark,
        "l" => Side::Light,
        _ => return None,
    };
    Some((cells, turn))
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use rand::{Rng, SeedableRng};
    use rand_chacha::ChaCha8Rng;

    #[test]
    fn squares_map_both_ways() {
        for sq in 0..SQUARES {
            let (r, c) = rc(sq);
            assert_eq!(sq_at(r, c), Some(sq));
        }
        assert_eq!(rc(0), (0, 1));
        assert_eq!(rc(4), (1, 0));
        assert_eq!(sq_at(0, 0), None);
    }

    /// Published English draughts perft numbers from the start.
    #[test]
    fn perft_matches_the_known_numbers() {
        let g = Game::new();
        let want = [7u64, 49, 302, 1469, 7361, 36768];
        for (d, n) in want.iter().enumerate() {
            assert_eq!(perft(&g, d as u32 + 1), *n, "depth {}", d + 1);
        }
    }

    #[test]
    fn captures_are_forced_and_chain() {
        // Dark man on 10 (0-based 9), light men on 14 and 22: a double jump.
        let mut cells = [0i8; SQUARES];
        cells[9] = 1;
        cells[13] = -1;
        cells[21] = -1;
        cells[31] = -1;
        let g = Game::from_position(cells, Side::Dark);
        let moves = g.legal_moves();
        assert!(moves.iter().all(|m| !m.captures.is_empty()));
        assert!(moves.iter().any(|m| m.captures.len() == 2), "{:?}", moves.iter().map(Move::notation).collect::<Vec<_>>());
    }

    #[test]
    fn crowning_ends_the_jump() {
        // Dark man two rows from the end jumps onto the last row; a further
        // jump would be possible for a king but the move must stop.
        let mut cells = [0i8; SQUARES];
        let man = sq_at(5, 2).unwrap();
        let mid = sq_at(6, 3).unwrap();
        let land = sq_at(7, 4).unwrap();
        cells[man] = 1;
        cells[mid] = -1;
        cells[sq_at(6, 5).unwrap()] = -1; // would be jumpable by a king from land
        let mut g = Game::from_position(cells, Side::Dark);
        let moves = g.legal_moves();
        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].path, vec![man as u8, land as u8]);
        g.apply(&moves[0].clone());
        assert_eq!(g.cells[land], 2);
    }

    #[test]
    fn no_moves_loses_and_quiet_moves_draw() {
        let mut cells = [0i8; SQUARES];
        cells[0] = -2; // a light king alone, dark has nothing
        let g = Game::from_position(cells, Side::Dark);
        assert_eq!(g.outcome(), Outcome::Win(Side::Light));

        // Two kings far apart walking back and forth: the third repeat draws.
        let mut cells = [0i8; SQUARES];
        cells[0] = 2;
        cells[31] = -2;
        let mut g = Game::from_position(cells, Side::Dark);
        for m in ["1-5", "32-28", "5-1", "28-32", "1-5", "32-28", "5-1"] {
            assert_eq!(g.outcome(), Outcome::Ongoing, "before {m}");
            g.play_str(m).unwrap();
        }
        g.play_str("28-32").unwrap();
        assert_eq!(g.outcome(), Outcome::Draw);

        // 80 quiet plies draw too.
        let mut g = Game::from_position(cells, Side::Dark);
        g.quiet = QUIET_LIMIT;
        assert_eq!(g.outcome(), Outcome::Draw);
    }

    #[test]
    fn notation_round_trips_and_replays() {
        let mut g = Game::new();
        g.play_str("11-15").unwrap();
        g.play_str("23-19").unwrap();
        let again = Game::replay(&g.move_string()).unwrap();
        assert_eq!(again.cells, g.cells);
        assert_eq!(parse_path("9x18x27"), Some(vec![8, 17, 26]));
        assert_eq!(parse_path("0-5"), None);
        assert_eq!(Game::replay("11-20").err(), Some("illegal move"));
    }

    #[test]
    fn encode_round_trips() {
        let g = Game::new();
        let s = encode(&g.cells, g.turn);
        assert_eq!(decode(&s), Some((g.cells, g.turn)));
    }

    /// Random games for the shared vectors: positions with their legal moves.
    pub fn random_positions(seed: u64, count: usize) -> Vec<(String, Vec<String>)> {
        let mut rng = ChaCha8Rng::seed_from_u64(seed);
        let mut out = Vec::new();
        while out.len() < count {
            let mut g = Game::new();
            let stop = rng.gen_range(4..70);
            for _ in 0..stop {
                if g.outcome() != Outcome::Ongoing {
                    break;
                }
                let moves = g.legal_moves();
                let m = moves[rng.gen_range(0..moves.len())].clone();
                g.apply(&m);
            }
            let mut legal: Vec<String> = g.legal_moves().iter().map(Move::notation).collect();
            legal.sort();
            out.push((encode(&g.cells, g.turn), legal));
        }
        out
    }

    /// Prints shared/checkers_vectors.json:
    /// cargo test --release checkers_print_vectors -- --ignored --nocapture
    #[test]
    #[ignore]
    fn checkers_print_vectors() {
        let positions: Vec<serde_json::Value> = random_positions(7, 60)
            .into_iter()
            .map(|(pos, moves)| serde_json::json!({ "pos": pos, "moves": moves }))
            .collect();
        let mut g = Game::new();
        let mut rng = ChaCha8Rng::seed_from_u64(99);
        while g.outcome() == Outcome::Ongoing && g.moves.len() < 300 {
            let moves = g.legal_moves();
            let m = moves[rng.gen_range(0..moves.len())].clone();
            g.apply(&m);
        }
        let outcome = match g.outcome() {
            Outcome::Win(s) => s.as_str().to_string(),
            Outcome::Draw => "draw".into(),
            Outcome::Ongoing => "ongoing".into(),
        };
        let v = serde_json::json!({
            "perft": [7, 49, 302, 1469, 7361],
            "positions": positions,
            "game": { "moves": g.move_string(), "outcome": outcome, "end": encode(&g.cells, g.turn) },
        });
        println!("VECTORS{}", serde_json::to_string(&v).unwrap());
    }

    #[test]
    fn shared_vectors_match() {
        const V: &str = include_str!("../../../shared/checkers_vectors.json");
        let v: serde_json::Value = serde_json::from_str(V).unwrap();
        for p in v["positions"].as_array().unwrap() {
            let (cells, turn) = decode(p["pos"].as_str().unwrap()).unwrap();
            let g = Game::from_position(cells, turn);
            let mut got: Vec<String> = g.legal_moves().iter().map(Move::notation).collect();
            got.sort();
            let want: Vec<String> = p["moves"].as_array().unwrap().iter().map(|m| m.as_str().unwrap().to_string()).collect();
            assert_eq!(got, want, "{}", p["pos"]);
        }
        let game = &v["game"];
        let g = Game::replay(game["moves"].as_str().unwrap()).unwrap();
        assert_eq!(encode(&g.cells, g.turn), game["end"].as_str().unwrap());
    }
}
