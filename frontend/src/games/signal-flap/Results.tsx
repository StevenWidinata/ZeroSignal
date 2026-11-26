import type { ReactNode } from "react";
import type { FlapFinish } from "../../api/types";
import ResultsCard from "../../components/run/ResultsCard";
import { itemName } from "./items";
import { END_TEXT, MODE_INFO, playTime } from "./modes";

/** Runs shorter than this many ticks (10 s) pay nothing. */
const MIN_REWARD_TICKS = 600;

interface Props {
  result: FlapFinish;
  onAgain: (() => void) | null;
  onMenu: () => void;
  footer?: ReactNode;
}

export default function Results({ result, onAgain, onMenu, footer }: Props) {
  const s = result.summary;
  const short = s.ticks < MIN_REWARD_TICKS;
  return (
    <ResultsCard
      pose={result.new_best ? "cheer" : s.score > 0 ? "wave" : "sad"}
      label={
        <>
          {MODE_INFO[result.mode].name} · {s.ended_by ? END_TEXT[s.ended_by] : ""}
        </>
      }
      score={s.score}
      newBest={result.new_best}
      previousBest={result.previous_best}
      drop={result.drop ? itemName(result.drop) : null}
      footer={footer}
      onAgain={onAgain}
      onMenu={onMenu}
      menuLabel="Change mode"
    >
      <dl className="wam-stats">
        <div>
          <dt>Gaps</dt>
          <dd>{s.gaps}</dd>
        </div>
        <div>
          <dt>Signal bars</dt>
          <dd>{s.bars}</dd>
        </div>
        <div>
          <dt>Flaps</dt>
          <dd>{s.flaps}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{playTime(s.game_ms)}</dd>
        </div>
      </dl>
      {short && <p className="wam-hint">Runs shorter than 10 seconds still score, but don't pay rewards or count for quests.</p>}
    </ResultsCard>
  );
}
