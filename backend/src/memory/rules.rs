//! Memory Match rules: two players take turns on one shared board of
//! face-down pairs. Flip two cards; a pair is yours and you go again, a
//! miss passes the turn. Most pairs when the board is empty wins.
//!
//! Chaos games add power-ups: each player brings 3 different ones and can
//! use each once, one per turn, while no card of theirs is half-flipped.
//!
//! The layout (and every Shuffle/Scatter) comes from the game's secret
//! seed, so `replay(setup, moves)` always rebuilds the same board. Only the
//! server runs these rules; players get `view`, which hides face-down cards.
//! Player 0 moves first (online: P1).

use serde::Serialize;
use serde_json::{json, Value};

use crate::connect_four::board::{Outcome, Player};
use crate::rng::Rng;

/// Cards each player brings into a Chaos game.
pub const KIT_SIZE: usize = 3;
/// Cards a Shuffle moves.
pub const SHUFFLE_CARDS: usize = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Size {
    /// 4×4, 8 pairs.
    Small,
    /// 4 wide × 6 tall, 12 pairs.
    Medium,
    /// 6×6, 18 pairs.
    Large,
}

impl Size {
    pub fn parse(s: &str) -> Option<Size> {
        match s {
            "small" => Some(Size::Small),
            "medium" => Some(Size::Medium),
            "large" => Some(Size::Large),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Size::Small => "small",
            Size::Medium => "medium",
            Size::Large => "large",
        }
    }

    pub fn cols(self) -> usize {
        match self {
            Size::Small | Size::Medium => 4,
            Size::Large => 6,
        }
    }

    pub fn rows(self) -> usize {
        match self {
            Size::Small => 4,
            Size::Medium | Size::Large => 6,
        }
    }

    pub fn cards(self) -> usize {
        self.cols() * self.rows()
    }

    pub fn pairs(self) -> usize {
        self.cards() / 2
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Classic,
    Chaos,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        match s {
            "classic" => Some(Mode::Classic),
            "chaos" => Some(Mode::Chaos),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Classic => "classic",
            Mode::Chaos => "chaos",
        }
    }
}

/// What a power asks you to pick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    None,
    /// Two different face-down cards.
    Two,
    /// The top-left card of a 2×2 block.
    Block,
    /// A row number (0 = top).
    Row,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Power {
    Shuffle,
    Swap,
    Peek,
    Fog,
    SecondChance,
    Mirror,
    Lock,
    Rotate,
    XRay,
    Scatter,
}

impl Power {
    pub const ALL: [Power; 10] = [
        Power::Shuffle,
        Power::Swap,
        Power::Peek,
        Power::Fog,
        Power::SecondChance,
        Power::Mirror,
        Power::Lock,
        Power::Rotate,
        Power::XRay,
        Power::Scatter,
    ];

    /// Same ids as `shared/memory_powers.json`.
    pub fn id(self) -> &'static str {
        match self {
            Power::Shuffle => "shuffle",
            Power::Swap => "swap",
            Power::Peek => "peek",
            Power::Fog => "fog",
            Power::SecondChance => "second-chance",
            Power::Mirror => "mirror",
            Power::Lock => "lock",
            Power::Rotate => "rotate",
            Power::XRay => "x-ray",
            Power::Scatter => "scatter",
        }
    }

    pub fn parse(s: &str) -> Option<Power> {
        Power::ALL.into_iter().find(|p| p.id() == s)
    }

    pub fn target(self) -> Target {
        match self {
            Power::Swap | Power::Peek | Power::Lock => Target::Two,
            Power::Rotate => Target::Block,
            Power::XRay => Target::Row,
            _ => Target::None,
        }
    }
}

/// "shuffle,swap,peek" -> 3 different powers.
pub fn parse_kit(s: &str) -> Result<Vec<Power>, &'static str> {
    let kit = s.split(',').map(|p| Power::parse(p.trim())).collect::<Option<Vec<_>>>().ok_or("unknown power")?;
    check_kit(&kit)?;
    Ok(kit)
}

pub fn kit_code(kit: &[Power]) -> String {
    kit.iter().map(|p| p.id()).collect::<Vec<_>>().join(",")
}

fn check_kit(kit: &[Power]) -> Result<(), &'static str> {
    if kit.len() != KIT_SIZE {
        return Err("bring exactly 3 powers");
    }
    if kit.iter().enumerate().any(|(i, p)| kit[i + 1..].contains(p)) {
        return Err("bring 3 different powers");
    }
    Ok(())
}

/// Everything fixed for one game.
#[derive(Debug, Clone, PartialEq)]
pub struct Setup {
    pub size: Size,
    pub mode: Mode,
    /// Secret: decides the layout and every Shuffle/Scatter.
    pub seed: u32,
    /// Each player's powers (player 0 moves first); empty in Classic.
    pub kits: [Vec<Power>; 2],
}

/// One move: flip a card, or use a power on some targets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    Flip(usize),
    Power(Power, Vec<usize>),
}

impl Action {
    /// "12" or "swap:3,7" (moves are stored space-separated).
    pub fn parse(s: &str) -> Result<Action, &'static str> {
        if let Ok(i) = s.parse::<usize>() {
            return Ok(Action::Flip(i));
        }
        let (name, rest) = s.split_once(':').unwrap_or((s, ""));
        let p = Power::parse(name).ok_or("unknown move")?;
        let targets = if rest.is_empty() {
            vec![]
        } else {
            rest.split(',').map(|t| t.parse::<usize>()).collect::<Result<Vec<_>, _>>().map_err(|_| "bad target")?
        };
        Ok(Action::Power(p, targets))
    }

    pub fn code(&self) -> String {
        match self {
            Action::Flip(i) => i.to_string(),
            Action::Power(p, t) if t.is_empty() => p.id().to_string(),
            Action::Power(p, t) => format!("{}:{}", p.id(), t.iter().map(usize::to_string).collect::<Vec<_>>().join(",")),
        }
    }
}

/// What's on a player for their (next) turn, and Second Chance on yours.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Effects {
    pub fog: bool,
    pub mirror: bool,
    /// Cards this player can't flip this turn.
    pub locked: Vec<usize>,
    /// Your next miss doesn't end your turn.
    pub second_chance: bool,
}

/// The last thing that happened, for everyone's screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Last {
    pub player: usize,
    /// "flip", "match", "miss" or "power".
    pub kind: &'static str,
    /// Cards turned face up by this action ([position, symbol]).
    pub cards: Vec<(usize, u8)>,
    pub power: Option<&'static str>,
    /// Spots a power touched (they glow).
    pub spots: Vec<usize>,
    /// A miss that didn't end the turn (Second Chance).
    pub kept_turn: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct PlayerStats {
    pub misses: u32,
    /// Most pairs found in one turn.
    pub best_run: u32,
    pub powers: u32,
}

#[derive(Debug, Clone)]
pub struct Game {
    pub setup: Setup,
    /// The symbol at each position; None once a pair is taken.
    board: Vec<Option<u8>>,
    /// This turn's half-flipped card.
    up: Option<usize>,
    pub turn: usize,
    pub pairs: [u32; 2],
    /// Symbols of the pairs each player took, oldest first (for Scatter).
    taken: [Vec<u8>; 2],
    used: [Vec<Power>; 2],
    power_this_turn: bool,
    effects: [Effects; 2],
    last: Option<Last>,
    /// A private look from the last action: (player, [position, symbol]).
    reveal: Option<(usize, Vec<(usize, u8)>)>,
    pub moves: Vec<Action>,
    pub stats: [PlayerStats; 2],
    /// Pairs found this turn.
    run: u32,
}

impl Game {
    pub fn new(setup: Setup) -> Result<Game, &'static str> {
        match setup.mode {
            Mode::Classic if setup.kits.iter().any(|k| !k.is_empty()) => return Err("Classic games have no powers"),
            Mode::Chaos => {
                for k in &setup.kits {
                    check_kit(k)?;
                }
            }
            _ => {}
        }
        let n = setup.size.cards();
        let mut cards: Vec<u8> = (0..n).map(|i| (i / 2) as u8).collect();
        let mut rng = Rng::new(setup.seed);
        for i in (1..n).rev() {
            let j = rng.below(i as u32 + 1) as usize;
            cards.swap(i, j);
        }
        Ok(Game {
            setup,
            board: cards.into_iter().map(Some).collect(),
            up: None,
            turn: 0,
            pairs: [0, 0],
            taken: [vec![], vec![]],
            used: [vec![], vec![]],
            power_this_turn: false,
            effects: [Effects::default(), Effects::default()],
            last: None,
            reveal: None,
            moves: vec![],
            stats: [PlayerStats::default(); 2],
            run: 0,
        })
    }

    /// Rebuild a game from its space-separated move string.
    pub fn replay(setup: Setup, moves: &str) -> Result<Game, &'static str> {
        let mut g = Game::new(setup)?;
        for m in moves.split_whitespace() {
            g.play(Action::parse(m)?).map_err(|_| "bad moves")?;
        }
        Ok(g)
    }

    pub fn move_string(&self) -> String {
        self.moves.iter().map(Action::code).collect::<Vec<_>>().join(" ")
    }

    pub fn is_over(&self) -> bool {
        self.board.iter().all(Option::is_none)
    }

    pub fn outcome(&self) -> Outcome {
        if !self.is_over() {
            return Outcome::Ongoing;
        }
        match self.pairs[0].cmp(&self.pairs[1]) {
            std::cmp::Ordering::Greater => Outcome::Win(Player::P1),
            std::cmp::Ordering::Less => Outcome::Win(Player::P2),
            std::cmp::Ordering::Equal => Outcome::Draw,
        }
    }

    /// Whose move it is (player 0 = P1).
    pub fn next(&self) -> Player {
        if self.turn == 0 {
            Player::P1
        } else {
            Player::P2
        }
    }

    /// Powers `player` has used this game.
    pub fn used(&self, player: usize) -> &[Power] {
        &self.used[player]
    }

    /// Can the player to move use a power right now?
    pub fn can_power(&self) -> bool {
        self.setup.mode == Mode::Chaos && !self.is_over() && !self.power_this_turn && self.up.is_none()
    }

    /// Locked cards that actually hold for `player`: a Lock is dropped when
    /// it would leave fewer than 2 cards to flip.
    fn locked(&self, player: usize) -> &[usize] {
        let l = &self.effects[player].locked;
        let free = self.board.iter().enumerate().filter(|(i, c)| c.is_some() && !l.contains(i)).count();
        if free >= 2 {
            l
        } else {
            &[]
        }
    }

    fn cards_left(&self) -> Vec<usize> {
        (0..self.board.len()).filter(|&i| self.board[i].is_some()).collect()
    }

    /// Fresh random numbers for the power used as move number `moves.len()`.
    fn power_rng(&self) -> Rng {
        Rng::new(self.setup.seed ^ (self.moves.len() as u32 + 1).wrapping_mul(0x9E37_79B9))
    }

    fn end_turn(&mut self) {
        self.effects[self.turn] = Effects::default();
        self.turn = 1 - self.turn;
        self.power_this_turn = false;
        self.run = 0;
    }

    pub fn play(&mut self, a: Action) -> Result<(), &'static str> {
        if self.is_over() {
            return Err("the game is already over");
        }
        match &a {
            Action::Flip(i) => self.flip(*i)?,
            Action::Power(p, t) => self.power(*p, t)?,
        }
        self.moves.push(a);
        Ok(())
    }

    fn flip(&mut self, i: usize) -> Result<(), &'static str> {
        let me = self.turn;
        if i >= self.board.len() {
            return Err("pick a card on the board");
        }
        let Some(sym) = self.board[i] else { return Err("that pair is already taken") };
        if self.up == Some(i) {
            return Err("that card is already face up");
        }
        if self.locked(me).contains(&i) {
            return Err("that card is locked this turn");
        }
        self.reveal = None;
        let Some(first) = self.up.take() else {
            self.up = Some(i);
            self.last = Some(Last { player: me, kind: "flip", cards: vec![(i, sym)], power: None, spots: vec![], kept_turn: false });
            return Ok(());
        };
        let first_sym = self.board[first].expect("the face-up card is on the board");
        let cards = vec![(first, first_sym), (i, sym)];
        if first_sym == sym {
            self.board[first] = None;
            self.board[i] = None;
            self.pairs[me] += 1;
            self.taken[me].push(sym);
            self.run += 1;
            self.stats[me].best_run = self.stats[me].best_run.max(self.run);
            self.last = Some(Last { player: me, kind: "match", cards, power: None, spots: vec![], kept_turn: true });
        } else {
            self.stats[me].misses += 1;
            let kept = std::mem::take(&mut self.effects[me].second_chance);
            if !kept {
                self.end_turn();
            }
            self.last = Some(Last { player: me, kind: "miss", cards, power: None, spots: vec![], kept_turn: kept });
        }
        Ok(())
    }

    fn power(&mut self, p: Power, t: &[usize]) -> Result<(), &'static str> {
        let me = self.turn;
        let them = 1 - me;
        if self.setup.mode != Mode::Chaos {
            return Err("powers are only in Chaos games");
        }
        if !self.setup.kits[me].contains(&p) {
            return Err("that power isn't in your kit");
        }
        if self.used[me].contains(&p) {
            return Err("you already used that power this game");
        }
        if self.power_this_turn {
            return Err("one power per turn");
        }
        if self.up.is_some() {
            return Err("use a power before flipping a card");
        }
        let cols = self.setup.size.cols();
        let rows = self.setup.size.rows();
        // Check the targets first.
        match p.target() {
            Target::None if !t.is_empty() => return Err("this power needs no target"),
            Target::Two => {
                let ok = t.len() == 2 && t[0] != t[1] && t.iter().all(|&i| i < self.board.len() && self.board[i].is_some());
                if !ok {
                    return Err("pick 2 different face-down cards");
                }
            }
            Target::Block => {
                let ok = t.len() == 1 && t[0] % cols < cols - 1 && t[0] / cols < rows - 1;
                if !ok {
                    return Err("pick the top-left card of a 2x2 block");
                }
                if block(t[0], cols).iter().filter(|&&i| self.board[i].is_some()).count() < 2 {
                    return Err("pick a block with at least 2 cards in it");
                }
            }
            Target::Row => {
                if t.len() != 1 || t[0] >= rows {
                    return Err("pick a row");
                }
                if !(0..cols).any(|c| self.board[t[0] * cols + c].is_some()) {
                    return Err("that row is empty");
                }
            }
            Target::None => {}
        }
        let mut spots = t.to_vec();
        let mut reveal = None;
        match p {
            Power::Shuffle => {
                let mut left = self.cards_left();
                if left.len() < 3 {
                    return Err("too few cards left to shuffle");
                }
                let mut rng = self.power_rng();
                let k = SHUFFLE_CARDS.min(left.len());
                for i in 0..k {
                    let j = i + rng.below((left.len() - i) as u32) as usize;
                    left.swap(i, j);
                }
                let picked: Vec<usize> = left[..k].to_vec();
                let mut syms: Vec<Option<u8>> = picked.iter().map(|&i| self.board[i]).collect();
                for i in (1..k).rev() {
                    let j = rng.below(i as u32 + 1) as usize;
                    syms.swap(i, j);
                }
                for (&pos, s) in picked.iter().zip(syms) {
                    self.board[pos] = s;
                }
                spots = picked;
                spots.sort_unstable();
            }
            Power::Swap => self.board.swap(t[0], t[1]),
            Power::Peek => reveal = Some(t.iter().map(|&i| (i, self.board[i].unwrap())).collect()),
            Power::Fog => self.effects[them].fog = true,
            Power::SecondChance => self.effects[me].second_chance = true,
            Power::Mirror => self.effects[them].mirror = true,
            Power::Lock => self.effects[them].locked = t.to_vec(),
            Power::Rotate => {
                let b = block(t[0], cols);
                let old: Vec<Option<u8>> = b.iter().map(|&i| self.board[i]).collect();
                // Clockwise: top-left -> top-right -> bottom-right -> bottom-left.
                for k in 0..4 {
                    self.board[b[(k + 1) % 4]] = old[k];
                }
                spots = b.to_vec();
            }
            Power::XRay => {
                let row: Vec<(usize, u8)> =
                    (0..cols).map(|c| t[0] * cols + c).filter_map(|i| self.board[i].map(|s| (i, s))).collect();
                spots = row.iter().map(|&(i, _)| i).collect();
                reveal = Some(row);
            }
            Power::Scatter => {
                let Some(sym) = self.taken[them].pop() else { return Err("your rival has no pairs yet") };
                self.pairs[them] -= 1;
                let mut rng = self.power_rng();
                let mut empty: Vec<usize> = (0..self.board.len()).filter(|&i| self.board[i].is_none()).collect();
                let mut landed = vec![];
                for _ in 0..2 {
                    let e = empty.swap_remove(rng.below(empty.len() as u32) as usize);
                    self.board[e] = Some(sym);
                    landed.push(e);
                }
                // Hide them: each trades places with a random other card.
                spots = landed.clone();
                for &e in &landed {
                    let others: Vec<usize> = self.cards_left().into_iter().filter(|i| !landed.contains(i)).collect();
                    if others.is_empty() {
                        continue;
                    }
                    let c = others[rng.below(others.len() as u32) as usize];
                    self.board.swap(e, c);
                    spots.push(c);
                }
                spots.sort_unstable();
                spots.dedup();
            }
        }
        self.reveal = reveal.map(|r| (me, r));
        self.used[me].push(p);
        self.power_this_turn = true;
        self.stats[me].powers += 1;
        self.last = Some(Last { player: me, kind: "power", cards: vec![], power: Some(p.id()), spots, kept_turn: true });
        Ok(())
    }

    /// The board as `viewer` (0 or 1; None = nobody in particular) may see it.
    /// `cells`: -1 taken, 0 face down, n = symbol n-1 face up.
    pub fn view(&self, viewer: Option<usize>) -> Value {
        let cells: Vec<i16> = self
            .board
            .iter()
            .enumerate()
            .map(|(i, c)| match c {
                None => -1,
                Some(s) if self.up == Some(i) => i16::from(*s) + 1,
                Some(_) => 0,
            })
            .collect();
        let reveal = match &self.reveal {
            Some((who, r)) if Some(*who) == viewer => json!(r),
            _ => Value::Null,
        };
        let powers: Vec<Value> = (0..2)
            .map(|pl| {
                json!(self.setup.kits[pl].iter().map(|p| json!({ "id": p.id(), "used": self.used[pl].contains(p) })).collect::<Vec<_>>())
            })
            .collect();
        let effects: Vec<Value> = (0..2)
            .map(|pl| {
                let e = &self.effects[pl];
                json!({ "fog": e.fog, "mirror": e.mirror, "locked": self.locked(pl), "second_chance": e.second_chance })
            })
            .collect();
        json!({
            "size": self.setup.size,
            "cols": self.setup.size.cols(),
            "rows": self.setup.size.rows(),
            "mode": self.setup.mode,
            "cells": cells,
            "pairs": self.pairs,
            "turn": self.turn,
            "last": self.last,
            "reveal": reveal,
            "powers": powers,
            "effects": effects,
            "can_power": self.can_power(),
            "stats": self.stats,
        })
    }
}

/// The 2×2 block at top-left `i`, clockwise from the top-left.
fn block(i: usize, cols: usize) -> [usize; 4] {
    [i, i + 1, i + cols + 1, i + cols]
}

#[cfg(test)]
mod tests {
    use super::*;
    use Power::*;

    fn classic(size: Size, seed: u32) -> Game {
        Game::new(Setup { size, mode: Mode::Classic, seed, kits: [vec![], vec![]] }).unwrap()
    }

    fn chaos(kits: [[Power; 3]; 2]) -> Game {
        Game::new(Setup { size: Size::Small, mode: Mode::Chaos, seed: 77, kits: [kits[0].to_vec(), kits[1].to_vec()] }).unwrap()
    }

    /// Two positions holding the same symbol.
    fn pair(g: &Game) -> (usize, usize) {
        let left = g.cards_left();
        for &a in &left {
            for &b in &left {
                if a < b && g.board[a] == g.board[b] {
                    return (a, b);
                }
            }
        }
        panic!("no pair left")
    }

    /// Two positions holding different symbols.
    fn miss(g: &Game) -> (usize, usize) {
        let left = g.cards_left();
        let a = left[0];
        (a, *left.iter().find(|&&b| g.board[b] != g.board[a]).unwrap())
    }

    fn flip2(g: &mut Game, (a, b): (usize, usize)) {
        g.play(Action::Flip(a)).unwrap();
        g.play(Action::Flip(b)).unwrap();
    }

    #[test]
    fn sizes_and_layout() {
        for (size, cols, rows) in [(Size::Small, 4, 4), (Size::Medium, 4, 6), (Size::Large, 6, 6)] {
            assert_eq!((size.cols(), size.rows()), (cols, rows));
            assert_eq!(Size::parse(size.as_str()), Some(size));
            let g = classic(size, 1);
            for s in 0..size.pairs() as u8 {
                assert_eq!(g.board.iter().filter(|c| **c == Some(s)).count(), 2);
            }
        }
        assert_eq!(classic(Size::Large, 5).board, classic(Size::Large, 5).board);
        assert_ne!(classic(Size::Large, 5).board, classic(Size::Large, 6).board);
    }

    #[test]
    fn a_pair_keeps_the_turn_and_a_miss_passes_it() {
        let mut g = classic(Size::Small, 3);
        let p = pair(&g);
        g.play(Action::Flip(p.0)).unwrap();
        assert_eq!(g.view(None)["cells"][p.0], json!(i16::from(g.board[p.0].unwrap()) + 1));
        assert_eq!(g.play(Action::Flip(p.0)), Err("that card is already face up"));
        g.play(Action::Flip(p.1)).unwrap();
        assert_eq!((g.turn, g.pairs), (0, [1, 0]));
        assert_eq!(g.play(Action::Flip(p.0)), Err("that pair is already taken"));
        assert_eq!(g.play(Action::Flip(99)), Err("pick a card on the board"));
        let m = miss(&g);
        flip2(&mut g, m);
        assert_eq!((g.turn, g.stats[0].misses), (1, 1));
        assert_eq!(g.last.as_ref().unwrap().kind, "miss");
        // Face-down cards never show their symbol.
        assert!(g.view(Some(0))["cells"].as_array().unwrap().iter().all(|c| c.as_i64().unwrap() <= 0));
    }

    #[test]
    fn the_game_ends_with_most_pairs_winning() {
        let mut g = classic(Size::Small, 9);
        // Player 0 takes 5 pairs, misses, player 1 takes the last 3.
        for _ in 0..5 {
            let m = pair(&g);
            flip2(&mut g, m);
        }
        let m = miss(&g);
        flip2(&mut g, m);
        while !g.is_over() {
            assert_eq!(g.outcome(), Outcome::Ongoing);
            let m = pair(&g);
            flip2(&mut g, m);
        }
        assert_eq!(g.pairs, [5, 3]);
        assert_eq!(g.stats[0].best_run, 5);
        assert_eq!(g.outcome(), Outcome::Win(Player::P1));
        assert_eq!(g.play(Action::Flip(0)), Err("the game is already over"));
    }

    #[test]
    fn equal_pairs_is_a_draw() {
        let mut g = classic(Size::Small, 4);
        for _ in 0..4 {
            let m = pair(&g);
            flip2(&mut g, m);
        }
        let m = miss(&g);
        flip2(&mut g, m);
        for _ in 0..4 {
            let m = pair(&g);
            flip2(&mut g, m);
        }
        assert_eq!(g.outcome(), Outcome::Draw);
    }

    #[test]
    fn moves_replay_to_the_same_game() {
        let mut g = chaos([[Shuffle, Scatter, Rotate], [Swap, Peek, XRay]]);
        let m = miss(&g);
        flip2(&mut g, m);
        let m = pair(&g);
        flip2(&mut g, m);
        g.play(Action::Power(XRay, vec![1])).unwrap();
        let m = miss(&g);
        flip2(&mut g, m);
        g.play(Action::Power(Scatter, vec![])).unwrap();
        g.play(Action::Flip(g.cards_left()[0])).unwrap();
        let code = g.move_string();
        let r = Game::replay(g.setup.clone(), &code).unwrap();
        assert_eq!((r.board, r.pairs, r.turn, r.up), (g.board.clone(), g.pairs, g.turn, g.up));
        assert_eq!(Action::parse("swap:3,7"), Ok(Action::Power(Swap, vec![3, 7])));
        assert_eq!(Action::Power(Swap, vec![3, 7]).code(), "swap:3,7");
        assert_eq!(Action::parse("fog"), Ok(Action::Power(Fog, vec![])));
        assert!(Action::parse("jump").is_err());
    }

    #[test]
    fn kits() {
        assert_eq!(parse_kit("shuffle,swap,x-ray"), Ok(vec![Shuffle, Swap, XRay]));
        assert_eq!(kit_code(&[Shuffle, Swap, XRay]), "shuffle,swap,x-ray");
        assert_eq!(parse_kit("shuffle,swap"), Err("bring exactly 3 powers"));
        assert_eq!(parse_kit("shuffle,swap,swap"), Err("bring 3 different powers"));
        assert_eq!(parse_kit("shuffle,swap,nap"), Err("unknown power"));
        let bad = Setup { size: Size::Small, mode: Mode::Chaos, seed: 1, kits: [vec![Fog], vec![]] };
        assert!(Game::new(bad).is_err());
        let bad = Setup { size: Size::Small, mode: Mode::Classic, seed: 1, kits: [vec![Fog, Swap, Peek], vec![]] };
        assert!(Game::new(bad).is_err());
    }

    #[test]
    fn power_rules() {
        let mut c = classic(Size::Small, 1);
        assert_eq!(c.play(Action::Power(Fog, vec![])), Err("powers are only in Chaos games"));
        let mut g = chaos([[Fog, Mirror, Swap], [Peek, Lock, Rotate]]);
        assert_eq!(g.play(Action::Power(Peek, vec![0, 1])), Err("that power isn't in your kit"));
        assert_eq!(g.play(Action::Power(Fog, vec![3])), Err("this power needs no target"));
        assert_eq!(g.play(Action::Power(Swap, vec![3, 3])), Err("pick 2 different face-down cards"));
        g.play(Action::Power(Fog, vec![])).unwrap();
        assert_eq!(g.play(Action::Power(Mirror, vec![])), Err("one power per turn"));
        // A pair keeps the turn but not the power: still one per turn.
        let m = pair(&g);
        flip2(&mut g, m);
        assert_eq!(g.play(Action::Power(Mirror, vec![])), Err("one power per turn"));
        let m = miss(&g);
        flip2(&mut g, m);
        // Player 1's turn: they can use one, but not after a flip.
        g.play(Action::Flip(g.cards_left()[0])).unwrap();
        assert_eq!(g.play(Action::Power(Rotate, vec![0])), Err("use a power before flipping a card"));
        assert!(!g.can_power());
        let a = *g.cards_left().iter().find(|&&i| Some(i) != g.up && g.board[i] != g.board[g.up.unwrap()]).unwrap();
        g.play(Action::Flip(a)).unwrap();
        // Player 0 again: Fog was used, so it's gone for this game.
        assert_eq!(g.play(Action::Power(Fog, vec![])), Err("you already used that power this game"));
        assert!(g.can_power());
        assert_eq!(g.view(None)["powers"][0][0], json!({ "id": "fog", "used": true }));
        assert_eq!(c.play(Action::Flip(0)), Ok(()));
    }

    #[test]
    fn fog_and_mirror_hit_the_rival_for_one_turn() {
        let mut g = chaos([[Fog, Mirror, Swap], [Peek, Lock, Rotate]]);
        g.play(Action::Power(Fog, vec![])).unwrap();
        assert_eq!(g.view(None)["effects"][1]["fog"], json!(true));
        let m = miss(&g);
        flip2(&mut g, m);
        assert_eq!(g.turn, 1);
        assert_eq!(g.view(None)["effects"][1]["fog"], json!(true));
        let m = miss(&g);
        flip2(&mut g, m);
        assert_eq!(g.view(None)["effects"][1]["fog"], json!(false));
        g.play(Action::Power(Mirror, vec![])).unwrap();
        assert_eq!(g.view(None)["effects"][1]["mirror"], json!(true));
        assert_eq!(g.last.as_ref().unwrap().power, Some("mirror"));
    }

    #[test]
    fn swap_and_rotate_move_cards() {
        let mut g = chaos([[Swap, Rotate, Fog], [Peek, Lock, Mirror]]);
        let before = g.board.clone();
        g.play(Action::Power(Swap, vec![2, 9])).unwrap();
        assert_eq!((g.board[2], g.board[9]), (before[9], before[2]));
        assert_eq!(g.last.as_ref().unwrap().spots, vec![2, 9]);
        let m = miss(&g);
        flip2(&mut g, m);
        let m = miss(&g);
        flip2(&mut g, m);
        let before = g.board.clone();
        assert_eq!(g.play(Action::Power(Rotate, vec![3])), Err("pick the top-left card of a 2x2 block"));
        assert_eq!(g.play(Action::Power(Rotate, vec![12])), Err("pick the top-left card of a 2x2 block"));
        g.play(Action::Power(Rotate, vec![5])).unwrap();
        // 5 6 / 9 10: top-left goes to top-right and so on.
        assert_eq!((g.board[6], g.board[10], g.board[9], g.board[5]), (before[5], before[6], before[10], before[9]));
    }

    #[test]
    fn rotate_needs_two_cards_in_the_block() {
        let mut g = chaos([[Rotate, Fog, Swap], [Peek, Lock, Mirror]]);
        // Take the pairs until a block has fewer than 2 cards: play player 0 alone.
        while g.cards_left().len() > 2 {
            let m = pair(&g);
            flip2(&mut g, m);
        }
        let left = g.cards_left();
        let cols = 4;
        let lonely = (0..12).find(|&i| i % cols < cols - 1 && block(i, cols).iter().filter(|b| left.contains(b)).count() < 2).unwrap();
        assert_eq!(g.play(Action::Power(Rotate, vec![lonely])), Err("pick a block with at least 2 cards in it"));
    }

    #[test]
    fn shuffle_moves_six_cards_and_keeps_every_pair() {
        let mut g = chaos([[Shuffle, Fog, Swap], [Peek, Lock, Mirror]]);
        let before = g.board.clone();
        g.play(Action::Power(Shuffle, vec![])).unwrap();
        let spots = g.last.as_ref().unwrap().spots.clone();
        assert_eq!(spots.len(), SHUFFLE_CARDS);
        for i in 0..16 {
            if !spots.contains(&i) {
                assert_eq!(g.board[i], before[i]);
            }
        }
        let mut a: Vec<_> = before.clone();
        let mut b: Vec<_> = g.board.clone();
        a.sort();
        b.sort();
        assert_eq!(a, b);
    }

    #[test]
    fn peek_and_x_ray_are_private() {
        let mut g = chaos([[Peek, XRay, Fog], [Swap, Lock, Mirror]]);
        g.play(Action::Power(Peek, vec![4, 11])).unwrap();
        let mine = g.view(Some(0));
        assert_eq!(mine["reveal"], json!([[4, g.board[4].unwrap()], [11, g.board[11].unwrap()]]));
        assert_eq!(g.view(Some(1))["reveal"], Value::Null);
        assert_eq!(g.view(None)["reveal"], Value::Null);
        assert_eq!(g.view(Some(1))["last"]["spots"], json!([4, 11]));
        // The next action hides it again.
        g.play(Action::Flip(0)).unwrap();
        assert_eq!(g.view(Some(0))["reveal"], Value::Null);
        g.play(Action::Flip(g.cards_left().into_iter().find(|&i| i != 0 && g.board[i] != g.board[0]).unwrap())).unwrap();
        let m = miss(&g);
        flip2(&mut g, m);
        assert_eq!(g.play(Action::Power(XRay, vec![4])), Err("pick a row"));
        g.play(Action::Power(XRay, vec![2])).unwrap();
        let r = g.view(Some(0))["reveal"].clone();
        assert_eq!(r.as_array().unwrap().len(), 4);
        assert_eq!(r[0], json!([8, g.board[8].unwrap()]));
        assert_eq!(g.view(Some(1))["reveal"], Value::Null);
    }

    #[test]
    fn second_chance_forgives_one_miss() {
        let mut g = chaos([[SecondChance, Fog, Swap], [Peek, Lock, Mirror]]);
        g.play(Action::Power(SecondChance, vec![])).unwrap();
        let m = miss(&g);
        flip2(&mut g, m);
        assert_eq!(g.turn, 0);
        assert!(g.last.as_ref().unwrap().kept_turn);
        let m = miss(&g);
        flip2(&mut g, m);
        assert_eq!(g.turn, 1);
        assert_eq!(g.stats[0].misses, 2);
    }

    #[test]
    fn lock_blocks_two_cards_for_the_rivals_next_turn() {
        let mut g = chaos([[Lock, Fog, Swap], [Peek, Rotate, Mirror]]);
        let (a, b) = pair(&g);
        g.play(Action::Power(Lock, vec![a, b])).unwrap();
        // The locker can still flip them.
        assert_eq!(g.locked(0), &[] as &[usize]);
        let m = g.cards_left().into_iter().filter(|&i| i != a && i != b).collect::<Vec<_>>();
        let other = *m.iter().find(|&&i| g.board[i] != g.board[m[0]]).unwrap();
        flip2(&mut g, (m[0], other));
        assert_eq!(g.turn, 1);
        assert_eq!(g.play(Action::Flip(a)), Err("that card is locked this turn"));
        assert_eq!(g.view(None)["effects"][1]["locked"], json!([a, b]));
        let m = miss_without(&g, &[a, b]);
        flip2(&mut g, m);
        // Player 0's turn: the lock is over.
        assert_eq!(g.view(None)["effects"][1]["locked"], json!([]));
        flip2(&mut g, (a, b));
        assert_eq!(g.pairs[0], 1);
    }

    fn miss_without(g: &Game, skip: &[usize]) -> (usize, usize) {
        let left: Vec<usize> = g.cards_left().into_iter().filter(|i| !skip.contains(i)).collect();
        (left[0], *left.iter().find(|&&b| g.board[b] != g.board[left[0]]).unwrap())
    }

    #[test]
    fn a_lock_on_the_last_cards_is_dropped() {
        let mut g = chaos([[Lock, Fog, Swap], [Peek, Rotate, Mirror]]);
        while g.cards_left().len() > 4 {
            let m = pair(&g);
            flip2(&mut g, m);
        }
        let (a, b) = pair(&g);
        g.play(Action::Power(Lock, vec![a, b])).unwrap();
        // Player 0 takes the other pair, leaving only the locked cards.
        let rest: Vec<usize> = g.cards_left().into_iter().filter(|&i| i != a && i != b).collect();
        let mut g2 = g.clone();
        flip2(&mut g2, (rest[0], rest[1]));
        assert_eq!(g2.locked(1), &[] as &[usize]);
        // Normal case: 2 unlocked left, the lock holds for player 1.
        flip2(&mut g, (rest[0], a));
        assert_eq!(g.turn, 1);
        assert_eq!(g.locked(1), &[a, b]);
        assert_eq!(g.play(Action::Flip(b)), Err("that card is locked this turn"));
    }

    #[test]
    fn scatter_puts_the_rivals_last_pair_back() {
        let mut g = chaos([[Fog, Swap, Peek], [Scatter, Lock, Mirror]]);
        assert_eq!(g.cards_left().len(), 16);
        let m = pair(&g);
        flip2(&mut g, m);
        let m = pair(&g);
        flip2(&mut g, m);
        let last_sym = *g.taken[0].last().unwrap();
        let m = miss(&g);
        flip2(&mut g, m);
        g.play(Action::Power(Scatter, vec![])).unwrap();
        assert_eq!(g.pairs, [1, 0]);
        assert_eq!(g.cards_left().len(), 14);
        assert_eq!(g.board.iter().filter(|c| **c == Some(last_sym)).count(), 2);
        assert!(g.last.as_ref().unwrap().spots.len() >= 2);
        // With no rival pairs it can't be used.
        let mut h = chaos([[Scatter, Fog, Swap], [Peek, Lock, Mirror]]);
        assert_eq!(h.play(Action::Power(Scatter, vec![])), Err("your rival has no pairs yet"));
        assert!(h.can_power());
    }

    /// Players with perfect memory and random powers always finish, and
    /// every pair ends up with someone.
    #[test]
    fn random_games_always_finish() {
        let sizes = [Size::Small, Size::Medium, Size::Large];
        for seed in 0..300u32 {
            let size = sizes[seed as usize % 3];
            let mut kit_rng = Rng::new(seed.wrapping_mul(31) + 7);
            let mut kit = || {
                let mut all = Power::ALL.to_vec();
                let mut k = vec![];
                for _ in 0..KIT_SIZE {
                    k.push(all.swap_remove(kit_rng.below(all.len() as u32) as usize));
                }
                k
            };
            let mode = if seed % 4 == 0 { Mode::Classic } else { Mode::Chaos };
            let kits = if mode == Mode::Chaos { [kit(), kit()] } else { [vec![], vec![]] };
            let mut g = Game::new(Setup { size, mode, seed, kits }).unwrap();
            let mut rng = Rng::new(seed ^ 0xABCD);
            let mut steps = 0;
            while !g.is_over() {
                steps += 1;
                assert!(steps < 5_000, "seed {seed} didn't finish");
                if g.can_power() && rng.below(4) == 0 {
                    let me = g.turn;
                    let p = g.setup.kits[me][rng.below(3) as usize];
                    let left = g.cards_left();
                    let t = match p.target() {
                        Target::None => vec![],
                        Target::Two if left.len() >= 2 => vec![left[0], left[left.len() - 1]],
                        Target::Two => continue,
                        Target::Block => vec![rng.below((size.rows() - 1) as u32) as usize * size.cols() + rng.below((size.cols() - 1) as u32) as usize],
                        Target::Row => vec![rng.below(size.rows() as u32) as usize],
                    };
                    let _ = g.play(Action::Power(p, t));
                    continue;
                }
                // Flip a random allowed card; half the time "remember" its pair.
                let me = g.turn;
                let allowed: Vec<usize> =
                    g.cards_left().into_iter().filter(|&i| Some(i) != g.up && !g.locked(me).contains(&i)).collect();
                let pick = match g.up {
                    Some(u) if rng.below(2) == 0 => allowed.iter().copied().find(|&i| g.board[i] == g.board[u]).unwrap_or(allowed[0]),
                    _ => allowed[rng.below(allowed.len() as u32) as usize],
                };
                g.play(Action::Flip(pick)).unwrap();
            }
            assert_eq!((g.pairs[0] + g.pairs[1]) as usize, size.pairs(), "seed {seed}");
            let r = Game::replay(g.setup.clone(), &g.move_string()).unwrap();
            assert_eq!((r.pairs, r.outcome()), (g.pairs, g.outcome()));
        }
    }
}
