import type { ReactNode } from "react";
import { MyReaction } from "../../character/Live";
import { SaveScorePrompt } from "../Guest";

const fmt = (n: number) => n.toLocaleString();

interface Props {
  /** How your character reacts. */
  pose: Parameters<typeof MyReaction>[0]["pose"];
  /** Small line above the score ("Final score", mode name…). */
  label: ReactNode;
  score: number;
  newBest: boolean;
  previousBest: number;
  /** Extra tags / notes under the score. */
  tags?: ReactNode;
  /** Lucky-drop item name, if one dropped. */
  drop?: string | null;
  /** Stats, breakdowns… */
  children?: ReactNode;
  /** Shown above the buttons (e.g. a Daily share card). */
  footer?: ReactNode;
  onAgain: (() => void) | null;
  onMenu: () => void;
  menuLabel?: string;
  /** A main action shown before "Play again" (e.g. "Next level"). */
  next?: { label: string; onClick: () => void } | null;
}

/** The results card every score game ends on (see docs/GAME_KIT.md). */
export default function ResultsCard({
  pose,
  label,
  score,
  newBest,
  previousBest,
  tags,
  drop,
  children,
  footer,
  onAgain,
  onMenu,
  menuLabel = "Change mode",
  next = null,
}: Props) {
  return (
    <div className="panel wam-results">
      <MyReaction pose={pose} />
      <div className="wam-results-head">
        <small>{label}</small>
        <strong className="wam-final">{fmt(score)}</strong>
        {newBest ? (
          <span className="tag tag-yellow wam-best">★ New best!</span>
        ) : (
          previousBest > 0 && <span className="tag">Best: {fmt(previousBest)}</span>
        )}
        {tags}
      </div>

      {drop && (
        <div className="wam-drop" role="status">
          🎁 <strong>Lucky drop!</strong> You got the <strong>{drop}</strong>. Pick it on the setup screen.
        </div>
      )}

      {children}
      {footer}
      <SaveScorePrompt />

      <div className="game-controls">
        {next && (
          <button className="btn-green" onClick={next.onClick} autoFocus>
            {next.label}
          </button>
        )}
        {onAgain && (
          <button className={next ? "btn-ghost" : "btn-green"} onClick={onAgain} autoFocus={!next}>
            ↻ Play again
          </button>
        )}
        <button className={onAgain || next ? "btn-ghost" : "btn-green"} onClick={onMenu} autoFocus={!onAgain && !next}>
          {menuLabel}
        </button>
      </div>
    </div>
  );
}
