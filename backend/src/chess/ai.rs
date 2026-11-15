//! Zero-Bot, the chess AI: negamax with alpha-beta pruning, a capture-only
//! quiescence search, and material + piece-square evaluation. Levels differ
//! in depth and in how often it plays a deliberately weaker move.

use cozy_chess::{Board, Color, Move, Piece, Square};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Easy,
    Medium,
    Hard,
    Master,
}

impl Level {
    pub const ALL: [Level; 4] = [Level::Easy, Level::Medium, Level::Hard, Level::Master];

    pub fn parse(s: &str) -> Option<Level> {
        Level::ALL.into_iter().find(|l| l.as_str() == s)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Level::Easy => "easy",
            Level::Medium => "medium",
            Level::Hard => "hard",
            Level::Master => "master",
        }
    }

    /// 1 (Easy) … 4 (Master): scales rewards like the other AI games.
    pub fn mult(self) -> i64 {
        match self {
            Level::Easy => 1,
            Level::Medium => 2,
            Level::Hard => 3,
            Level::Master => 4,
        }
    }

    /// (search depth, chance in % to pick a random reasonable move, eval noise).
    fn style(self) -> (u8, u32, i32) {
        match self {
            Level::Easy => (1, 35, 120),
            Level::Medium => (2, 10, 40),
            Level::Hard => (3, 0, 0),
            Level::Master => (5, 0, 0),
        }
    }
}

const MATE: i32 = 100_000;
const VALUE: [i32; 6] = [100, 320, 330, 500, 900, 0]; // P N B R Q K

// Piece-square tables, from White's side, rank 8 first (index = a8..h8, …, a1..h1).
#[rustfmt::skip]
const PST: [[i32; 64]; 6] = [
    // Pawn
    [  0,  0,  0,  0,  0,  0,  0,  0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
       5,  5, 10, 25, 25, 10,  5,  5,
       0,  0,  0, 20, 20,  0,  0,  0,
       5, -5,-10,  0,  0,-10, -5,  5,
       5, 10, 10,-20,-20, 10, 10,  5,
       0,  0,  0,  0,  0,  0,  0,  0],
    // Knight
    [-50,-40,-30,-30,-30,-30,-40,-50,
     -40,-20,  0,  0,  0,  0,-20,-40,
     -30,  0, 10, 15, 15, 10,  0,-30,
     -30,  5, 15, 20, 20, 15,  5,-30,
     -30,  0, 15, 20, 20, 15,  0,-30,
     -30,  5, 10, 15, 15, 10,  5,-30,
     -40,-20,  0,  5,  5,  0,-20,-40,
     -50,-40,-30,-30,-30,-30,-40,-50],
    // Bishop
    [-20,-10,-10,-10,-10,-10,-10,-20,
     -10,  0,  0,  0,  0,  0,  0,-10,
     -10,  0,  5, 10, 10,  5,  0,-10,
     -10,  5,  5, 10, 10,  5,  5,-10,
     -10,  0, 10, 10, 10, 10,  0,-10,
     -10, 10, 10, 10, 10, 10, 10,-10,
     -10,  5,  0,  0,  0,  0,  5,-10,
     -20,-10,-10,-10,-10,-10,-10,-20],
    // Rook
    [  0,  0,  0,  0,  0,  0,  0,  0,
       5, 10, 10, 10, 10, 10, 10,  5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
       0,  0,  0,  5,  5,  0,  0,  0],
    // Queen
    [-20,-10,-10, -5, -5,-10,-10,-20,
     -10,  0,  0,  0,  0,  0,  0,-10,
     -10,  0,  5,  5,  5,  5,  0,-10,
      -5,  0,  5,  5,  5,  5,  0, -5,
       0,  0,  5,  5,  5,  5,  0, -5,
     -10,  5,  5,  5,  5,  5,  0,-10,
     -10,  0,  5,  0,  0,  0,  0,-10,
     -20,-10,-10, -5, -5,-10,-10,-20],
    // King (middlegame: stay safe behind pawns)
    [-30,-40,-40,-50,-50,-40,-40,-30,
     -30,-40,-40,-50,-50,-40,-40,-30,
     -30,-40,-40,-50,-50,-40,-40,-30,
     -30,-40,-40,-50,-50,-40,-40,-30,
     -20,-30,-30,-40,-40,-30,-30,-20,
     -10,-20,-20,-20,-20,-20,-20,-10,
      20, 20,  0,  0,  0,  0, 20, 20,
      20, 30, 10,  0,  0, 10, 30, 20],
];

const PIECES: [Piece; 6] = [Piece::Pawn, Piece::Knight, Piece::Bishop, Piece::Rook, Piece::Queen, Piece::King];

fn piece_index(p: Piece) -> usize {
    PIECES.iter().position(|&x| x == p).unwrap_or(0)
}

/// Score from the side to move's point of view (centipawns).
pub fn evaluate(b: &Board) -> i32 {
    let mut score = 0;
    for (i, &p) in PIECES.iter().enumerate() {
        for sq in b.colored_pieces(Color::White, p) {
            score += VALUE[i] + PST[i][(sq as usize) ^ 56];
        }
        for sq in b.colored_pieces(Color::Black, p) {
            score -= VALUE[i] + PST[i][sq as usize];
        }
    }
    if b.side_to_move() == Color::White {
        score
    } else {
        -score
    }
}

fn legal_moves(b: &Board) -> Vec<Move> {
    let mut v = Vec::with_capacity(48);
    b.generate_moves(|pm| {
        v.extend(pm);
        false
    });
    v
}

/// Captures and promotions first, biggest victim by smallest attacker.
fn order(b: &Board, moves: &mut [Move]) {
    moves.sort_by_cached_key(|m| {
        let victim = b.piece_on(m.to).filter(|_| b.color_on(m.to) != Some(b.side_to_move()));
        let attacker = b.piece_on(m.from).map_or(0, |p| VALUE[piece_index(p)]);
        let mut k = 0;
        if let Some(v) = victim {
            k -= 10 * VALUE[piece_index(v)] - attacker;
        }
        if m.promotion.is_some() {
            k -= 8_000;
        }
        k
    });
}

struct Search {
    deadline: Instant,
    nodes: u64,
    out_of_time: bool,
}

impl Search {
    fn quiesce(&mut self, b: &Board, mut alpha: i32, beta: i32, ply: i32) -> i32 {
        self.nodes += 1;
        let stand = evaluate(b);
        if stand >= beta {
            return beta;
        }
        alpha = alpha.max(stand);
        if ply > 8 {
            return alpha;
        }
        let them = b.colors(!b.side_to_move());
        let mut caps: Vec<Move> = legal_moves(b).into_iter().filter(|m| them.has(m.to) || m.promotion.is_some()).collect();
        order(b, &mut caps);
        for m in caps {
            let mut c = b.clone();
            c.play_unchecked(m);
            let s = -self.quiesce(&c, -beta, -alpha, ply + 1);
            if s >= beta {
                return beta;
            }
            alpha = alpha.max(s);
        }
        alpha
    }

    fn negamax(&mut self, b: &Board, depth: u8, mut alpha: i32, beta: i32, ply: i32) -> i32 {
        self.nodes += 1;
        if self.nodes & 1023 == 0 && Instant::now() >= self.deadline {
            self.out_of_time = true;
        }
        if self.out_of_time {
            return 0;
        }
        let mut moves = legal_moves(b);
        if moves.is_empty() {
            return if b.checkers().is_empty() { 0 } else { -MATE + ply };
        }
        if b.halfmove_clock() >= 100 {
            return 0;
        }
        if depth == 0 {
            return self.quiesce(b, alpha, beta, ply);
        }
        order(b, &mut moves);
        for m in moves {
            let mut c = b.clone();
            c.play_unchecked(m);
            let s = -self.negamax(&c, depth - 1, -beta, -alpha, ply + 1);
            if s >= beta {
                return beta;
            }
            alpha = alpha.max(s);
        }
        alpha
    }
}

/// Every move with its score at `depth` (best first). With `exact`, every
/// move gets its true score (needed to pick a "reasonable" random move);
/// otherwise moves only need to prove they aren't better than the best.
fn scored_moves(b: &Board, depth: u8, deadline: Instant, exact: bool) -> Option<Vec<(Move, i32)>> {
    let mut search = Search { deadline, nodes: 0, out_of_time: false };
    let mut moves = legal_moves(b);
    order(b, &mut moves);
    let mut out = Vec::with_capacity(moves.len());
    let mut alpha = -MATE - 1;
    for m in moves {
        let mut c = b.clone();
        c.play_unchecked(m);
        let beta = if exact { MATE + 1 } else { -alpha + 1 };
        let s = -search.negamax(&c, depth.saturating_sub(1), -MATE - 1, beta, 1);
        if search.out_of_time {
            return None;
        }
        alpha = alpha.max(s);
        out.push((m, s));
    }
    out.sort_by_key(|&(_, s)| -s);
    Some(out)
}

/// Zero-Bot's move for the position, within `budget` (deeper levels use
/// iterative deepening and keep the best fully searched depth).
pub fn best_move(b: &Board, level: Level, budget: Duration, rng: &mut impl Rng) -> Option<Move> {
    let (depth, blunder, noise) = level.style();
    let deadline = Instant::now() + budget;
    let mut best: Option<Vec<(Move, i32)>> = None;
    let exact = blunder > 0 || noise > 0;
    for d in 1..=depth {
        match scored_moves(b, d, deadline, exact) {
            Some(s) => best = Some(s),
            None => break,
        }
    }
    let scored = best.or_else(|| scored_moves(b, 1, Instant::now() + Duration::from_secs(5), exact))?;
    if scored.is_empty() {
        return None;
    }
    // Never miss a mate in one, even on Easy.
    if scored[0].1 >= MATE - 2 {
        return Some(scored[0].0);
    }
    // Weaker levels sometimes play a random move that isn't a disaster.
    if blunder > 0 && rng.gen_range(0..100) < blunder {
        let floor = scored[0].1 - 350;
        let ok: Vec<&(Move, i32)> = scored.iter().filter(|(_, s)| *s >= floor).collect();
        return Some(ok[rng.gen_range(0..ok.len())].0);
    }
    if noise > 0 {
        return scored
            .iter()
            .map(|&(m, s)| (m, s + rng.gen_range(-noise..=noise)))
            .max_by_key(|&(_, s)| s)
            .map(|(m, _)| m);
    }
    Some(scored[0].0)
}

/// Is there a forced mate for the side to move within `moves` of its own moves?
/// Returns the mating first move (used to make and check puzzles).
pub fn mate_in(b: &Board, moves: u8) -> Option<Move> {
    legal_moves(b).into_iter().find(|&m| {
        let mut c = b.clone();
        c.play_unchecked(m);
        forces_mate(&c, moves)
    })
}

/// Every first move that forces mate within `moves` (a good puzzle has one or two).
pub fn mating_moves(b: &Board, moves: u8) -> Vec<Move> {
    legal_moves(b)
        .into_iter()
        .filter(|&m| {
            let mut c = b.clone();
            c.play_unchecked(m);
            forces_mate(&c, moves)
        })
        .collect()
}

/// The attacker has just moved: is the defender mated now, or will be within
/// `moves` attacker moves in total (counting the one just played)?
pub fn forces_mate(b: &Board, moves: u8) -> bool {
    let replies = legal_moves(b);
    if replies.is_empty() {
        return !b.checkers().is_empty();
    }
    if moves <= 1 {
        return false;
    }
    replies.into_iter().all(|r| {
        let mut c = b.clone();
        c.play_unchecked(r);
        mate_in(&c, moves - 1).is_some()
    })
}

/// The defender's most stubborn reply (the one that delays mate the most).
pub fn best_defence(b: &Board, rng: &mut impl Rng) -> Option<Move> {
    let moves = legal_moves(b);
    if moves.is_empty() {
        return None;
    }
    // Prefer replies after which no mate in 1 exists, else any reply.
    let safe: Vec<Move> = moves
        .iter()
        .copied()
        .filter(|&m| {
            let mut c = b.clone();
            c.play_unchecked(m);
            mate_in(&c, 1).is_none()
        })
        .collect();
    let pool = if safe.is_empty() { moves } else { safe };
    Some(pool[rng.gen_range(0..pool.len())])
}

/// Square helper for tests.
#[allow(dead_code)]
fn sq(s: &str) -> Square {
    s.parse().expect("square")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chess::Game;
    use cozy_chess::util::display_uci_move;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    fn uci(b: &Board, m: Move) -> String {
        display_uci_move(b, m).to_string()
    }

    #[test]
    fn start_position_is_even() {
        assert_eq!(evaluate(&Board::default()), 0);
    }

    #[test]
    fn every_level_finds_mate_in_one() {
        // Back-rank mate: Ra8#.
        let b = Board::from_fen("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", false).unwrap();
        let mut r = ChaCha8Rng::seed_from_u64(1);
        for l in Level::ALL {
            let m = best_move(&b, l, Duration::from_secs(5), &mut r).unwrap();
            assert_eq!(uci(&b, m), "a1a8", "{l:?}");
        }
    }

    #[test]
    fn hard_takes_a_free_queen() {
        let b = Board::from_fen("4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1", false).unwrap();
        let m = best_move(&b, Level::Hard, Duration::from_secs(5), &mut ChaCha8Rng::seed_from_u64(2)).unwrap();
        assert_eq!(uci(&b, m), "d1d5");
    }

    #[test]
    fn master_moves_quickly_from_the_start() {
        let t = Instant::now();
        let m = best_move(&Board::default(), Level::Master, Duration::from_millis(1500), &mut ChaCha8Rng::seed_from_u64(3));
        assert!(m.is_some());
        assert!(t.elapsed() < Duration::from_secs(4), "{:?}", t.elapsed());
    }

    #[test]
    fn mate_in_two_is_found_and_checked() {
        // Rook roller: 1.Rb7 (any) 2.Ra8#. There's no mate in one.
        let fen = "4k3/8/8/8/8/8/1R6/R3K3 w - - 0 1";
        let b = Board::from_fen(fen, false).unwrap();
        assert!(mate_in(&b, 1).is_none());
        let m = mate_in(&b, 2).expect("mate in 2");
        let mut g = Game::from_fen(fen).unwrap();
        g.play(&uci(&b, m)).unwrap();
        // Whatever Black does, a mate in one is left.
        let reply = best_defence(g.board(), &mut ChaCha8Rng::seed_from_u64(4)).unwrap();
        g.play_move(reply);
        assert!(mate_in(g.board(), 1).is_some());
        assert!(mate_in(&Board::default(), 2).is_none());
    }

    #[test]
    fn easy_is_weaker_than_hard() {
        // Over many games from move 1, Easy should not beat Hard.
        let mut r = ChaCha8Rng::seed_from_u64(9);
        let mut hard_points = 0;
        for game in 0..4 {
            let mut g = Game::new();
            let hard_is_white = game % 2 == 0;
            for _ in 0..120 {
                if g.outcome().is_over() {
                    break;
                }
                let white = g.to_move() == crate::chess::Side::White;
                let level = if white == hard_is_white { Level::Hard } else { Level::Easy };
                let m = best_move(g.board(), level, Duration::from_millis(400), &mut r).unwrap();
                g.play_move(m);
            }
            match g.outcome() {
                crate::chess::Outcome::Checkmate(side) => {
                    if (side == crate::chess::Side::White) == hard_is_white {
                        hard_points += 2;
                    }
                }
                _ => hard_points += 1,
            }
        }
        assert!(hard_points >= 5, "Hard scored {hard_points}/8 against Easy");
    }
}
