import type { RallyFinish, RallyLevel } from "../../api/types";
import ResultsCard from "../../components/run/ResultsCard";
import { itemName } from "./items";
import { LEVEL_INFO, playTime } from "./modes";

interface Props {
  result: RallyFinish;
  level: RallyLevel;
  onAgain: () => void;
  onMenu: () => void;
}

export default function Results({ result, level, onAgain, onMenu }: Props) {
  const s = result.summary;
  const [mine, theirs] = s.score;
  const left = s.ended_by === "quit";
  const verdict = left ? "You left the match" : result.won ? "You won" : s.winner === null ? "Time ran out" : "Zero-Bot won";
  return (
    <ResultsCard
      pose={result.won ? "cheer" : left ? "wave" : "sad"}
      label="Board points from this match"
      score={result.points}
      newBest={false}
      previousBest={0}
      tags={
        <span className="rally-verdict">
          <span className="tag">
            {verdict} {mine}–{theirs} against {LEVEL_INFO[level].name}
          </span>
          {result.total > 0 && <span className="tag">Board total {result.total.toLocaleString()}</span>}
        </span>
      }
      drop={result.drop ? itemName(result.drop) : null}
      onAgain={onAgain}
      onMenu={onMenu}
      menuLabel="Change setup"
    >
      <dl className="wam-stats">
        <div>
          <dt>Your returns</dt>
          <dd>{s.hits[0]}</dd>
        </div>
        <div>
          <dt>Longest rally</dt>
          <dd>{s.longest_rally}</dd>
        </div>
        <div>
          <dt>Powers used</dt>
          <dd>{s.powers[0]}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{playTime(s.game_ms)}</dd>
        </div>
      </dl>
      {left && <p className="wam-hint">A match you leave counts as a loss and pays nothing.</p>}
    </ResultsCard>
  );
}
