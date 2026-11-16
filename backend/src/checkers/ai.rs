//! Zero-Bot for Checkers: negamax with alpha-beta pruning, forced captures
//! searched a little deeper, and an evaluation of material, advancement,
//! the back row and the centre. Levels differ in depth and in how often a
//! deliberately weaker (but not silly) move is played.

use std::time::{Duration, Instant};

use rand::Rng;
use serde::{Deserialize, Serialize};

use super::rules::{rc, Game, Move, Side, SQUARES};

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

    /// (max search depth, chance in % of a random reasonable move, eval noise).
    fn style(self) -> (u8, u32, i32) {
        match self {
            Level::Easy => (2, 40, 60),
            Level::Medium => (4, 12, 20),
            Level::Hard => (5, 0, 10),
            Level::Master => (14, 0, 0),
        }
    }
}

pub const WIN: i32 = 100_000;
const MAN: i32 = 100;
const KING: i32 = 175;

/// Score for the side to move (positive = good for them).
pub fn evaluate(g: &Game) -> i32 {
    let mut score = 0;
    let (mut mine, mut theirs) = (0, 0);
    let s = g.turn.sign();
    for sq in 0..SQUARES {
        let p = g.cells[sq];
        if p == 0 {
            continue;
        }
        let (r, c) = rc(sq);
        let own = p * s > 0;
        let mut v = if p.abs() == 2 { KING } else { MAN };
        if p.abs() == 1 {
            // Rows advanced towards crowning.
            let adv = if p > 0 { r } else { 7 - r };
            v += adv * 3;
            // Men on their own back row guard against enemy kings.
            if adv == 0 {
                v += 8;
            }
        } else if (2..=5).contains(&r) && (2..=5).contains(&c) {
            v += 6;
        }
        if (2..=5).contains(&c) && (3..=4).contains(&r) {
            v += 4;
        }
        if own {
            score += v;
            mine += 1;
        } else {
            score -= v;
            theirs += 1;
        }
    }
    // Ahead with few pieces left: trading down wins.
    if mine > theirs && theirs <= 4 {
        score += (12 - theirs) * 6;
    } else if theirs > mine && mine <= 4 {
        score -= (12 - mine) * 6;
    }
    score
}

/// Captures first, longer captures first, then crowning moves.
fn order(g: &Game, moves: &mut [Move]) {
    moves.sort_by_cached_key(|m| {
        let mut k = -(m.captures.len() as i32) * 100;
        let from = m.path[0] as usize;
        let to = *m.path.last().expect("move has squares") as usize;
        let p = g.cells[from];
        if p.abs() == 1 && rc(to).0 == if p > 0 { 7 } else { 0 } {
            k -= 50;
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
    fn negamax(&mut self, g: &Game, depth: i32, mut alpha: i32, beta: i32, ply: i32) -> i32 {
        self.nodes += 1;
        if self.nodes & 1023 == 0 && Instant::now() >= self.deadline {
            self.out_of_time = true;
        }
        if self.out_of_time {
            return 0;
        }
        let mut moves = g.legal_moves();
        if moves.is_empty() {
            return -WIN + ply;
        }
        if g.quiet >= super::rules::QUIET_LIMIT {
            return 0;
        }
        // Forced captures don't use up depth (up to a limit), so the search
        // doesn't stop in the middle of an exchange.
        let forced = !moves[0].captures.is_empty() && ply < 24;
        if depth <= 0 && !forced {
            return evaluate(g);
        }
        let next_depth = if forced { depth } else { depth - 1 };
        order(g, &mut moves);
        for m in moves {
            let mut c = g.clone();
            c.apply(&m);
            let s = -self.negamax(&c, next_depth, -beta, -alpha, ply + 1);
            if s >= beta {
                return beta;
            }
            alpha = alpha.max(s);
        }
        alpha
    }
}

/// Every move with its score at `depth`, best first. With `exact`, each
/// move gets its true score (needed to pick a reasonable random move).
fn scored_moves(g: &Game, depth: u8, deadline: Instant, exact: bool) -> Option<Vec<(Move, i32)>> {
    let mut search = Search { deadline, nodes: 0, out_of_time: false };
    let mut moves = g.legal_moves();
    order(g, &mut moves);
    let mut out = Vec::with_capacity(moves.len());
    let mut alpha = -WIN - 1;
    for m in moves {
        let mut c = g.clone();
        c.apply(&m);
        let beta = if exact { WIN + 1 } else { -alpha + 1 };
        let s = -search.negamax(&c, i32::from(depth) - 1, -WIN - 1, beta, 1);
        if search.out_of_time {
            return None;
        }
        alpha = alpha.max(s);
        out.push((m, s));
    }
    // Stable: equal scores keep the move order.
    out.sort_by_key(|(_, s)| -*s);
    Some(out)
}

/// Zero-Bot's move within `budget` (iterative deepening up to the level's
/// depth; keeps the deepest search that finished).
pub fn best_move(g: &Game, level: Level, budget: Duration, rng: &mut impl Rng) -> Option<Move> {
    let (depth, random, noise) = level.style();
    let deadline = Instant::now() + budget;
    let exact = random > 0 || noise > 0;
    let mut best: Option<Vec<(Move, i32)>> = None;
    for d in 1..=depth {
        match scored_moves(g, d, deadline, exact) {
            Some(s) => best = Some(s),
            None => break,
        }
    }
    let scored = best.or_else(|| scored_moves(g, 1, Instant::now() + Duration::from_secs(5), exact))?;
    if scored.is_empty() {
        return None;
    }
    if scored.len() == 1 || scored[0].1 >= WIN - 50 {
        return Some(scored[0].0.clone());
    }
    if random > 0 && rng.gen_range(0..100) < random {
        let floor = scored[0].1 - 150;
        let ok: Vec<&(Move, i32)> = scored.iter().filter(|(_, s)| *s >= floor).collect();
        return Some(ok[rng.gen_range(0..ok.len())].0.clone());
    }
    if noise > 0 {
        return scored
            .iter()
            .map(|(m, s)| (m, s + rng.gen_range(-noise..=noise)))
            .max_by_key(|&(_, s)| s)
            .map(|(m, _)| m.clone());
    }
    Some(scored[0].0.clone())
}

// ---------------------------------------------------------------------------
// Puzzles: "win in N"
// ---------------------------------------------------------------------------

/// Every first move that wins (the opponent is left with no move) within
/// `moves` of your own moves, whatever they reply.
pub fn winning_moves(g: &Game, moves: u8) -> Vec<Move> {
    g.legal_moves()
        .into_iter()
        .filter(|m| {
            let mut c = g.clone();
            c.apply(m);
            forces_win(&c, moves)
        })
        .collect()
}

/// The attacker just moved: has the defender lost already, or will they
/// within `moves` attacker moves in total (counting the one just played)?
pub fn forces_win(g: &Game, moves: u8) -> bool {
    let replies = g.legal_moves();
    if replies.is_empty() {
        return true;
    }
    if moves <= 1 {
        return false;
    }
    replies.into_iter().all(|r| {
        let mut c = g.clone();
        c.apply(&r);
        c.legal_moves().into_iter().any(|m| {
            let mut d = c.clone();
            d.apply(&m);
            forces_win(&d, moves - 1)
        })
    })
}

/// The defender's reply that holds out longest (puzzle opponent): prefers
/// replies after which the attacker needs the most moves to win.
pub fn best_defence(g: &Game, moves: u8) -> Option<Move> {
    let replies = g.legal_moves();
    let mut best: Option<(Move, u8)> = None;
    for r in replies {
        let mut c = g.clone();
        c.apply(&r);
        let need = (1..=moves).find(|&n| !winning_moves(&c, n).is_empty()).unwrap_or(moves + 1);
        if best.as_ref().map_or(true, |(_, b)| need > *b) {
            best = Some((r, need));
        }
    }
    best.map(|(m, _)| m)
}

/// Which side Zero-Bot plays when you pick `you`.
pub fn bot_side(you: Side) -> Side {
    you.other()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checkers::rules::{decode, Outcome};
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    fn play_out(dark: Level, light: Level, seed: u64, budget_ms: u64) -> Outcome {
        let mut rng = ChaCha8Rng::seed_from_u64(seed);
        let mut g = Game::new();
        // A couple of random opening moves so games differ.
        for _ in 0..2 {
            let m = g.legal_moves();
            let pick = m[rng.gen_range(0..m.len())].clone();
            g.apply(&pick);
        }
        while g.outcome() == Outcome::Ongoing && g.moves.len() < 240 {
            let level = if g.turn == Side::Dark { dark } else { light };
            let m = best_move(&g, level, Duration::from_millis(budget_ms), &mut rng).unwrap();
            g.apply(&m);
        }
        g.outcome()
    }

    #[test]
    fn always_takes_a_win() {
        // Light man can jump the last dark piece.
        let (cells, turn) = decode("..............b..w.............. l").unwrap();
        let g = Game::from_position(cells, turn);
        let mut rng = ChaCha8Rng::seed_from_u64(1);
        for level in Level::ALL {
            let m = best_move(&g, level, Duration::from_millis(200), &mut rng).unwrap();
            let mut c = g.clone();
            c.apply(&m);
            assert_eq!(c.outcome(), Outcome::Win(Side::Light), "{level:?}");
        }
    }

    #[test]
    fn hard_beats_easy() {
        let mut hard = 0;
        let games = 6;
        for seed in 0..games {
            let (dark, light, hard_side) =
                if seed % 2 == 0 { (Level::Hard, Level::Easy, Side::Dark) } else { (Level::Easy, Level::Hard, Side::Light) };
            if play_out(dark, light, seed, 40) == Outcome::Win(hard_side) {
                hard += 1;
            }
        }
        assert!(hard >= 5, "Hard won {hard} of {games}");
    }

    #[test]
    fn medium_beats_easy_most_of_the_time() {
        let mut medium = 0;
        for seed in 0..6 {
            let (dark, light, side) =
                if seed % 2 == 0 { (Level::Medium, Level::Easy, Side::Dark) } else { (Level::Easy, Level::Medium, Side::Light) };
            if play_out(dark, light, 100 + seed, 30) == Outcome::Win(side) {
                medium += 1;
            }
        }
        assert!(medium >= 4, "Medium won {medium} of 6");
    }

    #[test]
    fn finds_a_two_move_win() {
        // Dark king and man vs a light man: the puzzle helpers agree with
        // the search.
        let (cells, turn) = decode("..............b..w.............. l").unwrap();
        let g = Game::from_position(cells, turn);
        assert!(!winning_moves(&g, 1).is_empty());
    }

    /// cargo test --release checkers_level_ladder -- --ignored --nocapture
    #[test]
    #[ignore]
    fn checkers_level_ladder() {
        let budget: u64 = std::env::var("LADDER_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(150);
        let only_top = std::env::var("LADDER_TOP").is_ok();
        for (strong, weak) in [(Level::Medium, Level::Easy), (Level::Hard, Level::Medium), (Level::Master, Level::Hard)] {
            if only_top && strong != Level::Master {
                continue;
            }
            let (mut w, mut l, mut d) = (0, 0, 0);
            for seed in 0..6u64 {
                let strong_dark = seed % 2 == 0;
                let (dark, light) = if strong_dark { (strong, weak) } else { (weak, strong) };
                let side = if strong_dark { Side::Dark } else { Side::Light };
                match play_out(dark, light, 500 + seed, budget) {
                    Outcome::Win(s) if s == side => w += 1,
                    Outcome::Draw | Outcome::Ongoing => d += 1,
                    _ => l += 1,
                }
            }
            println!("LADDER {strong:?} vs {weak:?}: {w} wins, {d} draws, {l} losses");
        }
    }
}
