# Zero Signal Game Kit

The rules every game follows, so old and new games feel like one arcade. A
new game is "done" only when every box below is ticked.

## Look and flow
- [ ] **Header:** `<GameHeader gameId="…" tag={…} />` (back button, icon, title,
      tagline, leaderboard link). The tag shows the current mode/level.
- [ ] **Setup screen first:** mode cards (`wam-modes` / `wam-mode`), the same
      layout as 2048, Whack-a-Mole and Sling Squad. Remember the last choice in
      the browser.
- [ ] **Results screen:** a `panel wam-results` card with `<MyReaction pose>`
      (cheer on a win / new best, wave for a good game, sad on a loss), the
      big score, a "★ New best" tag, a `wam-stats` grid, `<SaveScorePrompt />`
      for guests, and "Play again" / "Change mode" buttons.
- [ ] **Tutorial:** exactly 4 steps (`meta.tutorial`), shown on the first visit.
- [ ] **Characters:** players' characters appear on results; two-player games
      use the versus bar (`VersusBar` / online: `OnlineMatch`).
- [ ] **Themes:** only theme tokens (`--bg`, `--surface`, `--ink`, `--muted`,
      `--line`, accents). No hard-coded page colors, so all 10 themes work.

## Fair scores
- [ ] **The server decides the score** from player inputs only (moves, taps,
      shots), with a seed it hands out (`start` → `finish`), or server-held
      state (Minefield). Never accept a score from the client.
- [ ] Rules shared by the browser and the server live in one place
      (`shared/*.json`) or as line-for-line copies with shared test vectors.
- [ ] Time and speed checks where a bot could play faster than a human.

## Modes and boards
- [ ] 2–4 modes plus a **Daily** (same seed for everyone each WIB day, one
      ranked try, its own "today" board).
- [ ] One leaderboard per mode (`scores.level`), `boards` in the game meta,
      weekly boards, and weekly prizes on the non-Daily boards
      (`prize_boards` in `backend/src/games.rs`).

## Rewards and progress
- [ ] Coins, XP and tokens only from verified results, inside the same
      transaction (`economy::grant`), counting toward the daily cap.
- [ ] Standard formulas: score games use `score_round_reward`; win/loss games
      use `game_xp` × difficulty; series wins pay coins.
- [ ] **3 daily quests** (play N, reach a score, one skill goal) in
      `backend/src/quests/mod.rs`.
- [ ] **4 achievements**, each with its own title item in
      `shared/character_items.json` (first play, a skill goal, a hard goal,
      a mastery goal).
- [ ] Stats page card and Hub "best score" via the shared `boards` stats.

## Cosmetics
- [ ] At least one cosmetic slot (skins, boards, hammers, tile styles…) with
      **several free items** and some paid/drop items. Ownership on the
      server; free items need no row.

## Accessibility and settings
- [ ] Colorblind mode: shapes or labels, never color alone.
- [ ] Light graphics and reduced motion: no required animation.
- [ ] Keyboard play with keys in `src/platform/keymap.ts` (rebindable in
      Settings → Controls); games call `preventDefault()` on keys they use.
- [ ] Sounds through `playSfx`, music class (`calm` / `upbeat`) in
      `src/platform/music.ts`.
- [ ] Works for guests (they play; the results prompt them to register).

## Shipping
- [ ] `ComingSoon` entry in `backend/src/games.rs` and a `soon` module in
      `src/games/upcoming.ts` first; go live by adding the Play screen and
      switching both to live.
- [ ] Tests (rules, scoring, shared vectors), an end-to-end API check, the
      Docker build, README + ROADMAP updated, small `feat:` commits.
