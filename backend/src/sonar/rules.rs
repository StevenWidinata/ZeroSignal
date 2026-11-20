//! Sonar rules (Battleship-style), shared with the browser through
//! `shared/sonar_rules.json` and checked against `shared/sonar_vectors.json`
//! (the TypeScript copy in `frontend/src/games/sonar/rules.ts` runs the same
//! vectors).
//!
//! - 10×10 grid, cell = row * 10 + column; "a1" is the top-left cell, letters
//!   are columns (a–j) and numbers rows (1–10).
//! - The fleet (5, 4, 3, 3, 2) sits in straight lines that may not overlap or
//!   touch, not even diagonally.
//! - A fleet is written as one bow cell + h/v per ship, in fleet order:
//!   "a1h a3h a5h a7h a9h".
//! - Moves are "f37" (fire at cell 37) or "p44" (sonar ping centred on 44:
//!   how many ship cells are in that 3×3 area). Each side has 2 pings.
//! - Tactics games add one power per ship (air strike, salvo, radar, torpedo,
//!   flare; see `tactics.rs` and `Move`).

use std::sync::OnceLock;

use rand::Rng;
use serde::{Deserialize, Serialize};

use super::tactics::{crate_seed, hide_crates, Item, Setup, Tactics};

const RULES_JSON: &str = include_str!("../../../shared/sonar_rules.json");

pub const SIZE: usize = 10;
pub const CELLS: usize = SIZE * SIZE;

#[derive(Debug, Clone, Deserialize)]
pub struct ShipSpec {
    pub id: String,
    pub name: String,
    pub len: u8,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Rules {
    pub size: usize,
    pub pings: u8,
    pub fleet: Vec<ShipSpec>,
}

pub fn rules() -> &'static Rules {
    static R: OnceLock<Rules> = OnceLock::new();
    R.get_or_init(|| serde_json::from_str(RULES_JSON).expect("shared/sonar_rules.json"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FleetError {
    BadCode,
    WrongCount,
    OffGrid,
    Overlap,
    Touching,
    /// Tactics: a mine on or next to a ship, off the grid, or two on one square.
    BadMine,
    /// Tactics: more mines than allowed.
    TooManyMines,
}

impl FleetError {
    pub fn text(self) -> &'static str {
        match self {
            FleetError::BadCode => "that isn't a fleet (use e.g. a1h a3h a5h a7h a9h)",
            FleetError::WrongCount => "place all 5 ships",
            FleetError::OffGrid => "a ship sticks out of the grid",
            FleetError::Overlap => "two ships overlap",
            FleetError::Touching => "ships can't touch, not even corner to corner",
            FleetError::BadMine => "mines go on open water, not on or next to a ship",
            FleetError::TooManyMines => "too many mines",
        }
    }
}

/// "c7" -> cell 62.
pub fn parse_cell(s: &str) -> Option<usize> {
    let mut chars = s.chars();
    let col = chars.next()?;
    if !('a'..='j').contains(&col) {
        return None;
    }
    let row: usize = chars.as_str().parse().ok()?;
    if !(1..=SIZE).contains(&row) || chars.as_str().starts_with('0') {
        return None;
    }
    Some((row - 1) * SIZE + (col as usize - 'a' as usize))
}

/// Cell 62 -> "c7".
pub fn cell_name(cell: usize) -> String {
    format!("{}{}", (b'a' + (cell % SIZE) as u8) as char, cell / SIZE + 1)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    pub bow: usize,
    pub horizontal: bool,
}

/// A whole fleet, ships in `rules().fleet` order. Tactics fleets also hide
/// up to 2 mines, written after the ships as "m" + square: "… mc7 mh2"
/// (Classic games ignore them).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fleet {
    pub ships: Vec<Placement>,
    pub mines: Vec<usize>,
}

impl Fleet {
    /// Parse and check a fleet code.
    pub fn parse(code: &str) -> Result<Fleet, FleetError> {
        let tokens: Vec<&str> = code.split_whitespace().collect();
        let mut ships = Vec::with_capacity(tokens.len());
        let mut mines = Vec::new();
        for t in &tokens {
            let t = t.to_ascii_lowercase();
            if let Some(m) = t.strip_prefix('m') {
                mines.push(parse_cell(m).ok_or(FleetError::BadCode)?);
                continue;
            }
            if !mines.is_empty() {
                // Mines come after all the ships.
                return Err(FleetError::BadCode);
            }
            let (cell, dir) = t.split_at(t.len().saturating_sub(1));
            let horizontal = match dir {
                "h" => true,
                "v" => false,
                _ => return Err(FleetError::BadCode),
            };
            let bow = parse_cell(cell).ok_or(FleetError::BadCode)?;
            ships.push(Placement { bow, horizontal });
        }
        let f = Fleet { ships, mines };
        f.validate()?;
        Ok(f)
    }

    pub fn code(&self) -> String {
        self.ships
            .iter()
            .map(|p| format!("{}{}", cell_name(p.bow), if p.horizontal { 'h' } else { 'v' }))
            .chain(self.mines.iter().map(|&m| format!("m{}", cell_name(m))))
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// The same ships without mines (what a Classic game uses).
    pub fn without_mines(&self) -> Fleet {
        Fleet { ships: self.ships.clone(), mines: Vec::new() }
    }

    /// The cells of ship `i`, or None if it leaves the grid.
    pub fn ship_cells(&self, i: usize) -> Option<Vec<usize>> {
        ship_cells(self.ships[i], rules().fleet[i].len as usize)
    }

    pub fn validate(&self) -> Result<(), FleetError> {
        if self.ships.len() != rules().fleet.len() {
            return Err(FleetError::WrongCount);
        }
        let mut owner = [usize::MAX; CELLS];
        // Off-grid first, then overlaps, then touching (so errors are stable).
        let mut all = Vec::new();
        for i in 0..self.ships.len() {
            all.push(self.ship_cells(i).ok_or(FleetError::OffGrid)?);
        }
        for (i, cells) in all.iter().enumerate() {
            for &c in cells {
                if owner[c] != usize::MAX {
                    return Err(FleetError::Overlap);
                }
                owner[c] = i;
            }
        }
        for (i, cells) in all.iter().enumerate() {
            for &c in cells {
                for n in neighbours(c) {
                    if owner[n] != usize::MAX && owner[n] != i {
                        return Err(FleetError::Touching);
                    }
                }
            }
        }
        if self.mines.len() > usize::from(super::tactics::tactics_rules().mines) {
            return Err(FleetError::TooManyMines);
        }
        for (i, &m) in self.mines.iter().enumerate() {
            if m >= CELLS || owner[m] != usize::MAX || neighbours(m).any(|n| owner[n] != usize::MAX) || self.mines[..i].contains(&m) {
                return Err(FleetError::BadMine);
            }
        }
        Ok(())
    }

    /// Which ship is on each cell (None = water).
    pub fn occupancy(&self) -> [Option<u8>; CELLS] {
        let mut occ = [None; CELLS];
        for i in 0..self.ships.len() {
            for c in self.ship_cells(i).unwrap_or_default() {
                occ[c] = Some(i as u8);
            }
        }
        occ
    }
}

pub fn ship_cells(p: Placement, len: usize) -> Option<Vec<usize>> {
    let (r, c) = (p.bow / SIZE, p.bow % SIZE);
    if p.bow >= CELLS || (p.horizontal && c + len > SIZE) || (!p.horizontal && r + len > SIZE) {
        return None;
    }
    Some((0..len).map(|k| if p.horizontal { p.bow + k } else { p.bow + k * SIZE }).collect())
}

/// The up-to-8 cells around a cell.
pub fn neighbours(cell: usize) -> impl Iterator<Item = usize> {
    let (r, c) = ((cell / SIZE) as i32, (cell % SIZE) as i32);
    (-1..=1)
        .flat_map(move |dr| (-1..=1).map(move |dc| (r + dr, c + dc)))
        .filter(move |&(rr, cc)| (rr, cc) != (r, c) && (0..SIZE as i32).contains(&rr) && (0..SIZE as i32).contains(&cc))
        .map(|(rr, cc)| rr as usize * SIZE + cc as usize)
}

/// The 3×3 area a ping covers (clipped at the edges).
pub fn ping_area(center: usize) -> Vec<usize> {
    let mut v: Vec<usize> = neighbours(center).collect();
    v.push(center);
    v.sort_unstable();
    v
}

/// A random legal fleet (tries ships one by one, starts over if one won't fit).
pub fn random_fleet(rng: &mut impl Rng) -> Fleet {
    let specs = &rules().fleet;
    'again: loop {
        let mut ships: Vec<Placement> = Vec::new();
        for spec in specs {
            let mut placed = false;
            for _ in 0..200 {
                let p = Placement { bow: rng.gen_range(0..CELLS), horizontal: rng.gen_bool(0.5) };
                if ship_cells(p, spec.len as usize).is_none() {
                    continue;
                }
                ships.push(p);
                if (Fleet { ships: ships.clone(), mines: Vec::new() }).partial_ok() {
                    placed = true;
                    break;
                }
                ships.pop();
            }
            if !placed {
                continue 'again;
            }
        }
        return Fleet { ships, mines: Vec::new() };
    }
}

impl Fleet {
    /// No overlaps or touching among the ships placed so far.
    fn partial_ok(&self) -> bool {
        let mut owner = [usize::MAX; CELLS];
        for (i, &p) in self.ships.iter().enumerate() {
            let Some(cells) = ship_cells(p, rules().fleet[i].len as usize) else { return false };
            for c in cells {
                if owner[c] != usize::MAX {
                    return false;
                }
                owner[c] = i;
            }
        }
        for c in 0..CELLS {
            if owner[c] == usize::MAX {
                continue;
            }
            if neighbours(c).any(|nb| owner[nb] != usize::MAX && owner[nb] != owner[c]) {
                return false;
            }
        }
        true
    }
}

/// What the shooter knows about a cell of the other side's sea.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Mark {
    Unknown,
    Miss,
    Hit,
    /// Part of a sunk ship (its fleet index).
    Sunk(u8),
    /// Water next to a sunk ship (ships can't touch, so it's known empty),
    /// or water lit up by a flare.
    Empty,
    /// Tactics: a ship square seen (by a flare, a mine or a shield) but not hit yet.
    Spotted,
    /// Tactics: a mine found (set off, or seen by a flare). Harmless now.
    Mine,
    /// Tactics: a supply crate seen by a flare, still there to shoot.
    CrateSeen,
    /// Tactics: an opened supply crate (water).
    Crate,
}

impl Mark {
    /// One letter per square, as sent to the browser: '.' unknown, 'o' miss,
    /// 'x' hit, 's' sunk ship, '-' known water, '*' spotted ship, 'm' mine,
    /// '+' crate seen, 'c' opened crate.
    pub fn ch(self) -> char {
        match self {
            Mark::Unknown => '.',
            Mark::Miss => 'o',
            Mark::Hit => 'x',
            Mark::Sunk(_) => 's',
            Mark::Empty => '-',
            Mark::Spotted => '*',
            Mark::Mine => 'm',
            Mark::CrateSeen => '+',
            Mark::Crate => 'c',
        }
    }

    /// Squares you can still fire at.
    pub fn open(self) -> bool {
        matches!(self, Mark::Unknown | Mark::Spotted | Mark::CrateSeen)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum ShotResult {
    Miss,
    Hit,
    Sunk { ship: u8 },
    Ping { count: u8 },
    /// Tactics: ship squares in a radar line.
    Radar { count: u8 },
    /// Tactics: a flare shows a ship here.
    Seen,
    /// Tactics: a flare shows water here.
    Clear,
    /// Tactics: a torpedo that ran off the far edge (reported at its last square).
    Dud,
    /// Tactics: you set off a mine (one of your ship squares is shown to its owner).
    Mine,
    /// Tactics: a flare shows a mine (now harmless).
    MineSeen,
    /// Tactics: you opened a supply crate.
    Crate { item: Item },
    /// Tactics: a flare shows a supply crate.
    CrateSeen,
    /// Tactics: a shield stopped the shot (but a ship is there).
    Blocked,
    /// Tactics, your own sea: a mine you set off showed this ship square.
    Exposed,
    /// Tactics, your own sea: a repair kit fixed this square.
    Repaired,
    /// Tactics: Overdrive charged this power.
    Charged { power: u8 },
}

impl ShotResult {
    /// Short form used by the shared test vectors: miss, hit, sunk:destroyer, ping:3, radar:2, seen, clear, dud.
    pub fn short(self) -> String {
        match self {
            ShotResult::Miss => "miss".into(),
            ShotResult::Hit => "hit".into(),
            ShotResult::Sunk { ship } => format!("sunk:{}", rules().fleet[ship as usize].id),
            ShotResult::Ping { count } => format!("ping:{count}"),
            ShotResult::Radar { count } => format!("radar:{count}"),
            ShotResult::Seen => "seen".into(),
            ShotResult::Clear => "clear".into(),
            ShotResult::Dud => "dud".into(),
            ShotResult::Mine => "mine".into(),
            ShotResult::MineSeen => "mine_seen".into(),
            ShotResult::Crate { item } => format!("crate:{}", item.id()),
            ShotResult::CrateSeen => "crate_seen".into(),
            ShotResult::Blocked => "blocked".into(),
            ShotResult::Exposed => "exposed".into(),
            ShotResult::Repaired => "repaired".into(),
            ShotResult::Charged { power } => format!("charged:{}", super::tactics::tactics_rules().powers[usize::from(power)].id),
        }
    }

    /// Hit or sunk: counts for a combo.
    pub fn struck(self) -> bool {
        matches!(self, ShotResult::Hit | ShotResult::Sunk { .. })
    }

    /// How much a result matters, for picking a move's headline result.
    fn weight(self) -> u8 {
        match self {
            ShotResult::Sunk { .. } => 6,
            ShotResult::Hit => 5,
            ShotResult::Crate { .. } | ShotResult::Mine => 4,
            ShotResult::Blocked | ShotResult::Seen | ShotResult::CrateSeen | ShotResult::MineSeen => 3,
            ShotResult::Ping { .. } | ShotResult::Radar { .. } | ShotResult::Charged { .. } => 2,
            ShotResult::Clear | ShotResult::Miss => 1,
            ShotResult::Dud | ShotResult::Exposed | ShotResult::Repaired => 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShotError {
    BadMove,
    AlreadyKnown,
    NoPingsLeft,
    Over,
    /// A power move in a Classic game.
    NotTactics,
    /// The power is still charging.
    NotReady,
    /// The ship with that power has sunk.
    PowerLost,
    /// Overdrive isn't full.
    NoOverdrive,
    /// Overdrive on a power that is already charged.
    AlreadyReady,
}

impl ShotError {
    pub fn text(self) -> &'static str {
        match self {
            ShotError::BadMove => "that isn't a square on the grid",
            ShotError::AlreadyKnown => "you already know what's there",
            ShotError::NoPingsLeft => "no sonar pings left",
            ShotError::Over => "this game is over",
            ShotError::NotTactics => "ship powers are only in Tactics games",
            ShotError::NotReady => "that power is still charging",
            ShotError::PowerLost => "that ship has sunk, so its power is gone",
            ShotError::NoOverdrive => "Overdrive isn't full yet",
            ShotError::AlreadyReady => "that power is already charged",
        }
    }

    /// Short form used by the shared test vectors (same names as the browser's).
    pub fn code(self) -> &'static str {
        match self {
            ShotError::BadMove => "bad_move",
            ShotError::AlreadyKnown => "already_known",
            ShotError::NoPingsLeft => "no_pings_left",
            ShotError::Over => "over",
            ShotError::NotTactics => "not_tactics",
            ShotError::NotReady => "not_ready",
            ShotError::PowerLost => "power_lost",
            ShotError::NoOverdrive => "no_overdrive",
            ShotError::AlreadyReady => "already_ready",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Ping {
    pub center: usize,
    pub count: u8,
}

/// Tactics: a radar sweep of a whole row (`row`) or column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Sweep {
    pub line: u8,
    pub row: bool,
    pub count: u8,
}

/// Where a torpedo starts: from the left edge along a row, the right edge,
/// the top edge down a column, or the bottom edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    Left,
    Right,
    Top,
    Bottom,
}

impl Edge {
    fn ch(self) -> char {
        match self {
            Edge::Left => 'l',
            Edge::Right => 'r',
            Edge::Top => 'u',
            Edge::Bottom => 'd',
        }
    }
    fn parse(c: &str) -> Option<Edge> {
        match c {
            "l" => Some(Edge::Left),
            "r" => Some(Edge::Right),
            "u" => Some(Edge::Top),
            "d" => Some(Edge::Bottom),
            _ => None,
        }
    }
    /// Left and top are the Mk I edges; right and bottom need Mk III.
    pub fn basic(self) -> bool {
        matches!(self, Edge::Left | Edge::Top)
    }
}

/// One side's sea as the other side fires at it.
#[derive(Debug, Clone)]
pub struct Sea {
    occ: [Option<u8>; CELLS],
    lens: Vec<u8>,
    pub marks: [Mark; CELLS],
    hits: Vec<u8>,
    pub pings: Vec<Ping>,
    /// Tactics: radar sweeps so far.
    pub sweeps: Vec<Sweep>,
    /// Tactics: this ship doesn't show in pings or radar while afloat.
    silent: Option<u8>,
    /// Tactics: mines still armed.
    mines: Vec<usize>,
    /// Tactics: hidden supply crates (square, item) not opened yet.
    crates: Vec<(usize, Item)>,
    /// Tactics: extra pings the shooter found in crates in this sea.
    pub bonus_pings: u8,
    /// Tactics: shields guarding this sea's ships.
    pub shields: u8,
    /// Shots and pings so far.
    pub moves: Vec<String>,
}

/// Every move. Classic games only use Fire and Ping; the rest are Tactics
/// ship powers (see `tactics.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Move {
    /// "f37"
    Fire(usize),
    /// "p44"
    Ping(usize),
    /// "a12h": squares from `cell` to the right (h) or down (v).
    AirStrike { cell: usize, horizontal: bool },
    /// "b12.40" (or 3 cells at Mk II+): `n` shots in one turn.
    Salvo { cells: [usize; 3], n: u8 },
    /// "r3" sweeps row 3 (the 4th row), "k3" column 3.
    Radar { line: usize, row: bool },
    /// "t3l": along row 3 from the left edge (l/r rows, u/d columns).
    Torpedo { line: usize, edge: Edge },
    /// "l45": lights up around 45.
    Flare(usize),
    /// "o2": spend Overdrive to charge power 2 now (keeps the turn).
    Overdrive(usize),
}

impl Move {
    pub fn parse(s: &str) -> Option<Move> {
        let (k, rest) = s.split_at(1.min(s.len()));
        let num = |t: &str| -> Option<usize> { t.parse().ok().filter(|_| !t.is_empty() && t.bytes().all(|b| b.is_ascii_digit())) };
        let cell = |t: &str| num(t).filter(|&c| c < CELLS);
        let line = |t: &str| num(t).filter(|&l| l < SIZE);
        match k {
            "f" => Some(Move::Fire(cell(rest)?)),
            "p" => Some(Move::Ping(cell(rest)?)),
            "l" => Some(Move::Flare(cell(rest)?)),
            "o" => Some(Move::Overdrive(num(rest).filter(|&p| p < super::tactics::POWERS)?)),
            "r" => Some(Move::Radar { line: line(rest)?, row: true }),
            "k" => Some(Move::Radar { line: line(rest)?, row: false }),
            "a" | "t" if !rest.is_empty() => {
                let (n, d) = rest.split_at(rest.len() - 1);
                if k == "a" {
                    let horizontal = match d {
                        "h" => true,
                        "v" => false,
                        _ => return None,
                    };
                    Some(Move::AirStrike { cell: cell(n)?, horizontal })
                } else {
                    Some(Move::Torpedo { line: line(n)?, edge: Edge::parse(d)? })
                }
            }
            "b" => {
                let parts: Vec<&str> = rest.split('.').collect();
                if !(2..=3).contains(&parts.len()) {
                    return None;
                }
                let mut cells = [0; 3];
                for (i, p) in parts.iter().enumerate() {
                    cells[i] = cell(p)?;
                }
                Some(Move::Salvo { cells, n: parts.len() as u8 })
            }
            _ => None,
        }
    }

    pub fn code(self) -> String {
        match self {
            Move::Fire(c) => format!("f{c}"),
            Move::Ping(c) => format!("p{c}"),
            Move::AirStrike { cell, horizontal } => format!("a{cell}{}", if horizontal { 'h' } else { 'v' }),
            Move::Salvo { cells, n } => format!("b{}", cells[..n as usize].iter().map(usize::to_string).collect::<Vec<_>>().join(".")),
            Move::Radar { line, row } => format!("{}{line}", if row { 'r' } else { 'k' }),
            Move::Torpedo { line, edge } => format!("t{line}{}", edge.ch()),
            Move::Flare(c) => format!("l{c}"),
            Move::Overdrive(p) => format!("o{p}"),
        }
    }

    /// The Tactics power this move uses (fleet index of its ship), if any.
    pub fn power(self) -> Option<usize> {
        use super::tactics::{AIR_STRIKE, FLARE, RADAR, SALVO, TORPEDO};
        match self {
            Move::Fire(_) | Move::Ping(_) | Move::Overdrive(_) => None,
            Move::AirStrike { .. } => Some(AIR_STRIKE),
            Move::Salvo { .. } => Some(SALVO),
            Move::Radar { .. } => Some(RADAR),
            Move::Torpedo { .. } => Some(TORPEDO),
            Move::Flare(_) => Some(FLARE),
        }
    }

    /// The square a move is shown at (a ping's centre, a line's first square).
    pub fn cell(self) -> usize {
        match self {
            Move::Fire(c) | Move::Ping(c) | Move::Flare(c) | Move::AirStrike { cell: c, .. } => c,
            Move::Salvo { cells, .. } => cells[0],
            Move::Radar { line, row } => line_cells(line, row)[0],
            Move::Torpedo { line, edge } => torpedo_path(line, edge)[0],
            Move::Overdrive(_) => 0,
        }
    }

    /// Moves that fire shots (they count for combos).
    pub fn fires(self) -> bool {
        matches!(self, Move::Fire(_) | Move::AirStrike { .. } | Move::Salvo { .. } | Move::Torpedo { .. })
    }
}

/// The squares of row `line` (`row`) or column `line`, in order.
pub fn line_cells(line: usize, row: bool) -> Vec<usize> {
    (0..SIZE).map(|k| if row { line * SIZE + k } else { k * SIZE + line }).collect()
}

/// The squares a torpedo runs through, in order.
pub fn torpedo_path(line: usize, edge: Edge) -> Vec<usize> {
    let mut v = line_cells(line, matches!(edge, Edge::Left | Edge::Right));
    if matches!(edge, Edge::Right | Edge::Bottom) {
        v.reverse();
    }
    v
}

/// The squares a flare lights: a + shape (size 5) or the 3×3 area (size 9), clipped.
pub fn flare_area(center: usize, size: u8) -> Vec<usize> {
    if size >= 9 {
        return ping_area(center);
    }
    let mut v: Vec<usize> = neighbours(center).filter(|&n| n / SIZE == center / SIZE || n % SIZE == center % SIZE).collect();
    v.push(center);
    v.sort_unstable();
    v
}

impl Sea {
    pub fn new(fleet: &Fleet) -> Sea {
        Sea {
            occ: fleet.occupancy(),
            lens: rules().fleet.iter().map(|s| s.len).collect(),
            marks: [Mark::Unknown; CELLS],
            hits: vec![0; fleet.ships.len()],
            pings: Vec::new(),
            sweeps: Vec::new(),
            silent: None,
            mines: Vec::new(),
            crates: Vec::new(),
            bonus_pings: 0,
            shields: 0,
            moves: Vec::new(),
        }
    }

    /// A Tactics sea: the submarine runs silent, the fleet's mines are armed
    /// and `crates` are hidden (see `tactics::hide_crates`).
    pub fn new_tactics(fleet: &Fleet, crates: Vec<(usize, Item)>) -> Sea {
        Sea { silent: Some(super::tactics::SILENT_SHIP), mines: fleet.mines.clone(), crates, ..Sea::new(fleet) }
    }

    pub fn pings_left(&self) -> u8 {
        (rules().pings + self.bonus_pings).saturating_sub(self.pings.len() as u8)
    }

    pub fn all_sunk(&self) -> bool {
        self.hits.iter().zip(&self.lens).all(|(h, l)| h == l)
    }

    pub fn is_sunk(&self, ship: usize) -> bool {
        self.hits[ship] == self.lens[ship]
    }

    pub fn sunk_ships(&self) -> Vec<u8> {
        (0..self.lens.len() as u8).filter(|&i| self.hits[i as usize] == self.lens[i as usize]).collect()
    }

    /// Shots fired + pings used.
    pub fn shots(&self) -> usize {
        self.moves.len()
    }

    /// Ship squares in `cells` that pings and radar can hear (a silent sub can't be heard).
    fn heard(&self, cells: &[usize]) -> u8 {
        cells
            .iter()
            .filter(|&&c| match self.occ[c] {
                Some(s) => self.silent != Some(s) || self.is_sunk(s as usize),
                None => false,
            })
            .count() as u8
    }

    /// Fire at an open square.
    fn fire_at(&mut self, cell: usize) -> ShotResult {
        if let Some(i) = self.mines.iter().position(|&m| m == cell) {
            self.mines.remove(i);
            self.marks[cell] = Mark::Mine;
            return ShotResult::Mine;
        }
        if let Some(i) = self.crates.iter().position(|&(c, _)| c == cell) {
            let (_, item) = self.crates.remove(i);
            self.marks[cell] = Mark::Crate;
            return ShotResult::Crate { item };
        }
        match self.occ[cell] {
            None => {
                self.marks[cell] = Mark::Miss;
                ShotResult::Miss
            }
            Some(_) if self.shields > 0 => {
                self.shields -= 1;
                self.marks[cell] = Mark::Spotted;
                ShotResult::Blocked
            }
            Some(ship) => {
                let s = ship as usize;
                self.hits[s] += 1;
                self.marks[cell] = Mark::Hit;
                if self.hits[s] < self.lens[s] {
                    return ShotResult::Hit;
                }
                // Reveal the ship and the water around it.
                for c in 0..CELLS {
                    if self.occ[c] == Some(ship) {
                        self.marks[c] = Mark::Sunk(ship);
                    }
                }
                for c in 0..CELLS {
                    if self.occ[c] == Some(ship) {
                        for n in neighbours(c) {
                            if self.marks[n] == Mark::Unknown {
                                self.marks[n] = Mark::Empty;
                            }
                        }
                    }
                }
                ShotResult::Sunk { ship }
            }
        }
    }

    /// Play a classic move (a shot or a ping) and get its result.
    pub fn play(&mut self, m: Move) -> Result<ShotResult, ShotError> {
        if m.power().is_some() {
            return Err(ShotError::NotTactics);
        }
        Ok(self.strike(m, 0)?[0].1)
    }

    /// Play any move; `size` is the power's size at the shooter's Mk level
    /// (see `tactics.rs`; unused for shots and pings). Checks everything
    /// before changing anything, then returns (square, result) for each
    /// square the move touched. Whether the shooter may use the power at all
    /// is the duel's job.
    pub fn strike(&mut self, m: Move, size: u8) -> Result<Vec<(usize, ShotResult)>, ShotError> {
        if self.all_sunk() {
            return Err(ShotError::Over);
        }
        let out = match m {
            Move::Fire(cell) => {
                if cell >= CELLS {
                    return Err(ShotError::BadMove);
                }
                if !self.marks[cell].open() {
                    return Err(ShotError::AlreadyKnown);
                }
                vec![(cell, self.fire_at(cell))]
            }
            Move::Ping(center) => {
                if center >= CELLS {
                    return Err(ShotError::BadMove);
                }
                if self.pings_left() == 0 {
                    return Err(ShotError::NoPingsLeft);
                }
                let count = self.heard(&ping_area(center));
                self.pings.push(Ping { center, count });
                vec![(center, ShotResult::Ping { count })]
            }
            Move::AirStrike { cell, horizontal } => {
                let cells = ship_cells(Placement { bow: cell, horizontal }, usize::from(size)).ok_or(ShotError::BadMove)?;
                if !cells.iter().any(|&c| self.marks[c].open()) {
                    return Err(ShotError::AlreadyKnown);
                }
                // A sinking can turn a later square into known water: skip it then.
                let mut v = Vec::new();
                for c in cells {
                    if self.marks[c].open() {
                        v.push((c, self.fire_at(c)));
                    }
                }
                v
            }
            Move::Salvo { cells, n } => {
                let cells = &cells[..usize::from(n)];
                if n != size {
                    return Err(ShotError::BadMove);
                }
                if cells.iter().enumerate().any(|(i, c)| cells[..i].contains(c)) {
                    return Err(ShotError::BadMove);
                }
                if cells.iter().any(|&c| !self.marks[c].open()) {
                    return Err(ShotError::AlreadyKnown);
                }
                let mut v = Vec::new();
                for &c in cells {
                    if self.marks[c].open() {
                        v.push((c, self.fire_at(c)));
                    }
                }
                v
            }
            Move::Radar { line, row } => {
                let cells = line_cells(line, row);
                let count = self.heard(&cells);
                self.sweeps.push(Sweep { line: line as u8, row, count });
                vec![(cells[0], ShotResult::Radar { count })]
            }
            Move::Torpedo { line, edge } => {
                let path = torpedo_path(line, edge);
                // The first ship square that isn't hit yet takes it.
                match path.iter().copied().find(|&c| self.occ[c].is_some() && self.marks[c].open()) {
                    Some(c) => vec![(c, self.fire_at(c))],
                    None => vec![(path[SIZE - 1], ShotResult::Dud)],
                }
            }
            Move::Overdrive(_) => return Err(ShotError::BadMove),
            Move::Flare(center) => {
                let area = flare_area(center, size);
                if !area.iter().any(|&c| self.marks[c] == Mark::Unknown) {
                    return Err(ShotError::AlreadyKnown);
                }
                let mut v = Vec::new();
                for c in area {
                    if self.marks[c] != Mark::Unknown {
                        continue;
                    }
                    if self.occ[c].is_some() {
                        self.marks[c] = Mark::Spotted;
                        v.push((c, ShotResult::Seen));
                    } else if let Some(i) = self.mines.iter().position(|&m| m == c) {
                        self.mines.remove(i);
                        self.marks[c] = Mark::Mine;
                        v.push((c, ShotResult::MineSeen));
                    } else if self.crates.iter().any(|&(x, _)| x == c) {
                        self.marks[c] = Mark::CrateSeen;
                        v.push((c, ShotResult::CrateSeen));
                    } else {
                        self.marks[c] = Mark::Empty;
                        v.push((c, ShotResult::Clear));
                    }
                }
                v
            }
        };
        self.moves.push(m.code());
        Ok(out)
    }

    /// Replay a classic move list ("f37 p44 …") against a fleet.
    pub fn replay(fleet: &Fleet, moves: &str) -> Result<(Sea, Vec<ShotResult>), ShotError> {
        let mut sea = Sea::new(fleet);
        let mut results = Vec::new();
        for t in moves.split_whitespace() {
            let m = Move::parse(t).ok_or(ShotError::BadMove)?;
            results.push(sea.play(m)?);
        }
        Ok((sea, results))
    }

    /// Ship cells that are still afloat and unhit (for showing your own fleet).
    pub fn ship_at(&self, cell: usize) -> Option<u8> {
        self.occ[cell]
    }

    /// A mine went off: show one ship square the other side doesn't know yet
    /// (`pick(n)` chooses 0..n). Returns the square, if any was left.
    fn expose(&mut self, pick: impl FnOnce(usize) -> usize) -> Option<usize> {
        let hidden: Vec<usize> = (0..CELLS).filter(|&c| self.occ[c].is_some() && self.marks[c] == Mark::Unknown).collect();
        if hidden.is_empty() {
            return None;
        }
        let c = hidden[pick(hidden.len())];
        self.marks[c] = Mark::Spotted;
        Some(c)
    }

    /// A repair kit: fix the first hit square (it goes back to "spotted"), or
    /// None if no ship afloat is hit.
    fn repair(&mut self) -> Option<usize> {
        let c = (0..CELLS).find(|&c| self.marks[c] == Mark::Hit)?;
        if let Some(s) = self.occ[c] {
            self.hits[usize::from(s)] -= 1;
        }
        self.marks[c] = Mark::Spotted;
        Some(c)
    }
}

/// One move in a duel and what it did, square by square.
#[derive(Debug, Clone)]
pub struct Turn {
    pub side: usize,
    pub mv: Move,
    /// What happened in the other side's sea.
    pub results: Vec<(usize, ShotResult)>,
    /// Tactics: what happened in the mover's own sea (a mine showed a ship
    /// square, a repair kit fixed one).
    pub own: Vec<(usize, ShotResult)>,
}

impl Turn {
    /// The result that matters most (a sinking beats a hit beats a miss).
    pub fn main(&self) -> ShotResult {
        self.results.iter().map(|&(_, r)| r).max_by_key(|r| r.weight()).unwrap_or(ShotResult::Miss)
    }
}

/// Two sides firing in turn. Side 0 and side 1; `first` moves first. Every
/// move (a ping too) passes the turn, except in Tactics an Extra shot crate
/// and spending Overdrive, which keep it.
/// `log` holds both sides' moves in order; side s fires at the other side's
/// fleet. A Tactics duel (`tactics` is set) also allows ship powers.
#[derive(Debug, Clone)]
pub struct Duel {
    /// seas[s] = side s's own sea (what the other side fires at).
    pub seas: [Sea; 2],
    /// The side to move now.
    next: usize,
    pub log: Vec<Turn>,
    pub tactics: Option<Tactics>,
    /// Tactics: picks which ship square a mine shows.
    seed: u32,
}

impl Duel {
    pub fn new(fleets: [&Fleet; 2], first: usize) -> Duel {
        Duel { seas: [Sea::new(fleets[0]), Sea::new(fleets[1])], next: first, log: Vec::new(), tactics: None, seed: 0 }
    }

    /// A Tactics duel (Mk levels, crates and the seed come from `setup`).
    pub fn new_tactics(fleets: [&Fleet; 2], first: usize, setup: Setup) -> Duel {
        let sea = |s: usize| Sea::new_tactics(fleets[s], hide_crates(fleets[s], crate_seed(setup.seed, s), setup.crates));
        Duel { seas: [sea(0), sea(1)], next: first, log: Vec::new(), tactics: Some(Tactics::new(setup.levels)), seed: setup.seed }
    }

    pub fn replay(fleets: [&Fleet; 2], first: usize, moves: &str) -> Result<Duel, ShotError> {
        Duel::new(fleets, first).replayed(moves)
    }

    pub fn replay_tactics(fleets: [&Fleet; 2], first: usize, setup: Setup, moves: &str) -> Result<Duel, ShotError> {
        Duel::new_tactics(fleets, first, setup).replayed(moves)
    }

    fn replayed(mut self, moves: &str) -> Result<Duel, ShotError> {
        for t in moves.split_whitespace() {
            let m = Move::parse(t).ok_or(ShotError::BadMove)?;
            self.play(m)?;
        }
        Ok(self)
    }

    /// The side whose turn it is.
    pub fn to_move(&self) -> usize {
        self.next
    }

    /// The side that sank the other fleet, if any.
    pub fn winner(&self) -> Option<usize> {
        (0..2).find(|&s| self.seas[1 - s].all_sunk())
    }

    /// Play the next move; returns its headline result (see `Turn::main`).
    pub fn play(&mut self, m: Move) -> Result<ShotResult, ShotError> {
        if self.winner().is_some() {
            return Err(ShotError::Over);
        }
        let side = self.to_move();
        if let Move::Overdrive(p) = m {
            let t = self.tactics.as_mut().ok_or(ShotError::NotTactics)?;
            if !t.overdrive[side] {
                return Err(ShotError::NoOverdrive);
            }
            if self.seas[side].is_sunk(p) {
                return Err(ShotError::PowerLost);
            }
            if t.ready(side, p) {
                return Err(ShotError::AlreadyReady);
            }
            t.spend_overdrive(side, p);
            let r = ShotResult::Charged { power: p as u8 };
            // A free action: the turn stays.
            self.log.push(Turn { side, mv: m, results: vec![(0, r)], own: Vec::new() });
            return Ok(r);
        }
        let power = m.power();
        let mut size = 0;
        if let Some(p) = power {
            let t = self.tactics.as_ref().ok_or(ShotError::NotTactics)?;
            if self.seas[side].is_sunk(p) {
                return Err(ShotError::PowerLost);
            }
            if !t.ready(side, p) {
                return Err(ShotError::NotReady);
            }
            size = t.spec(side, p).size;
            if let Move::Torpedo { edge, .. } = m {
                if size < 4 && !edge.basic() {
                    return Err(ShotError::BadMove);
                }
            }
        }
        let results = self.seas[1 - side].strike(m, size)?;
        let mut own = Vec::new();
        let mut extra_turn = false;
        for &(_, r) in &results {
            match r {
                ShotResult::Mine => {
                    let salt = 0x5EED_0000u32.wrapping_add(self.log.len() as u32);
                    let mut rng = crate::rng::Rng::new(self.seed ^ salt);
                    if let Some(c) = self.seas[side].expose(|n| rng.below(n as u32) as usize) {
                        own.push((c, ShotResult::Exposed));
                    }
                }
                ShotResult::Crate { item } => match item {
                    Item::Ping => self.seas[1 - side].bonus_pings += 1,
                    Item::Shield => self.seas[side].shields += 1,
                    Item::Repair => match self.seas[side].repair() {
                        Some(c) => own.push((c, ShotResult::Repaired)),
                        None => self.seas[side].shields += 1,
                    },
                    Item::ExtraShot => extra_turn = true,
                },
                _ => {}
            }
        }
        if let Some(t) = self.tactics.as_mut() {
            t.after_move(side, power);
            if m.fires() {
                t.after_firing(side, results.iter().any(|&(_, r)| r.struck()));
            }
        }
        let turn = Turn { side, mv: m, results, own };
        let main = turn.main();
        self.log.push(turn);
        self.next = if extra_turn { side } else { 1 - side };
        Ok(main)
    }

    pub fn move_string(&self) -> String {
        self.log.iter().map(|t| t.mv.code()).collect::<Vec<_>>().join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    const VECTORS: &str = include_str!("../../../shared/sonar_vectors.json");

    #[derive(Deserialize)]
    struct FleetCase {
        code: String,
        error: Option<String>,
    }
    #[derive(Deserialize)]
    struct GameCase {
        fleet: String,
        moves: String,
        results: Vec<String>,
        all_sunk: bool,
    }
    #[derive(Deserialize)]
    struct DuelCase {
        fleets: [String; 2],
        first: usize,
        moves: String,
        results: Vec<String>,
        next: usize,
        winner: Option<usize>,
    }
    #[derive(Deserialize)]
    struct TacticsCase {
        about: String,
        fleets: [String; 2],
        first: usize,
        levels: Option<[crate::sonar::tactics::Levels; 2]>,
        #[serde(default)]
        seed: u32,
        #[serde(default)]
        crates: u8,
        moves: String,
        /// Per move: "cell:result,cell:result".
        results: Vec<String>,
        /// The last move's error, if it fails.
        error: Option<String>,
        next: usize,
        winner: Option<usize>,
        charge: Option<[[u8; 5]; 2]>,
        /// Per move: effects in the mover's own sea (checked when given).
        own: Option<Vec<String>>,
        combo: Option<[u8; 2]>,
        overdrive: Option<[bool; 2]>,
        /// Per sea: mark letter -> squares (the rest unknown).
        marks: [std::collections::BTreeMap<char, Vec<usize>>; 2],
    }
    #[derive(Deserialize)]
    struct Vectors {
        fleets: Vec<FleetCase>,
        games: Vec<GameCase>,
        duels: Vec<DuelCase>,
        tactics: Vec<TacticsCase>,
    }

    #[test]
    fn rules_file_matches_the_constants() {
        assert_eq!(rules().size, SIZE);
        assert_eq!(rules().fleet.iter().map(|s| s.len).collect::<Vec<_>>(), vec![5, 4, 3, 3, 2]);
        assert_eq!(rules().pings, 2);
    }

    #[test]
    fn cells_and_names() {
        assert_eq!(parse_cell("a1"), Some(0));
        assert_eq!(parse_cell("c7"), Some(62));
        assert_eq!(parse_cell("j10"), Some(99));
        assert_eq!(parse_cell("k1"), None);
        assert_eq!(parse_cell("a11"), None);
        assert_eq!(parse_cell("a01"), None);
        for c in 0..CELLS {
            assert_eq!(parse_cell(&cell_name(c)), Some(c));
        }
        assert_eq!(ping_area(0), vec![0, 1, 10, 11]);
        assert_eq!(ping_area(55).len(), 9);
    }

    #[test]
    fn shared_vectors() {
        let v: Vectors = serde_json::from_str(VECTORS).unwrap();
        for f in &v.fleets {
            let got = Fleet::parse(&f.code).err().map(|e| serde_json::to_value(e).unwrap().as_str().unwrap().to_string());
            assert_eq!(got, f.error, "fleet {}", f.code);
        }
        for g in &v.games {
            let fleet = Fleet::parse(&g.fleet).unwrap();
            let (sea, results) = Sea::replay(&fleet, &g.moves).unwrap();
            assert_eq!(results.iter().map(|r| r.short()).collect::<Vec<_>>(), g.results, "game {}", g.moves);
            assert_eq!(sea.all_sunk(), g.all_sunk);
        }
        for c in &v.duels {
            let a = Fleet::parse(&c.fleets[0]).unwrap();
            let b = Fleet::parse(&c.fleets[1]).unwrap();
            let d = Duel::replay([&a, &b], c.first, &c.moves).unwrap();
            assert_eq!(d.log.iter().map(|t| t.main().short()).collect::<Vec<_>>(), c.results, "duel {}", c.moves);
            assert_eq!(d.to_move(), c.next, "duel {}", c.moves);
            assert_eq!(d.winner(), c.winner, "duel {}", c.moves);
            assert_eq!(d.move_string(), c.moves);
        }
    }

    #[test]
    fn shared_tactics_vectors() {
        let v: Vectors = serde_json::from_str(VECTORS).unwrap();
        for c in &v.tactics {
            let a = Fleet::parse(&c.fleets[0]).unwrap();
            let b = Fleet::parse(&c.fleets[1]).unwrap();
            let mut d = match c.levels {
                Some(levels) => Duel::new_tactics([&a, &b], c.first, Setup { levels, seed: c.seed, crates: c.crates }),
                None => Duel::new([&a, &b], c.first),
            };
            let tokens: Vec<&str> = c.moves.split_whitespace().collect();
            let mut error = None;
            for (i, t) in tokens.iter().enumerate() {
                if let Err(e) = d.play(Move::parse(t).unwrap_or_else(|| panic!("{}: can't parse {t}", c.about))) {
                    assert_eq!(i, tokens.len() - 1, "{}: only the last move may fail ({t}: {})", c.about, e.code());
                    error = Some(e.code().to_string());
                }
            }
            let got: Vec<String> = d
                .log
                .iter()
                .map(|t| t.results.iter().map(|(cell, r)| format!("{cell}:{}", r.short())).collect::<Vec<_>>().join(","))
                .collect();
            assert_eq!(got, c.results, "{}", c.about);
            let own: Vec<String> = d
                .log
                .iter()
                .map(|t| t.own.iter().map(|(cell, r)| format!("{cell}:{}", r.short())).collect::<Vec<_>>().join(","))
                .collect();
            match &c.own {
                Some(want) => assert_eq!(&own, want, "{}: own seas", c.about),
                None => assert!(own.iter().all(String::is_empty), "{}: own seas", c.about),
            }
            if let Some(combo) = c.combo {
                assert_eq!(d.tactics.as_ref().unwrap().combo, combo, "{}", c.about);
            }
            if let Some(o) = c.overdrive {
                assert_eq!(d.tactics.as_ref().unwrap().overdrive, o, "{}", c.about);
            }
            assert_eq!(error, c.error, "{}", c.about);
            assert_eq!(d.to_move(), c.next, "{}", c.about);
            assert_eq!(d.winner(), c.winner, "{}", c.about);
            assert_eq!(d.tactics.as_ref().map(|t| t.charge), c.charge, "{}", c.about);
            for s in 0..2 {
                let mut want = ['.'; CELLS];
                for (&ch, cells) in &c.marks[s] {
                    for &cell in cells {
                        want[cell] = ch;
                    }
                }
                let got: String = d.seas[s].marks.iter().map(|m| m.ch()).collect();
                assert_eq!(got, want.iter().collect::<String>(), "{}: sea {s}", c.about);
            }
            // Replaying the moves played so far gives the same duel.
            if let Some(levels) = c.levels {
                let again = Duel::replay_tactics([&a, &b], c.first, Setup { levels, seed: c.seed, crates: c.crates }, &d.move_string()).unwrap();
                assert_eq!(again.tactics, d.tactics);
            }
        }
    }

    #[test]
    fn move_codes_round_trip() {
        for code in ["f0", "p99", "a12h", "a90v", "b1.2", "b1.2.3", "r0", "k9", "t3l", "t3r", "t0u", "t9d", "l45", "o0", "o4"] {
            assert_eq!(Move::parse(code).map(|m| m.code()).as_deref(), Some(code));
        }
        for bad in ["", "f", "f100", "f+3", "a12", "a12x", "b1", "b1.2.3.4", "r10", "t3", "t3x", "l100", "z1", "o5", "o"] {
            assert_eq!(Move::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_classic_sea_ignores_powers_and_hears_the_sub() {
        let f = Fleet::parse("a1v c1v e1v g1v i1v").unwrap();
        assert_eq!(Sea::new(&f).play(Move::Ping(16)), Ok(ShotResult::Ping { count: 3 }));
        assert_eq!(Sea::new_tactics(&f, Vec::new()).play(Move::Ping(16)), Ok(ShotResult::Ping { count: 0 }));
        assert_eq!(Sea::new(&f).play(Move::Flare(0)), Err(ShotError::NotTactics));
    }

    #[test]
    fn a_finished_duel_takes_no_more_moves() {
        let v: Vectors = serde_json::from_str(VECTORS).unwrap();
        let c = v.duels.iter().find(|c| c.winner.is_some()).unwrap();
        let a = Fleet::parse(&c.fleets[0]).unwrap();
        let b = Fleet::parse(&c.fleets[1]).unwrap();
        let mut d = Duel::replay([&a, &b], c.first, &c.moves).unwrap();
        assert_eq!(d.play(Move::Fire(99)), Err(ShotError::Over));
    }

    #[test]
    fn sinking_reveals_the_water_around_a_ship() {
        let f = Fleet::parse("a1h a3h a5h a7h a9h").unwrap();
        let (sea, _) = Sea::replay(&f, "f80 f81").unwrap();
        assert_eq!(sea.marks[80], Mark::Sunk(4));
        assert_eq!(sea.marks[70], Mark::Empty);
        assert_eq!(sea.marks[92], Mark::Empty);
        assert_eq!(Sea::replay(&f, "f80 f81 f70").unwrap_err(), ShotError::AlreadyKnown);
    }

    #[test]
    fn pings_are_limited() {
        let f = Fleet::parse("a1h a3h a5h a7h a9h").unwrap();
        assert_eq!(Sea::replay(&f, "p11 p55 p99").unwrap_err(), ShotError::NoPingsLeft);
        let (sea, r) = Sea::replay(&f, "p11").unwrap();
        assert_eq!(r[0], ShotResult::Ping { count: 6 });
        assert_eq!(sea.pings_left(), 1);
    }

    #[test]
    fn random_fleets_are_always_legal() {
        let mut rng = ChaCha8Rng::seed_from_u64(7);
        for _ in 0..500 {
            let f = random_fleet(&mut rng);
            assert_eq!(f.validate(), Ok(()));
            assert_eq!(Fleet::parse(&f.code()).unwrap(), f);
        }
    }

    #[test]
    fn duel_takes_turns_and_ends() {
        let a = Fleet::parse("a1h a3h a5h a7h a9h").unwrap();
        let b = Fleet::parse("a1v c1v e1v g1v i1v").unwrap();
        let mut d = Duel::new([&a, &b], 0);
        assert_eq!(d.to_move(), 0);
        d.play(Move::Fire(0)).unwrap();
        assert_eq!(d.to_move(), 1);
        d.play(Move::Ping(55)).unwrap();
        assert_eq!(d.to_move(), 0);
        // Side 0 sinks b's destroyer (i1-i2 = cells 8, 18).
        d.play(Move::Fire(8)).unwrap();
        d.play(Move::Fire(99)).unwrap();
        assert_eq!(d.play(Move::Fire(18)).unwrap(), ShotResult::Sunk { ship: 4 });
        let again = Duel::replay([&a, &b], 0, &d.move_string()).unwrap();
        assert_eq!(again.log.len(), 5);
        assert_eq!(again.winner(), None);
    }
}
