import type { ReactNode } from "react";
import type { SnakeFinish } from "../../api/types";
import ResultsCard from "../../components/run/ResultsCard";
import { rules } from "./engine";
import { itemName } from "./items";
import { END_TEXT, MODE_INFO, SIZE_INFO } from "./modes";

const fmt = (n: number) => n.toLocaleString();

/** "1:05" from ms. */
export function playTime(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.trunc(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface Props {
  result: SnakeFinish;
  onAgain: (() => void) | null;
  onMenu: () => void;
  footer?: ReactNode;
}

export default function Results({ result, onAgain, onMenu, footer }: Props) {
  const s = result.summary;
  const pct = rules.size_pct[result.size];
  const short = s.ticks < 100;
  return (
    <ResultsCard
      pose={result.new_best ? "cheer" : s.ended_by === "quit" || s.score > 0 ? "wave" : "sad"}
      label={
        <>
          {MODE_INFO[result.mode].icon} {MODE_INFO[result.mode].name}
          {result.mode !== "daily" && ` · ${SIZE_INFO[result.size].name}`} · {s.ended_by ? END_TEXT[s.ended_by] : ""}
        </>
      }
      score={s.score}
      newBest={result.new_best}
      previousBest={result.previous_best}
      tags={
        <>
          {s.best_combo >= 5 && <span className="tag tag-blue">🔥 ×5 combo reached</span>}
          {s.bugs_eaten > 0 && <span className="tag">👾 Glitch bug eaten</span>}
          {pct !== 100 && (
            <small>
              {fmt(s.raw)} points × {pct / 100} ({SIZE_INFO[result.size].name} board)
            </small>
          )}
        </>
      }
      drop={result.drop ? itemName(result.drop) : null}
      footer={footer}
      onAgain={onAgain}
      onMenu={onMenu}
    >
      <dl className="wam-stats">
        <div>
          <dt>Longest</dt>
          <dd>{s.max_length}</dd>
        </div>
        <div>
          <dt>Packets</dt>
          <dd>
            {s.eaten}
            {s.golden > 0 && <small> + {s.golden}★</small>}
          </dd>
        </div>
        <div>
          <dt>Best combo</dt>
          <dd>×{s.best_combo}</dd>
        </div>
        <div>
          <dt>Power-ups</dt>
          <dd>{s.powers}</dd>
        </div>
        <div>
          <dt>Close calls</dt>
          <dd>{s.close_calls}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{playTime(s.game_ms)}</dd>
        </div>
      </dl>
      {short && <p className="wam-hint">Runs shorter than 100 steps still score, but don't pay rewards or count for quests.</p>}
    </ResultsCard>
  );
}
