/** Everything Ping says. Short, dry and never pushy. */

export const JOKES = [
  "Hanging around. Literally.",
  "Why do bats play games? For the high score.",
  "I see in sound.",
  "Five bars. Your move.",
  "Upside down is my good side.",
  "I'm not clingy. I'm perched.",
  "Echo... echo... yep, still here.",
  "Night shift, day shift. Same bat.",
];

export const CLICK_LINES = {
  flap: "Wheee.",
  echo: "Ping... got a pong.",
} as const;

export const DIZZY_LINES = ["Too many pokes.", "Seeing stars...", "Okay, okay. Stop."];

export const PET_LINES = ["Signal restored.", "Again.", "That helped."];

export const MOPE_LINES = ["Low signal...", "No bars today.", "A pet would help.", "*sigh*"];

/** After a game: what he says from the logo (best = a new personal best). */
export const REACTIONS = {
  best: ["New best. Echoes all the way down.", "New record. I heard it from up here.", "Best one yet. Frame it."],
  cheer: ["Nice one.", "Clean win.", "That's the signal.", "I'd flap for that."],
  wave: ["Good run.", "Not bad at all.", "Solid. Again?"],
  sad: ["Shake it off. Again?", "Static happens.", "Next one's yours.", "Even bats crash sometimes."],
  draw: ["Even. Rematch?", "Dead level. Tie-breaker?"],
} as const;

export type ResultKind = keyof typeof REACTIONS;

/** Gentle reminders; at most one per page visit, each at most once an hour. */
export const NUDGES = {
  prize: "There's a weekly prize with your name on it.",
  quests: "Quests ready to claim, by the way.",
  daily: "Today's Daily is still waiting.",
} as const;

export type NudgeKind = keyof typeof NUDGES;

/** Tips for each page, said now and then when you click him. */
export const PAGE_TIPS: Record<string, string[]> = {
  hub: ["Pick a game, any game.", "Online or offline? The chips up top filter.", "Every score here is checked by the server."],
  leaderboard: ["Weeks reset Monday, 00:00 WIB.", "Top 3 each week win coins.", "All time, this week, last week. Pick one."],
  shop: ["Coins only come from server-checked games.", "Looking good is half the game."],
  stats: ["Only server-checked results count here.", "Numbers don't lie. I checked."],
  quests: ["New quests every day.", "Claim them before midnight."],
  achievements: ["Some of these come with a title.", "Collect them all. I'm counting."],
  roadmap: ["More games are coming. I've seen the list."],
  account: ["Register and your guest progress comes with you.", "Welcome back."],
  profile: ["Nice profile.", "Looking sharp."],
};

/** Tips for each game, said when you click him on that game's page. */
export const GAME_TIPS: Record<string, string[]> = {
  "sling-squad": ["Fewer birds, more stars.", "Aim twice, fling once."],
  "connect-four": ["The middle column is in the most fours.", "Block first, brag later."],
  "tic-tac-toe": ["Hard never loses. A draw still pays.", "Corners are friends."],
  "whack-a-mole": ["Don't bonk the bombs.", "Ice moles buy you time.", "Helmets take two hits."],
  minefield: ["Every board here is solvable without guessing.", "Count twice, click once."],
  "2048": ["Keep your biggest tile in a corner.", "Don't chase merges. Line them up."],
  chess: ["Castle early, sleep easy.", "The Daily is a mate in 2."],
  sonar: ["Every ship has a power. Use them.", "Ping first, fire second. Trust me."],
  "snake-signal": ["The signal fades. Keep eating.", "Combos go up to ×5."],
  checkers: ["If you can jump, you must. Plan for it.", "Kings move both ways."],
  sudoku: ["Notes are free. Use them.", "One answer, no guessing needed."],
  "memory-match": ["Watch your friend's flips too.", "In Chaos you bring 3 powers."],
  "brick-breaker": ["Steel bricks don't break. Go around.", "Stars are the lives you finish with."],
  "signal-flap": ["Little flaps, long runs.", "The gaps narrow the farther you go."],
};

/** The tips for a page path. */
export function tipsFor(pathname: string): string[] {
  const game = pathname.match(/^\/(?:play|leaderboard)\/([a-z0-9-]+)/)?.[1];
  if (game && pathname.startsWith("/play/")) return GAME_TIPS[game] ?? [];
  if (pathname === "/") return PAGE_TIPS.hub;
  if (pathname.startsWith("/leaderboard")) return PAGE_TIPS.leaderboard;
  if (pathname.startsWith("/login") || pathname.startsWith("/register")) return PAGE_TIPS.account;
  if (pathname.startsWith("/u/") || pathname.startsWith("/profile")) return PAGE_TIPS.profile;
  const page = pathname.slice(1).split("/")[0];
  return PAGE_TIPS[page] ?? [];
}
