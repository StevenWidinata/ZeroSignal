//! Sudoku basics: a 9×9 grid as 81 numbers (0 = empty), squares numbered
//! row by row from the top-left (0..81), and the 27 units (9 rows, 9
//! columns, 9 boxes) that must each hold 1–9 once.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

pub const CELLS: usize = 81;
pub type Grid = [u8; CELLS];

pub const fn row(c: usize) -> usize {
    c / 9
}
pub const fn col(c: usize) -> usize {
    c % 9
}
pub const fn boxi(c: usize) -> usize {
    (c / 27) * 3 + (c % 9) / 3
}

/// The 27 units: 0..9 rows, 9..18 columns, 18..27 boxes.
pub fn units() -> &'static [[usize; 9]; 27] {
    static U: OnceLock<[[usize; 9]; 27]> = OnceLock::new();
    U.get_or_init(|| {
        let mut u = [[0usize; 9]; 27];
        for i in 0..9 {
            for k in 0..9 {
                u[i][k] = i * 9 + k;
                u[9 + i][k] = k * 9 + i;
                u[18 + i][k] = (i / 3) * 27 + (i % 3) * 3 + (k / 3) * 9 + k % 3;
            }
        }
        u
    })
}

/// The three units each square belongs to: [row, column, box].
pub const fn units_of(c: usize) -> [usize; 3] {
    [row(c), 9 + col(c), 18 + boxi(c)]
}

/// The 20 other squares that share a row, column or box with each square.
pub fn peers() -> &'static [[usize; 20]; CELLS] {
    static P: OnceLock<[[usize; 20]; CELLS]> = OnceLock::new();
    P.get_or_init(|| {
        let mut p = [[0usize; 20]; CELLS];
        for (c, list) in p.iter_mut().enumerate() {
            let mut n = 0;
            for o in 0..CELLS {
                if o != c && (row(o) == row(c) || col(o) == col(c) || boxi(o) == boxi(c)) {
                    list[n] = o;
                    n += 1;
                }
            }
            debug_assert_eq!(n, 20);
        }
        p
    })
}

/// Read 81 characters: 1–9, and `.` or `0` for an empty square.
pub fn parse(s: &str) -> Option<Grid> {
    let b = s.as_bytes();
    if b.len() != CELLS {
        return None;
    }
    let mut g = [0u8; CELLS];
    for (i, &ch) in b.iter().enumerate() {
        g[i] = match ch {
            b'.' | b'0' => 0,
            b'1'..=b'9' => ch - b'0',
            _ => return None,
        };
    }
    Some(g)
}

/// 81 characters, `.` for an empty square.
pub fn code(g: &Grid) -> String {
    g.iter().map(|&v| if v == 0 { '.' } else { (b'0' + v) as char }).collect()
}

pub fn filled(g: &Grid) -> usize {
    g.iter().filter(|&&v| v != 0).count()
}

/// Squares whose number appears twice in one of their units.
pub fn conflicts(g: &Grid) -> Vec<usize> {
    let mut bad = [false; CELLS];
    for u in units() {
        for (i, &a) in u.iter().enumerate() {
            for &b in &u[i + 1..] {
                if g[a] != 0 && g[a] == g[b] {
                    bad[a] = true;
                    bad[b] = true;
                }
            }
        }
    }
    (0..CELLS).filter(|&c| bad[c]).collect()
}

/// "row 4, column 7" (counting from 1, top-left).
pub fn square_name(c: usize) -> String {
    format!("row {}, column {}", row(c) + 1, col(c) + 1)
}

/// "row 4", "column 7" or "the top-left box".
pub fn unit_name(u: usize) -> String {
    const BOXES: [&str; 9] = ["top-left", "top", "top-right", "left", "middle", "right", "bottom-left", "bottom", "bottom-right"];
    match u {
        0..=8 => format!("row {}", u + 1),
        9..=17 => format!("column {}", u - 8),
        _ => format!("the {} box", BOXES[u - 18]),
    }
}

/// How hard a puzzle is: the logic a person needs to solve it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Easy,
    Medium,
    Hard,
    Expert,
}

impl Level {
    pub const ALL: [Level; 4] = [Level::Easy, Level::Medium, Level::Hard, Level::Expert];

    pub fn as_str(self) -> &'static str {
        match self {
            Level::Easy => "easy",
            Level::Medium => "medium",
            Level::Hard => "hard",
            Level::Expert => "expert",
        }
    }

    pub fn parse(s: &str) -> Option<Level> {
        Level::ALL.into_iter().find(|l| l.as_str() == s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn units_and_peers() {
        for u in units() {
            let mut seen = [false; CELLS];
            for &c in u {
                assert!(!seen[c]);
                seen[c] = true;
            }
        }
        // Every square is in exactly 3 units, and those are units_of().
        for c in 0..CELLS {
            let mine: Vec<usize> = (0..27).filter(|&u| units()[u].contains(&c)).collect();
            assert_eq!(mine, units_of(c).to_vec());
        }
        assert_eq!(boxi(40), 4);
        assert_eq!(boxi(80), 8);
        assert!(peers()[0].contains(&8) && peers()[0].contains(&72) && peers()[0].contains(&20));
        assert!(!peers()[0].contains(&0) && !peers()[0].contains(&30));
    }

    #[test]
    fn reads_and_writes_codes() {
        let s = "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";
        let g = parse(s).unwrap();
        assert_eq!(code(&g), s);
        assert_eq!(filled(&g), 30);
        assert_eq!(parse(&s.replace('.', "0")), Some(g));
        assert_eq!(parse("123"), None);
        assert_eq!(parse(&s.replacen('.', "x", 1)), None);
    }

    #[test]
    fn finds_repeats_and_names_squares() {
        let mut g = [0u8; CELLS];
        assert!(conflicts(&g).is_empty());
        g[0] = 5;
        g[8] = 5; // same row
        g[80] = 5; // no shared unit with 0, shares column with 8
        assert_eq!(conflicts(&g), vec![0, 8, 80]);
        assert_eq!(square_name(30), "row 4, column 4");
        assert_eq!(unit_name(3), "row 4");
        assert_eq!(unit_name(15), "column 7");
        assert_eq!(unit_name(18), "the top-left box");
        assert_eq!(Level::parse("hard"), Some(Level::Hard));
    }
}
