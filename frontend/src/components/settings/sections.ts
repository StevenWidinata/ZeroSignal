import { DEFAULT_SETTINGS, type Settings } from "../../store/settings";

/**
 * The settings screen as plain data: sections, every setting's name and
 * explanation, which settings each section resets, and the search. The
 * controls themselves live in rows.tsx.
 */

export type SectionId = "appearance" | "sound" | "gameplay" | "controls" | "privacy" | "account";

export const SECTIONS: { id: SectionId; icon: string; label: string; blurb: string }[] = [
  { id: "appearance", icon: "🎨", label: "Appearance", blurb: "Theme, text size, accessibility and effects." },
  { id: "sound", icon: "🔊", label: "Sound", blurb: "Sound effects and music." },
  { id: "gameplay", icon: "🎮", label: "Gameplay", blurb: "Turn timer, tutorials and pop-ups." },
  { id: "controls", icon: "⌨️", label: "Controls", blurb: "Shortcut keys and every game's keys." },
  { id: "privacy", icon: "🔒", label: "Privacy", blurb: "Who can see you on leaderboards and your profile." },
  { id: "account", icon: "👤", label: "Account", blurb: "Username, email, password and your account." },
];

/** Settings each section's "Reset this section" puts back. */
export const SECTION_KEYS: Partial<Record<SectionId, (keyof Settings)[]>> = {
  appearance: ["highContrast", "readableFont", "colorblind", "textSize", "reducedMotion", "lightGraphics", "screenShake", "showFps", "pingLively"],
  sound: ["sound", "volume", "uiVolume", "music", "musicVolume"],
  gameplay: ["turnTimer", "confirmLeave", "vibration", "dailyLoginPopup", "levelUpPopup", "rewardToasts"],
  controls: ["shortcuts", "keys"],
};

/** The default values for one section. */
export function sectionDefaults(id: SectionId): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const k of SECTION_KEYS[id] ?? []) (out as Record<string, unknown>)[k] = DEFAULT_SETTINGS[k];
  return out;
}

export interface RowInfo {
  id: string;
  section: SectionId;
  group: string;
  label: string;
  hint?: string;
  /** Extra words the search box should find. */
  keywords?: string;
  /** Put the control under the text (wide pickers). */
  stack?: boolean;
  /** Hidden when this returns false (e.g. fullscreen on iPhone). */
  available?: () => boolean;
}

export const ROW_INFO: RowInfo[] = [
  // Appearance
  { id: "theme", section: "appearance", group: "Theme", label: "Theme", hint: "Pick a mood for the whole arcade. It follows you to every device when you're logged in.", keywords: "colour color mood dark light", stack: true },
  { id: "dark", section: "appearance", group: "Theme", label: "Dark version", hint: "Switch between this mood's dark and light versions (also the 🌙/☀️ button).", keywords: "dark mode light mode night" },
  { id: "textSize", section: "appearance", group: "Text", label: "Text size", hint: "Makes the whole site bigger or smaller.", keywords: "font zoom bigger smaller" },
  { id: "readableFont", section: "appearance", group: "Text", label: "Readable font", hint: "Swap the pixel-art font for a plain one that's easier to read.", keywords: "font dyslexia pixel" },
  { id: "highContrast", section: "appearance", group: "Accessibility", label: "High contrast", hint: "Plain black and white with bright borders. Easier in sunlight or with low vision.", keywords: "contrast vision" },
  { id: "colorblind", section: "appearance", group: "Accessibility", label: "Colorblind-friendly", hint: "A color-safe palette, plus shapes on pieces so you never need color alone.", keywords: "colour blind color blind palette" },
  { id: "reducedMotion", section: "appearance", group: "Motion and performance", label: "Reduced motion", hint: "Stops animations but keeps the effects. Your device's setting is followed too.", keywords: "animation motion sickness" },
  { id: "lightGraphics", section: "appearance", group: "Motion and performance", label: "Light graphics", hint: "Fewer animations and effects. Good for slow devices.", keywords: "performance slow lag battery" },
  { id: "screenShake", section: "appearance", group: "Motion and performance", label: "Screen shake", hint: "The board shakes on bombs and big hits.", keywords: "shake effects" },
  { id: "pingLively", section: "appearance", group: "Motion and performance", label: "Lively Ping", hint: "Ping, the bat in the logo, idles, does tricks, talks and squeaks. Turn off to keep him still.", keywords: "mascot bat logo animation sounds speech" },
  { id: "showFps", section: "appearance", group: "Motion and performance", label: "Show FPS", hint: "Frames per second in the bottom-right corner.", keywords: "fps frames performance" },
  { id: "fullscreen", section: "appearance", group: "Motion and performance", label: "Fullscreen", hint: "Hide the browser bars. Shortcut: F. Esc leaves.", keywords: "full screen" },

  // Sound
  { id: "sound", section: "sound", group: "Sound effects", label: "Sound effects", hint: "Clicks, hits, wins and everything else that isn't music.", keywords: "mute audio sfx" },
  { id: "volume", section: "sound", group: "Sound effects", label: "Game sounds", hint: "How loud the games are.", keywords: "volume loud" },
  { id: "uiVolume", section: "sound", group: "Sound effects", label: "Menu sounds", hint: "Button clicks, separate from game sounds.", keywords: "volume click" },
  { id: "music", section: "sound", group: "Music", label: "Background music", hint: "Chiptune made in code. Starts after your first click.", keywords: "music song chiptune" },
  { id: "musicVolume", section: "sound", group: "Music", label: "Music volume", keywords: "music loud" },

  // Gameplay
  { id: "turnTimer", section: "gameplay", group: "Playing", label: "Turn timer", hint: "When time runs out in Connect Four or Tic-Tac-Toe, a random move is played for you.", keywords: "timer clock seconds" },
  { id: "confirmLeave", section: "gameplay", group: "Playing", label: "Ask before leaving a round", hint: "Warns you before closing the tab or opening another page mid-round.", keywords: "leave warning confirm" },
  { id: "vibration", section: "gameplay", group: "Playing", label: "Vibration", hint: "Short buzzes on phones for hits, bombs and flags.", keywords: "haptics buzz phone" },
  { id: "tutorials", section: "gameplay", group: "Help", label: "How-to-play tutorials", hint: "Show each game's 4-step tutorial again the next time you open it.", keywords: "tutorial help how to play" },
  { id: "dailyLoginPopup", section: "gameplay", group: "Pop-ups", label: "Daily login reward", hint: "Off: claim it from the 🎁 button on the Hub instead.", keywords: "popup daily reward login" },
  { id: "levelUpPopup", section: "gameplay", group: "Pop-ups", label: "Level-up celebration", hint: "The big pop-up with your new unlocks when you level up.", keywords: "popup level up" },
  { id: "rewardToasts", section: "gameplay", group: "Pop-ups", label: "Reward messages", hint: "The small +coins / +XP message after each game.", keywords: "toast coins xp popup" },

  // Sections with their own panels: found by search, open the section.
  { id: "shortcutKeys", section: "controls", group: "Controls", label: "Shortcut keys", hint: "M mutes, F fullscreen, Esc closes. Turn them on or off.", keywords: "keyboard shortcut mute" },
  { id: "gameKeys", section: "controls", group: "Controls", label: "Game keys", hint: "Change the keys for every game.", keywords: "keyboard rebind key binding controls" },
  { id: "hideLeaderboards", section: "privacy", group: "Privacy", label: "Hide me on leaderboards", hint: "Play without your name on public leaderboards.", keywords: "privacy hidden anonymous" },
  { id: "privateProfile", section: "privacy", group: "Privacy", label: "Private profile", hint: "Your public page shows only your name.", keywords: "privacy profile" },
  { id: "username", section: "account", group: "Account", label: "Change username", hint: "Once every 30 days.", keywords: "name account" },
  { id: "email", section: "account", group: "Account", label: "Change email", keywords: "email mail account" },
  { id: "password", section: "account", group: "Account", label: "Change password", keywords: "password security account" },
  { id: "delete", section: "account", group: "Account", label: "Delete account", hint: "With 7 days to change your mind.", keywords: "delete remove account" },
];

/** Rows matching a search ("vol", "dark mode"…), best matches first. */
export function searchRows<R extends RowInfo>(query: string, rows: R[]): R[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = rows
    .filter((r) => !r.available || r.available())
    .map((r) => {
      const label = r.label.toLowerCase();
      const hay = `${label} ${r.group} ${r.hint ?? ""} ${r.keywords ?? ""} ${r.section}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      const score = words.reduce((n, w) => n + (label.startsWith(w) ? 3 : label.includes(w) ? 2 : 1), 0);
      return { r, score };
    })
    .filter((x): x is { r: R; score: number } => x !== null);
  return scored.sort((a, b) => b.score - a.score).map((x) => x.r);
}
