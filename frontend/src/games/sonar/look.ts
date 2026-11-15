import { useState } from "react";

/** Your last-picked fleet look and sea (this browser only). */
export interface Look {
  fleet: string;
  sea: string;
}

const KEY = "zs.sonar.look";
const DEFAULT: Look = { fleet: "navy", sea: "ocean" };

function read(): Look {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v.fleet === "string" && typeof v.sea === "string") return v;
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
