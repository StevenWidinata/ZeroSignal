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

use std::sync::OnceLock;

use rand::Rng;
use serde::{Deserialize, Serialize};

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
}

impl FleetError {
    pub fn text(self) -> &'static str {
        match self {
            FleetError::BadCode => "that isn't a fleet (use e.g. a1h a3h a5h a7h a9h)",
            FleetError::WrongCount => "place all 5 ships",
            FleetError::OffGrid => "a ship sticks out of the grid",
            FleetError::Overlap => "two ships overlap",
            FleetError::Touching => "ships can't touch, not even corner to corner",
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

/// A whole fleet, ships in `rules().fleet` order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fleet {
    pub ships: Vec<Placement>,
}

impl Fleet {
    /// Parse and check a fleet code.
    pub fn parse(code: &str) -> Result<Fleet, FleetError> {
        let tokens: Vec<&str> = code.split_whitespace().collect();
        let mut ships = Vec::with_capacity(tokens.len());
        for t in &tokens {
            let t = t.to_ascii_lowercase();
            let (cell, dir) = t.split_at(t.len().saturating_sub(1));
            let horizontal = match dir {
                "h" => true,
                "v" => false,
                _ => return Err(FleetError::BadCode),
            };
            let bow = parse_cell(cell).ok_or(FleetError::BadCode)?;
            ships.push(Placement { bow, horizontal });
        }
        let f = Fleet { ships };
        f.validate()?;
        Ok(f)
    }

    pub fn code(&self) -> String {
        self.ships
            .iter()
            .map(|p| format!("{}{}", cell_name(p.bow), if p.horizontal { 'h' } else { 'v' }))
            .collect::<Vec<_>>()
            .join(" ")
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
                if (Fleet { ships: ships.clone() }).partial_ok() {
                    placed = true;
                    break;
                }
                ships.pop();
            }
            if !placed {
                continue 'again;
            }
        }
        return Fleet { ships };
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
    /// Water next to a sunk ship (ships can't touch, so it's known empty).
    Empty,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum ShotResult {
    Miss,
    Hit,
    Sunk { ship: u8 },
    Ping { count: u8 },
}

impl ShotResult {
    /// Short form used by the shared test vectors: miss, hit, sunk:destroyer, ping:3.
    pub fn short(self) -> String {
        match self {
            ShotResult::Miss => "miss".into(),
            ShotResult::Hit => "hit".into(),
            ShotResult::Sunk { ship } => format!("sunk:{}", rules().fleet[ship as usize].id),
            ShotResult::Ping { count } => format!("ping:{count}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShotError {
    BadMove,
    AlreadyKnown,
    NoPingsLeft,
    Over,
}

impl ShotError {
    pub fn text(self) -> &'static str {
        match self {
            ShotError::BadMove => "that isn't a square on the grid",
            ShotError::AlreadyKnown => "you already know what's there",
            ShotError::NoPingsLeft => "no sonar pings left",
            ShotError::Over => "this game is over",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Ping {
    pub center: usize,
    pub count: u8,
}

/// One side's sea as the other side fires at it.
#[derive(Debug, Clone)]
pub struct Sea {
    occ: [Option<u8>; CELLS],
    lens: Vec<u8>,
    pub marks: [Mark; CELLS],
    hits: Vec<u8>,
    pub pings: Vec<Ping>,
    /// Shots and pings so far.
    pub moves: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Move {
    Fire(usize),
    Ping(usize),
}

impl Move {
    pub fn parse(s: &str) -> Option<Move> {
        let (k, n) = s.split_at(1.min(s.len()));
        let cell: usize = n.parse().ok().filter(|&c| c < CELLS)?;
        match k {
            "f" => Some(Move::Fire(cell)),
            "p" => Some(Move::Ping(cell)),
            _ => None,
        }
    }
    pub fn code(self) -> String {
        match self {
            Move::Fire(c) => format!("f{c}"),
            Move::Ping(c) => format!("p{c}"),
        }
    }
}

impl Sea {
    pub fn new(fleet: &Fleet) -> Sea {
        Sea {
            occ: fleet.occupancy(),
            lens: rules().fleet.iter().map(|s| s.len).collect(),
            marks: [Mark::Unknown; CELLS],
            hits: vec![0; fleet.ships.len()],
            pings: Vec::new(),
            moves: Vec::new(),
        }
    }

    pub fn pings_left(&self) -> u8 {
        rules().pings.saturating_sub(self.pings.len() as u8)
    }

    pub fn all_sunk(&self) -> bool {
        self.hits.iter().zip(&self.lens).all(|(h, l)| h == l)
    }

    pub fn sunk_ships(&self) -> Vec<u8> {
        (0..self.lens.len() as u8).filter(|&i| self.hits[i as usize] == self.lens[i as usize]).collect()
    }

    /// Shots fired + pings used.
    pub fn shots(&self) -> usize {
        self.moves.len()
    }

    pub fn play(&mut self, m: Move) -> Result<ShotResult, ShotError> {
        if self.all_sunk() {
            return Err(ShotError::Over);
        }
        let r = match m {
            Move::Ping(center) => {
                if center >= CELLS {
                    return Err(ShotError::BadMove);
                }
                if self.pings_left() == 0 {
                    return Err(ShotError::NoPingsLeft);
                }
                let count = ping_area(center).into_iter().filter(|&c| self.occ[c].is_some()).count() as u8;
                self.pings.push(Ping { center, count });
                ShotResult::Ping { count }
            }
            Move::Fire(cell) => {
                if cell >= CELLS {
                    return Err(ShotError::BadMove);
                }
                if self.marks[cell] != Mark::Unknown {
                    return Err(ShotError::AlreadyKnown);
                }
                match self.occ[cell] {
                    None => {
                        self.marks[cell] = Mark::Miss;
                        ShotResult::Miss
                    }
                    Some(ship) => {
                        let s = ship as usize;
                        self.hits[s] += 1;
                        self.marks[cell] = Mark::Hit;
                        if self.hits[s] == self.lens[s] {
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
                        } else {
                            ShotResult::Hit
                        }
                    }
                }
            }
        };
        self.moves.push(m.code());
        Ok(r)
    }

    /// Replay a move list ("f37 p44 …") against a fleet.
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
}

/// Two sides firing in turn. Side 0 and side 1; `first` moves first and turns
/// always alternate (a ping uses the turn too). `moves` holds both sides' moves
/// in order; side s fires at the other side's fleet.
#[derive(Debug, Clone)]
pub struct Duel {
    /// seas[s] = side s's own sea (what the other side fires at).
    pub seas: [Sea; 2],
    pub first: usize,
    /// Every move in order: (side, move, result).
    pub log: Vec<(usize, Move, ShotResult)>,
}

impl Duel {
    pub fn new(fleets: [&Fleet; 2], first: usize) -> Duel {
        Duel { seas: [Sea::new(fleets[0]), Sea::new(fleets[1])], first, log: Vec::new() }
    }

    pub fn replay(fleets: [&Fleet; 2], first: usize, moves: &str) -> Result<Duel, ShotError> {
        let mut d = Duel::new(fleets, first);
        for t in moves.split_whitespace() {
            let m = Move::parse(t).ok_or(ShotError::BadMove)?;
            d.play(m)?;
        }
        Ok(d)
    }

    /// The side whose turn it is.
    pub fn to_move(&self) -> usize {
        (self.first + self.log.len()) % 2
    }

    /// The side that sank the other fleet, if any.
    pub fn winner(&self) -> Option<usize> {
        (0..2).find(|&s| self.seas[1 - s].all_sunk())
    }

    pub fn play(&mut self, m: Move) -> Result<ShotResult, ShotError> {
        if self.winner().is_some() {
            return Err(ShotError::Over);
        }
        let side = self.to_move();
        let r = self.seas[1 - side].play(m)?;
        self.log.push((side, m, r));
        Ok(r)
    }

    pub fn move_string(&self) -> String {
        self.log.iter().map(|(_, m, _)| m.code()).collect::<Vec<_>>().join(" ")
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
    struct Vectors {
        fleets: Vec<FleetCase>,
        games: Vec<GameCase>,
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
