import { useEffect, useState } from "react";
import { sonar } from "../../api/client";
import type { SonarOpProgress } from "../../api/types";
import { LEVEL_LABEL } from "./AiGame";
import { MISSIONS, STAR_COINS, starGoals, twistTags } from "./missions";

/** ★★☆ */
export const Stars = ({ n }: { n: number }) => (
  <span className="sonar-stars" aria-label={`${n} of 3 stars`}>
    <span aria-hidden="true">
      {"★".repeat(n)}
      <span className="off">{"★".repeat(3 - n)}</span>
    </span>
  </span>
);

/**
 * The Campaign: 12 Tactics missions vs Zero-Bot, each with a twist. They open
 * one by one; every new star pays coins once.
 */
export default function Campaign({ onPlay }: { onPlay: (op: number) => void }) {
  const [progress, setProgress] = useState<SonarOpProgress[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sonar
      .campaign()
      .then(setProgress)
      .catch((e) => setError(e instanceof Error ? e.message : "could not load the Campaign"));
  }, []);

  if (error)
    return (
      <div className="error" role="alert">
        {error}
      </div>
    );
  if (!progress) return <div className="loading">Loading the Campaign</div>;
  const total = progress.reduce((n, p) => n + p.stars, 0);

  return (
    <div className="sonar-campaign">
      <div className="sonar-mode-blurb">
        <h3>🎖️ Campaign</h3>
        <p>
          12 Tactics missions against Zero-Bot, each with a twist. Win a mission to open the next. Stars: win, win in few moves, win without losing a ship;
          each new star pays {STAR_COINS} coins × the mission number. <strong>{total}/36 ★</strong>
        </p>
      </div>
      <ol className="sonar-missions">
        {MISSIONS.map((m) => {
          const p = progress.find((x) => x.id === m.id);
          const open = !!p?.unlocked;
          return (
            <li key={m.id} className={open ? "" : "locked"}>
              <span className="sonar-mission-no">{m.id}</span>
              <div className="sonar-mission-text">
                <strong>{m.name}</strong> <small>· Zero-Bot {LEVEL_LABEL[m.level]}</small>
                <p>{m.brief}</p>
                <div className="sonar-mission-tags">
                  {twistTags(m).map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </div>
                <small className="hint-inline" title={starGoals(m).join(" · ")}>
                  ★ {starGoals(m).join(" · ")}
                  {p?.best_moves ? ` · best: ${p.best_moves} moves` : ""}
                </small>
              </div>
              <div className="sonar-mission-side">
                <Stars n={p?.stars ?? 0} />
                {open ? (
                  <button className="btn-green btn-sm" onClick={() => onPlay(m.id)}>
                    {p?.stars ? "↻ Replay" : "▶ Play"}
                  </button>
                ) : (
                  <small>🔒 Win mission {m.id - 1}</small>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
