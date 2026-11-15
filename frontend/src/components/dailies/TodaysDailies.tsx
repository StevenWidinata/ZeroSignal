import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { DailyView } from "../../api/types";
import { findGame } from "../../platform/registry";
import { dailyLine, dailyLink, doneCount } from "./logic";

/** Hub panel: every game's Daily, whether you've played it, score and rank. */
export default function TodaysDailies() {
  const [list, setList] = useState<DailyView[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .dailies()
      .then((l) => !cancelled && setList(l))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="dailies-heading" className="hub-dailies">
      <div className="hub-quests-head">
        <h2 id="dailies-heading" className="section-title">
          📅 Today's Dailies
        </h2>
        {list && <span className="tag">{doneCount(list)}</span>}
      </div>
      {failed && <p className="stats-empty">Couldn't load today's Dailies.</p>}
      {!list && !failed && <p className="muted">Loading Dailies…</p>}
      {list && (
        <ul className="recent-list">
          {list.map((d) => {
            const g = findGame(d.game_id);
            if (!g) return null;
            const line = dailyLine(d);
            return (
              <li key={d.game_id} className={`recent-item accent-${g.meta.accent}${d.status === "done" ? " daily-done" : ""}`}>
                <span className="recent-icon" aria-hidden="true">
                  {g.meta.icon}
                </span>
                <span className="recent-text">
                  <strong>{g.meta.title}</strong>
                  <small>{line.text}</small>
                </span>
                {line.action === "board" ? (
                  <Link
                    to={`/leaderboard/${d.game_id}?board=daily`}
                    className="btn btn-ghost btn-sm"
                    aria-label={`${g.meta.title}: today's Daily leaderboard`}
                  >
                    🏆
                  </Link>
                ) : (
                  <Link
                    to={dailyLink(d.game_id)}
                    className="btn btn-sm"
                    aria-label={`${line.action === "continue" ? "Continue" : "Play"} ${g.meta.title}'s Daily`}
                  >
                    ▶
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
