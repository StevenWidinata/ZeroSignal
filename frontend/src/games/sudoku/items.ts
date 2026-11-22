/**
 * Sudoku board themes: the same JSON the backend uses
 * (shared/sudoku_items.json). The server decides ownership and prices.
 */
import { useState } from "react";
import raw from "../../../../shared/sudoku_items.json";

export interface ThemeArt {
  page: string;
  cell: string;
  line: string;
  box: string;
  given: string;
  entry: string;
  hint: string;
  select: string;
  same: string;
}

export interface SudokuTheme {
  id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  price: number | null;
  art: ThemeArt;
}

export const THEMES = raw.themes as SudokuTheme[];

export const findTheme = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** CSS variables that paint the board in a theme. */
export function themeVars(id: string): Record<string, string> {
  const a = findTheme(id).art;
  return {
    "--sd-page": a.page,
    "--sd-cell": a.cell,
    "--sd-line": a.line,
    "--sd-box": a.box,
    "--sd-given": a.given,
    "--sd-entry": a.entry,
    "--sd-hint": a.hint,
    "--sd-select": a.select,
    "--sd-same": a.same,
  };
}

/** "theme:neon" → "Neon Grid", for lucky-drop messages. */
export const themeName = (key: string) => THEMES.find((t) => `theme:${t.id}` === key)?.name ?? key;

const KEY = "zs.sudoku.theme";

/** Your picked theme (this browser only). */
export function useTheme(): [string, (id: string) => void] {
  const [theme, setTheme] = useState<string>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v && THEMES.some((t) => t.id === v) ? v : THEMES[0].id;
    } catch {
      return THEMES[0].id;
    }
  });
  return [
    theme,
    (id) => {
      setTheme(id);
      try {
        localStorage.setItem(KEY, id);
      } catch {
        /* storage blocked */
      }
    },
  ];
}
