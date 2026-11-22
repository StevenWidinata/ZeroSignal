export interface User {
  id: string;
  username: string;
  email: string;
  /** A guest plays without an account; registering keeps their progress. */
  is_guest: boolean;
}

/** What moved from a guest session into the account you logged in to. */
export interface MergeSummary {
  scores: number;
  games: number;
  items: number;
  coins: number;
  coins_capped: number;
  tokens: number;
  xp: number;
}

export interface AuthResponse {
  token: string;
  user: User;
  merged?: MergeSummary;
  kept_guest_progress: boolean;
  /** Logging in cancelled a pending account deletion. */
  deletion_cancelled?: boolean;
}

/** Account settings view (registered players). */
export interface AccountView {
  username: string;
  email: string;
  joined: string;
  /** When the next rename is allowed; null = now. */
  next_rename_at: string | null;
}

export interface Privacy {
  hide_on_leaderboards: boolean;
  private_profile: boolean;
}

/** Settings saved on the account, plus privacy switches. */
export interface PrefsView {
  settings: Record<string, unknown> | null;
  privacy: Privacy;
}

export interface RenameResponse {
  token: string;
  user: User;
  account: AccountView;
}

export type Ability =
  | "none"
  | "dash"
  | "explode"
  | "egg_drop"
  | "heavy"
  | "split";

export interface Bird {
  id: string;
  name: string;
  color: string;
  ability: Ability;
  mass: number;
  power: number;
  unlock_score: number;
  description: string;
  unlocked: boolean;
}

export interface ShotInput {
  bird: string;
  angle: number;
  power: number;
  ability_tap: number | null;
}

export interface SubmitResponse {
  score: number;
  pigs_destroyed: number;
  blocks_destroyed: number;
  /** Best score on this level. */
  best_score: number;
  cleared: boolean;
  stars: number;
  first_clear: boolean;
  unlocked_up_to: number;
  campaign_score: number;
  newly_unlocked: string[];
  rewards: Granted;
}

export interface AbLevelView {
  id: number;
  world: number;
  name: string;
  stars_at: [number, number, number];
  best: number;
  cleared: boolean;
  stars: number;
  unlocked: boolean;
}

export interface AbProgress {
  campaign_score: number;
  levels_cleared: number;
  unlocked_up_to: number;
  levels: AbLevelView[];
}

// ---------------------------------------------------------------------------
// Economy (shared by every game)
// ---------------------------------------------------------------------------

/** What the server actually paid for a verified result. */
export interface Granted {
  coins: number;
  tokens: number;
  xp: number;
  /** Coins withheld because the daily cap was reached. */
  coins_capped: number;
  level_before: number;
  level_after: number;
}

export interface Wallet {
  coins: number;
  tokens: number;
  xp: number;
  level: number;
  xp_into_level: number;
  xp_for_next: number;
  coins_today: number;
  daily_cap: number;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  best_score: number;
  /** Extra shown next to the score (2048: biggest tile). */
  detail?: string | null;
  /** Saved outfit (slot -> item id), null if never customized. */
  avatar: Record<string, string> | null;
}

export interface MyScore {
  score: number;
  level: number;
  bird_variant: string | null;
  detail?: string | null;
  created_at: string;
}

export interface MyScoresResponse {
  game_id: string;
  best_score: number;
  scores: MyScore[];
}


// ---------------------------------------------------------------------------
// Connect Four (server-authoritative AI matches)
// ---------------------------------------------------------------------------

export type Difficulty = "easy" | "medium" | "hard" | "impossible";
export type SkinRarity = "common" | "rare" | "epic" | "legendary";

export type CfOutcome =
  | { kind: "ongoing" }
  | { kind: "win"; winner: "p1" | "p2" }
  | { kind: "draw" };

export interface CfMatch {
  id: string;
  difficulty: Difficulty;
  best_of: 3 | 5;
  skin: string;
  user_wins: number;
  ai_wins: number;
  draws: number;
  moves: string;
  /** cells[col][row], row 0 = bottom; 0 empty, 1 you, 2 AI. */
  cells: (0 | 1 | 2)[][];
  outcome: CfOutcome;
  winning_cells: [number, number][];
  game_over: boolean;
  undos_left: number;
  used_undo: boolean;
  status: "active" | "won" | "lost" | "forfeited";
  points: number;
  ai_move: number | null;
  spin_granted: boolean;
  /** Paid when a game finished on this move. */
  rewards: Granted | null;
}

export interface CfSkin {
  id: string;
  name: string;
  rarity: SkinRarity;
  free: boolean;
  owned: boolean;
}

export interface CfCollection {
  skins: CfSkin[];
  spins_available: number;
}

export interface CfSpin {
  difficulty: Difficulty;
  rolls: string[];
  won: string | null;
  collection: CfCollection;
}

// ---------------------------------------------------------------------------
// Character, shop and profiles
// ---------------------------------------------------------------------------

/** slot id -> item id (catalog: shared/character_items.json). */
export type LoadoutDto = Record<string, string>;

export interface OutfitPreset {
  slot_no: 1 | 2 | 3;
  name: string;
  loadout: LoadoutDto;
}

export interface CharacterView {
  loadout: LoadoutDto;
  /** Every item id the player owns (starter + level + bought/won). */
  owned: string[];
  presets: OutfitPreset[];
  wallet: Wallet;
}

export interface BoxResponse {
  item_id: string;
  duplicate: boolean;
  refund: number;
  character: CharacterView;
}

export interface ItemWheelResponse {
  /** Every landing in order; all but the last were owned (free re-spins). */
  rolls: string[];
  won: string;
  character: CharacterView;
}

export interface GameStat {
  game_id: string;
  best_score: number;
  plays: number;
}

export interface PublicProfile {
  username: string;
  level: number;
  loadout: LoadoutDto;
  joined: string;
  items_owned: number;
  stats: GameStat[];
  achievements: PublicAchievement[];
  /** The player chose a private profile: only the name is shown. */
  private?: boolean;
}

// ---------------------------------------------------------------------------
// Tic-Tac-Toe (server-authoritative AI matches)
// ---------------------------------------------------------------------------

export type TttDifficulty = "easy" | "medium" | "hard";

export interface TttMatch {
  id: string;
  difficulty: TttDifficulty;
  best_of: 3 | 5;
  face: string;
  board: string;
  user_wins: number;
  ai_wins: number;
  draws: number;
  moves: string;
  /** 9 cells, row by row: 0 empty, 1 you (X), 2 AI (O). */
  cells: (0 | 1 | 2)[];
  outcome: CfOutcome;
  winning_line: [number, number, number] | null;
  game_over: boolean;
  undos_left: number;
  used_undo: boolean;
  status: "active" | "won" | "lost" | "drawn" | "forfeited";
  points: number;
  ai_move: number | null;
  spin_granted: boolean;
  rewards: Granted | null;
}

export interface TttItemView {
  id: string;
  name: string;
  rarity: SkinRarity;
  price: number | null;
  owned: boolean;
}

export interface TttCollection {
  boards: TttItemView[];
  faces: TttItemView[];
  spins_available: number;
  has_photo: boolean;
}

export interface TttSpin {
  difficulty: TttDifficulty;
  /** Item keys like "board:neon" or "face:pig"; all but the last were owned. */
  rolls: string[];
  won: string | null;
  collection: TttCollection;
}

/** One day of the 7-day login streak. */
export interface LoginDayReward {
  day: number;
  coins: number;
  tokens: number;
}

export interface LoginStatus {
  claimed_today: boolean;
  /** Day claimed today, or the day the next claim pays (1..7). */
  streak_day: number;
  rewards: LoginDayReward[];
  /** ISO time when the next WIB day starts. */
  next_reset: string;
}

export interface LoginClaim {
  status: LoginStatus;
  granted: Granted;
}

export interface Quest {
  slot: number;
  id: string;
  title: string;
  progress: number;
  target: number;
  coins: number;
  xp: number;
  done: boolean;
  claimed: boolean;
}

export interface QuestsView {
  quests: Quest[];
  reroll_available: boolean;
  bonus_tokens: number;
  bonus_claimed: boolean;
  /** ISO time when tomorrow's quests arrive (00:00 WIB). */
  next_reset: string;
}

export interface QuestClaim {
  quests: QuestsView;
  granted: Granted;
  bonus: boolean;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  coins: number;
  xp: number;
  /** Title item id granted on claim (character catalog). */
  title: string;
  progress: number;
  target: number;
  unlocked: boolean;
  claimed_at: string | null;
}

export interface AchievementsView {
  achievements: Achievement[];
  /** Unlocked but not claimed yet. */
  ready: number;
  claimed: number;
}

export interface AchievementClaim {
  achievements: AchievementsView;
  granted: Granted;
  title: string;
}

/** A claimed achievement as shown on public profiles. */
export interface PublicAchievement {
  id: string;
  name: string;
  description: string;
  title: string;
  claimed_at: string;
}

// ---------------------------------------------------------------------------
// Whack-a-Mole
// ---------------------------------------------------------------------------

export type WamMode = "normal" | "classic" | "frenzy" | "survival" | "daily";

export interface WamTap {
  t: number;
  hole: number;
}

export interface WamStart {
  run_id: string;
  seed: number;
  mode: WamMode;
  grid: 3 | 4;
}

/** The server's replay of a round (same shape as the engine's Summary). */
export interface WamSummary {
  score: number;
  hits: number;
  misses: number;
  escapes: number;
  best_streak: number;
  fever: boolean;
  golden_hits: number;
  bombs_hit: number;
  by_kind: number[];
  bosses_beaten: number;
  hole_hits: number[];
  hole_misses: number[];
  reaction_total_ms: number;
  reactions: number;
  ended_ms: number;
  lives_left: number;
}

export interface WamFinish {
  mode: WamMode;
  summary: WamSummary;
  previous_best: number;
  new_best: boolean;
  rewards: Granted;
  /** Lucky drop ("hammer:pan"), if any. */
  drop: string | null;
}

export interface WamItemView {
  id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  price: number | null;
  owned: boolean;
}

export interface WamCollection {
  hammers: WamItemView[];
  themes: WamItemView[];
}

// ---------------------------------------------------------------------------
// Checkers
// ---------------------------------------------------------------------------

export type CheckersSide = "dark" | "light";
export type CheckersLevel = "easy" | "medium" | "hard" | "master";

/** A game vs Zero-Bot. `cells`: 32 squares, 0 empty, ±1 man, ±2 king (+ = dark). */
export interface CheckersGame {
  id: string;
  level: CheckersLevel;
  side: CheckersSide;
  cells: number[];
  turn: CheckersSide;
  moves: string[];
  /** Your legal moves now (notation, e.g. "11-15", "22x15x8"). */
  legal: string[];
  status: "active" | "won" | "lost" | "drawn" | "resigned";
  ending: string | null;
  undos_left: number;
  board_style: string;
  piece_set: string;
  quiet_left: number;
  ai_move: string | null;
  rewards: Granted | null;
  drop: string | null;
}

export interface CheckersCollection {
  boards: WamItemView[];
  pieces: WamItemView[];
}

/** Today's "win in N" puzzle and your attempt. */
export interface CheckersPuzzle {
  day: string;
  number: number;
  cells: number[];
  turn: CheckersSide;
  win_in: number;
  side: CheckersSide;
  moves: string[];
  legal: string[];
  status: "new" | "playing" | "solved" | "failed";
  mistakes: number;
  mistakes_left: number;
  streak: number;
  solution: string[] | null;
  start_cells: number[];
  correct: boolean | null;
  reply: string | null;
  rewards: Granted | null;
  points: number | null;
}

/** Online checkers: what the room's `board.highlight` holds. */
export interface CheckersRoomInfo {
  moves: string[];
  legal: string[];
  ending: string;
  quiet_left: number;
}

// ---------------------------------------------------------------------------
// Snake Signal
// ---------------------------------------------------------------------------

export type SnakeMode = "classic" | "wrap" | "daily";
export type SnakeSize = "small" | "medium" | "large";
export type SnakeItemKind = "skin" | "arena" | "trail";

export interface SnakeStart {
  run_id: string;
  seed: number;
  mode: SnakeMode;
  size: SnakeSize;
}

/** The server's replay of a run (same shape as the engine's Summary). */
export interface SnakeSummary {
  score: number;
  raw: number;
  length: number;
  max_length: number;
  eaten: number;
  golden: number;
  powers: number;
  close_calls: number;
  bugs_eaten: number;
  best_combo: number;
  ticks: number;
  game_ms: number;
  ended_by: "wall" | "self" | "glitch" | "bug" | "signal" | "full" | "time" | "quit" | null;
}

export interface SnakeFinish {
  mode: SnakeMode;
  size: SnakeSize;
  summary: SnakeSummary;
  previous_best: number;
  new_best: boolean;
  rewards: Granted;
  /** Lucky drop ("skin:lava"), if any. */
  drop: string | null;
}

export interface SnakeCollection {
  skins: WamItemView[];
  arenas: WamItemView[];
  trails: WamItemView[];
}

// ---------------------------------------------------------------------------
// Minefield
// ---------------------------------------------------------------------------

export type SudokuMode = "easy" | "medium" | "hard" | "expert" | "daily";

export interface SudokuResult {
  won: boolean;
  time_ms: number | null;
  score: number | null;
  checks: number;
  hints: number;
  /** Only in the reply that ended the game. */
  previous_best: number | null;
  new_best: boolean | null;
  rewards: Granted | null;
  /** A lucky theme drop, e.g. "theme:neon". */
  drop: string | null;
}

export interface SudokuGame {
  id: string;
  mode: SudokuMode;
  /** WIB day of a Daily. */
  day: string | null;
  status: "playing" | "won" | "gave_up";
  /** 81 characters, "." = empty. */
  givens: string;
  /** The grid as you left it (givens included). */
  entries: string;
  /** Squares filled by hints (locked). */
  hinted: number[];
  hints_used: number;
  hints_left: number;
  checks: number;
  /** Time so far, hint time included. */
  elapsed_ms: number;
  /** Only once the game is over. */
  solution: string | null;
  /** Reply to a Check that found wrong numbers. */
  wrong: number[] | null;
  /** Reply to a hint. */
  hint: { cell: number; digit: number; technique: string | null; reason: string } | null;
  result: SudokuResult | null;
}

export interface SudokuCollection {
  themes: WamItemView[];
}

export type MfDifficulty = "beginner" | "intermediate" | "expert" | "daily";

export interface MfResult {
  won: boolean;
  time_ms: number | null;
  score: number | null;
  three_bv: number | null;
  clicks: number;
  /** Only in the reply to the move that ended the game. */
  previous_best: number | null;
  new_best: boolean | null;
  rewards: Granted | null;
}

export interface MfGame {
  id: string;
  difficulty: MfDifficulty;
  rows: number;
  cols: number;
  mines: number;
  status: "new" | "playing" | "won" | "lost";
  /** -1 hidden, 0-8 opened, 9 mine (after the game), 10 the mine you hit. */
  cells: number[];
  elapsed_ms: number;
  hints_used: number;
  hints_left: number;
  result: MfResult | null;
}

// ---------------------------------------------------------------------------
// Stats page
// ---------------------------------------------------------------------------

export interface StatsSeries {
  game: "connect-four" | "tic-tac-toe";
  difficulty: string;
  played: number;
  won: number;
  lost: number;
  drawn: number;
}

export interface StatsBoard {
  game_id: string;
  level: number;
  rounds: number;
  best: number;
  average: number;
}

/** Games vs Zero-Bot at one level (Chess, Sonar). */
export interface StatsLevelRow {
  level: string;
  played: number;
  won: number;
  drawn: number;
}

/** One game's Daily on the Hub ("Today's Dailies"). */
export interface DailyView {
  game_id: string;
  board: number;
  status: "new" | "playing" | "done";
  score: number | null;
  rank: number | null;
  players: number;
}

export interface StatsView {
  joined: string;
  level: number;
  xp: number;
  coins_earned: number;
  coins_spent: number;
  tokens_earned: number;
  best_login_streak: number;
  quests_claimed: number;
  achievements_claimed: number;
  series: StatsSeries[];
  boards: StatsBoard[];
  minefield: { difficulty: string; played: number; won: number; best_time_ms: number | null }[];
  /** Finished Sudoku games per level (easy … expert, daily). */
  sudoku: { level: string; played: number; won: number; best_time_ms: number | null }[];
  whack: {
    rounds: number;
    best_streak: number | null;
    fever_rounds: number;
    golden_hits: number | null;
    longest_survival_ms: number | null;
  };
  g2048: { games: number; best_tile: number | null; reached_2048: number; moves: number | null };
  chess: { levels: StatsLevelRow[]; puzzles_played: number; puzzles_solved: number };
  checkers: { levels: StatsLevelRow[]; puzzles_played: number; puzzles_solved: number };
  sonar: { levels: StatsLevelRow[]; hunts: number; best_hunt: number | null; flawless: number };
  snake: {
    runs: number;
    longest: number | null;
    packets: number | null;
    powers: number | null;
    combo5_runs: number;
    bugs_eaten: number | null;
  };
}

// ---------------------------------------------------------------------------
// 2048
// ---------------------------------------------------------------------------

export type G2048Mode = "classic" | "big" | "tiny" | "daily";

export interface G2048Run {
  run_id: string;
  seed: number;
  mode: G2048Mode;
  size: number;
  /** Undos allowed in this game. */
  undos: number;
  /** Moves saved so far: U D L R, Z = undo. */
  moves: string;
}

/** The server's replay of a game. */
export interface G2048Summary {
  score: number;
  points: number;
  max_tile: number;
  moves: number;
  undos_used: number;
  game_over: boolean;
}

export interface G2048Finish {
  mode: G2048Mode;
  summary: G2048Summary;
  previous_best: number;
  new_best: boolean;
  rewards: Granted;
}

// ---------------------------------------------------------------------------
// Weekly leaderboards
// ---------------------------------------------------------------------------

export type LeaderboardPeriod = "all" | "today" | "week" | "last_week";

export interface WeeklyPrize {
  game_id: string;
  /** Board within the game; null = the whole game. */
  level: number | null;
  rank: 1 | 2 | 3;
  coins: number;
  tokens: number;
  claimed: boolean;
}

export interface WeeklyPrizes {
  /** Monday (WIB) the prize week started. */
  week: string;
  prizes: WeeklyPrize[];
}

export interface WeeklyClaim {
  claimed: WeeklyPrize[];
  rewards: Granted;
}

// ---------------------------------------------------------------------------
// Online rooms (two devices)
// ---------------------------------------------------------------------------

export type OnlineGame = "connect-four" | "tic-tac-toe" | "chess" | "sonar" | "checkers";

export interface RoomPlayer {
  username: string;
  is_guest: boolean;
  avatar: Record<string, string> | null;
  here: boolean;
  emote: string | null;
  emote_at: string | null;
  rematch: boolean;
}

export interface RoomView {
  code: string;
  game: OnlineGame;
  best_of: number;
  status: "waiting" | "playing" | "finished" | "abandoned";
  /** Your seat: 1 = host, 2 = joined. */
  you: 1 | 2;
  players: [RoomPlayer | null, RoomPlayer | null];
  game_no: number;
  first_seat: 1 | 2;
  board: {
    /** Connect Four: columns bottom-up; Tic-Tac-Toe: 9 cells; chess: the FEN. 1 = whoever moved first. */
    cells: number[][] | number[] | string | SonarRoomCells;
    outcome: CfOutcome;
    highlight: [number, number][] | [number, number, number] | ChessRoomInfo | null;
    next: "p1" | "p2";
  };
  moves: string;
  your_turn: boolean;
  game_over: boolean;
  wins: [number, number];
  draws: number;
  winner: number | null;
  /** Chess: the seat offering a draw right now. */
  draw_offer: number | null;
  version: number;
}

/** Chess rooms: what the server adds about the position. */
export interface ChessRoomInfo {
  san: string[];
  last: string | null;
  check: boolean;
  legal: string[];
  /** "checkmate", "stalemate", … or "" while playing. */
  ending: string;
}

export interface OnlineEntry {
  rank: number;
  username: string;
  wins: number;
  played: number;
  avatar: Record<string, string> | null;
}

// ---------------------------------------------------------------------------
// Chess
// ---------------------------------------------------------------------------

export type ChessLevel = "easy" | "medium" | "hard" | "master";
export type ChessSide = "white" | "black";

export type ChessOutcome =
  | { kind: "ongoing" }
  | { kind: "checkmate"; winner: ChessSide }
  | { kind: "stalemate" | "repetition" | "fifty_moves" | "insufficient_material" };

/** A game vs Zero-Bot; the server checks every move and plays the reply. */
export interface ChessGame {
  id: string;
  level: ChessLevel;
  color: ChessSide;
  fen: string;
  moves: string[];
  san: string[];
  /** Your legal moves now (UCI); empty when it isn't your turn. */
  legal: string[];
  in_check: boolean;
  outcome: ChessOutcome;
  status: "active" | "won" | "lost" | "drawn" | "resigned";
  ending: string | null;
  undos_left: number;
  board_style: string;
  piece_set: string;
  ai_move: string | null;
  rewards: Granted | null;
  /** Lucky drop ("board:neon"). */
  drop: string | null;
}

export interface ChessItemView {
  id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  price: number | null;
  owned: boolean;
}

export interface ChessCollection {
  boards: ChessItemView[];
  pieces: ChessItemView[];
}

export interface ChessPuzzle {
  day: string;
  number: number;
  start_fen: string;
  fen: string;
  mate_in: number;
  color: ChessSide;
  moves: string[];
  san: string[];
  legal: string[];
  in_check: boolean;
  status: "new" | "playing" | "solved" | "failed";
  mistakes: number;
  mistakes_left: number;
  streak: number;
  solution: string[] | null;
  correct: boolean | null;
  reply: string | null;
  rewards: Granted | null;
  points: number | null;
}

// ---------------------------------------------------------------------------
// Sonar
// ---------------------------------------------------------------------------

export type SonarLevel = "easy" | "medium" | "hard" | "master";

/** Same shape as `ShotResult` in games/sonar/rules.ts (everything after ping is Tactics only). */
export type SonarResult =
  | { kind: "miss" }
  | { kind: "hit" }
  | { kind: "sunk"; ship: number }
  | { kind: "ping"; count: number }
  | { kind: "radar"; count: number }
  | { kind: "seen" }
  | { kind: "clear" }
  | { kind: "dud" }
  | { kind: "mine" }
  | { kind: "mine_seen" }
  | { kind: "crate"; item: "ping" | "shield" | "repair" | "extra_shot" }
  | { kind: "crate_seen" }
  | { kind: "blocked" }
  | { kind: "exposed" }
  | { kind: "repaired" }
  | { kind: "charged"; power: number };

/** What a shooter knows about a sea. */
export interface SonarSea {
  /** 100 chars: '.' unknown, 'o' miss, 'x' hit, 's' sunk, '-' known water; Tactics: '*' spotted ship, 'm' mine, '+' crate seen, 'c' opened crate. */
  marks: string;
  sunk: { ship: number; cells: number[] }[];
  pings: { center: number; count: number }[];
  pings_left: number;
  shots: number;
  all_sunk: boolean;
  /** Tactics: radar sweeps of this sea. */
  sweeps: { line: number; row: boolean; count: number }[];
  /** Tactics: shields guarding this sea's ships. */
  shields: number;
}

export interface SonarCellResult {
  cell: number;
  result: SonarResult;
}

export interface SonarLogEntry {
  mine: boolean;
  /** The move code ("f37", "a12h", "o2", …). */
  move: string;
  cell: number;
  ping: boolean;
  /** The headline result. */
  result: SonarResult;
  /** Every square the move touched in the other sea. */
  hits: SonarCellResult[];
  /** Tactics: what happened in the mover's own sea (a mine showed a ship, a repair kit fixed one). */
  own: SonarCellResult[];
}

/** One side's Tactics powers, in fleet order (Air Strike, Salvo, Radar, Torpedo, Flare). */
export interface SonarPowers {
  charge: number[];
  cooldown: number[];
  size: number[];
  levels: number[];
  /** That power's ship has sunk. */
  lost: boolean[];
  combo: number;
  overdrive: boolean;
}

export type SonarMode = "classic" | "tactics";

/** Your progress on one Campaign mission. */
export interface SonarOpProgress {
  id: number;
  /** 0 = not won yet. */
  stars: number;
  best_moves: number | null;
  unlocked: boolean;
}

/** The Ship Workshop: your Mk per power (fleet order) and the next Mk's price (null = maxed). */
export interface SonarWorkshop {
  levels: number[];
  next_price: (number | null)[];
}

export interface SonarGame {
  id: string;
  level: SonarLevel;
  mode: SonarMode | "campaign";
  /** Campaign: the mission, its move limit, and the stars once it's won. */
  op: number | null;
  move_limit: number | null;
  stars: { stars: number; new_stars: number; coins: number } | null;
  status: "active" | "won" | "lost" | "resigned";
  fleet: string;
  your_sea: SonarSea;
  target: SonarSea;
  log: SonarLogEntry[];
  your_turn: boolean;
  ai_fleet: string | null;
  /** Tactics: your powers and Zero-Bot's. */
  powers: SonarPowers | null;
  bot_powers: SonarPowers | null;
  fleet_skin: string;
  sea: string;
  rewards: Granted | null;
  points: number | null;
  drop: string | null;
}

export interface SonarDaily {
  day: string;
  /** `target.shots` = moves that count. */
  target: SonarSea;
  status: "new" | "playing" | "done";
  fleet: string | null;
  last: SonarResult | null;
  /** Every square the last move touched. */
  last_hits: SonarCellResult[];
  /** The last move didn't count (Overdrive, or an Extra shot crate). */
  last_free: boolean;
  /** Your five ship powers (Mk I; never lost: you have no fleet in the Hunt). */
  powers: SonarPowers;
  points: number | null;
  rewards: Granted | null;
}

export interface SonarCollection {
  fleets: ChessItemView[];
  seas: ChessItemView[];
}

/** Online Sonar: the board as your seat may see it. */
export interface SonarRoomCells {
  phase: "placing" | "firing";
  /** Classic or Tactics for the whole room. */
  mode: SonarMode;
  placed: [boolean, boolean];
  your_fleet: string | null;
  your_sea?: SonarSea;
  target?: SonarSea;
  log?: SonarLogEntry[];
  their_fleet?: string | null;
  /** Tactics: your powers and your friend's. */
  powers?: SonarPowers | null;
  their_powers?: SonarPowers | null;
}
