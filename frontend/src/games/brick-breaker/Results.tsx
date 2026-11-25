import type { ReactNode } from "react";
import type { BrickFinish } from "../../api/types";
import ResultsCard from "../../components/run/ResultsCard";
import { itemName } from "./items";
import { LEVELS } from "./levels";
import { END_TEXT, MODE_INFO, playTime } from "./modes";

/** Runs shorter than this many ticks (10 s) pay nothing unless they clear a level. */
const MIN_REWARD_TICKS = 600;

export function Stars({ n, label }: { n: number; label?: string }) {
  return (
    <span className="ab-stars" role="img" aria-label={label ?? `${n} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? "on" : ""} aria-hidden="true">
          ★
        </span>
      ))}
    </span>
  );
}

interface Props {
  result: BrickFinish;
  onAgain: (() => void) | null;
  onNext: (() => void) | null;
  onMenu: () => void;
  footer?: ReactNode;
}

export default function Results({ result, onAgain, onNext, onMenu, footer }: Props) {
  const s = result.summary;
  const c = result.campaign;
  const lvl = result.level !== null ? LEVELS.find((l) => l.level.id === result.level) : undefined;
  const short = s.ticks < MIN_REWARD_TICKS && !s.cleared;
  const title = lvl ? `Level ${lvl.level.id}: ${lvl.level.name}` : MODE_INFO[result.mode].name;
  return (
    <ResultsCard
      pose={s.cleared || result.new_best ? "cheer" : s.ended_by === "quit" || s.score > 0 ? "wave" : "sad"}
      label={
        <>
          {title} · {s.ended_by ? END_TEXT[s.ended_by] : ""}
        </>
      }
      score={s.score}
      newBest={result.new_best}
      previousBest={result.previous_best}
      tags={
        c && (
          <div className="brick-result-stars">
            <Stars n={s.cleared ? s.stars : 0} label={s.cleared ? `${s.stars} of 3 stars this run` : "Not cleared"} />
            {c.new_stars > 0 ? (
              <span className="tag tag-yellow">
                +{c.new_stars} new {c.new_stars === 1 ? "star" : "stars"}, +{c.star_coins} coins
              </span>
            ) : (
              s.cleared && c.stars > s.stars && <small>Your best here is {c.stars} stars</small>
            )}
            {c.unlocked_next && <span className="tag tag-blue">Level {c.unlocked_up_to} is open</span>}
          </div>
        )
      }
      drop={result.drop ? itemName(result.drop) : null}
      footer={footer}
      next={onNext ? { label: "Next level", onClick: onNext } : null}
      onAgain={onAgain}
      onMenu={onMenu}
      menuLabel={c ? "Levels" : "Change mode"}
    >
      <dl className="wam-stats">
        <div>
          <dt>Bricks</dt>
          <dd>{s.bricks}</dd>
        </div>
        {c ? (
          <div>
            <dt>Lives left</dt>
            <dd>{s.lives}</dd>
          </div>
        ) : (
          <div>
            <dt>Wave</dt>
            <dd>{s.wave}</dd>
          </div>
        )}
        <div>
          <dt>Best combo</dt>
          <dd>{s.best_combo}</dd>
        </div>
        <div>
          <dt>Biggest chain</dt>
          <dd>{s.best_chain}</dd>
        </div>
        <div>
          <dt>Drops caught</dt>
          <dd>{s.drops}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{playTime(s.game_ms)}</dd>
        </div>
      </dl>
      {c && (
        <p className="wam-hint">
          Campaign: {c.total_stars} of {LEVELS.length * 3} stars, total score {c.total_score.toLocaleString()}.
        </p>
      )}
      {short && <p className="wam-hint">Runs shorter than 10 seconds still score, but don't pay rewards or count for quests.</p>}
    </ResultsCard>
  );
}
