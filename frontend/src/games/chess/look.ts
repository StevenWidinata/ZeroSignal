import { useState } from "react";

/** Your last-picked board style and piece set (this browser only). */
export interface Look {
  board: string;
  pieces: string;
}

const KEY = "zs.chess.look";
const DEFAULT: Look = { board: "classic", pieces: "classic" };

function read(): Look {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v.board === "string" && typeof v.pieces === "string") return v;
  } catch {
    /* storage blocked or bad JSON */
  }
  return DEFAULT;
}

export function useLook(): [Look, (l: Look) => void] {
  const [look, setLook] = useState<Look>(read);
  return [
    look,
    (l) => {
      setLook(l);
      try {
        localStorage.setItem(KEY, JSON.stringify(l));
      } catch {
        /* ignore */
      }
    },
  ];
}
