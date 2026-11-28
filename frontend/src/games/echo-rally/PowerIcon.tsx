import type { Power } from "./engine";

/** One line drawing per power, on a 24 x 24 grid. */
const PATHS: Record<Power, string> = {
  grow: "M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4",
  shrink: "M12 3v6M12 15v6M8 5l4 4 4-4M8 19l4-4 4 4M6 12h12",
  smash: "M13 2L5 14h6l-1 8 8-12h-6z",
  shield: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z",
  echo: "M5 12h2M9.5 7.5a6.5 6.5 0 010 9M13.5 4.5a11 11 0 010 15M17.5 2.5a14 14 0 010 19",
  curve: "M4 19C4 9 20 15 20 5M16 5h4v4",
  freeze: "M12 2v20M3.5 7l17 10M3.5 17l17-10M9 4l3 2 3-2M9 20l3-2 3 2",
  "multi-ball": "M8.5 13.5a4 4 0 100 .01M16 7a3.5 3.5 0 100 .01",
  ghost: "M5 21V11a7 7 0 0114 0v10l-2.5-2-2.5 2-2-2-2 2-2.5-2zM9.5 11h.01M14.5 11h.01",
  fog: "M3 8c3-2 6 2 9 0s6-2 9 0M3 13c3-2 6 2 9 0s6-2 9 0M3 18c3-2 6 2 9 0s6-2 9 0",
};

export default function PowerIcon({ power, size = 18 }: { power: Power; size?: number }) {
  return (
    <svg
      className="rally-power-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[power]} />
    </svg>
  );
}
