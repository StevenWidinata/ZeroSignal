import type { BrickProgress } from "../../api/types";
import { playSfx } from "../../platform/sound";
import { rules, type Level } from "./engine";
import type { ThemeArt } from "./items";
import { LEVELS } from "./levels";
import { Stars } from "./Results";

const fmt = (n: number) => n.toLocaleString();

/** A small map of a level's bricks, drawn in the chosen theme. */
export function LevelMap({ level, theme }: { level: Level; theme: ThemeArt }) {
  const rows = Math.max(...level.bricks.map((b) => b.r)) + 1;
  const color = (b: Level["bricks"][number]) =>
    b.t === "s" ? theme.steel : b.t === "e" ? theme.explosive : b.t === "t" ? theme.tough : theme.rows[b.r % theme.rows.length];
  return (
    <svg className="brick-map" viewBox={`0 0 ${rules.cols * 4} ${rows * 2}`} aria-hidden="true" preserveAspectRatio="xMidYMin meet">
      {level.bricks.map((b, i) => (
        <rect key={i} x={b.c * 4 + 0.25} y={b.r * 2 + 0.25} width={3.5} height={1.5} rx={0.4} fill={color(b)} />
      ))}
    </svg>
  );
}

interface Props {
  progress: BrickProgress | null;
  theme: ThemeArt;
  busy: boolean;
  onPlay: (levelId: number) => void;
}

/** Pick a Campaign level: 24 levels in 2 worlds, each with your stars and best. */
export default function LevelSelect({ progress, theme, busy, onPlay }: Props) {
  const view = (id: number) => progress?.levels.find((l) => l.id === id);
  const worlds = [...new Set(LEVELS.map((l) => l.world))];

  return (
    <div className="ab-levels brick-levels">
      <div className="ab-summary">
        <span>
          <strong>{progress?.total_stars ?? 0}</strong> of {LEVELS.length * 3} stars
        </span>
        <span>
          Total score <strong>{fmt(progress?.total_score ?? 0)}</strong>
          <small> (your best clear of each level added up)</small>
        </span>
      </div>
      {worlds.map((w) => (
        <section key={w} className="ab-world">
          <h2 className="section-title">World {w}</h2>
          <div className="ab-level-grid brick-level-grid">
            {LEVELS.filter((l) => l.world === w).map(({ level: l }) => {
              const v = view(l.id);
              const unlocked = v?.unlocked ?? l.id === 1;
              const cleared = (v?.stars ?? 0) > 0;
              return (
                <button
                  key={l.id}
                  type="button"
                  className={`ab-level brick-level${unlocked ? "" : " locked"}${cleared ? " cleared" : ""}`}
                  disabled={!unlocked || !progress || busy}
                  onClick={() => {
                    playSfx("click");
                    onPlay(l.id);
                  }}
                  aria-label={`Level ${l.id}, ${l.name}${unlocked ? (cleared ? `, ${v?.stars} stars` : "") : ", locked"}`}
                >
                  <span className="brick-level-top">
                    <span className="ab-level-num">{l.id}</span>
                    <Stars n={v?.stars ?? 0} />
                  </span>
                  <LevelMap level={l} theme={theme} />
                  <strong>{l.name}</strong>
                  <small>
                    {unlocked
                      ? v?.best
                        ? `Best ${fmt(v.best)}`
                        : `${l.bricks.filter((b) => b.t !== "s").length} bricks`
                      : `Clear level ${l.id - 1} first`}
                  </small>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <p className="wam-hint">
        Break every brick (steel ones can't break) to clear a level and open the next. Stars are the lives you have left: clear
        with all 3 for 3 stars. Each new star pays 10 coins once.
      </p>
    </div>
  );
}
