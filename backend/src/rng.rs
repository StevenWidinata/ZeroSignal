//! Seeded random numbers (mulberry32) for games whose rules run on both the
//! server and the browser. `frontend/src/platform/seeded.ts` is a
//! line-for-line copy; both only use 32-bit integer math, so the same seed
//! always gives the same numbers. (Whack-a-Mole and 2048 keep their own
//! older copies with their own test vectors.)

#[derive(Debug, Clone)]
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(seed)
    }

    pub fn next_u32(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x6D2B_79F5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^ (t >> 14)
    }

    /// 0..n (n > 0).
    pub fn below(&mut self, n: u32) -> u32 {
        self.next_u32() % n
    }
}

/// The same seed for everyone on one WIB day; `salt` keeps games apart.
pub fn daily_seed(year: i32, month: u32, day: u32, salt: u32) -> u32 {
    let mut r = Rng::new((year as u32).wrapping_mul(10_000) + month * 100 + day);
    r.next_u32() ^ salt
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Same numbers as `frontend/src/platform/seeded.test.ts`.
    #[test]
    fn matches_the_shared_vector() {
        let mut r = Rng::new(12345);
        let got: Vec<u32> = (0..4).map(|_| r.next_u32()).collect();
        assert_eq!(got, vec![4207900869, 1317490944, 2079646450, 3513001552]);
        assert_eq!(daily_seed(2026, 11, 16, 0x5A4E_5161), daily_seed(2026, 11, 16, 0x5A4E_5161));
    }
}
