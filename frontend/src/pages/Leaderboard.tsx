import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import { api, rooms } from "../api/client";
import WeeklyPrizes from "../components/WeeklyPrizes";
import { formatCountdown, nextWeekReset } from "../platform/week";
import type { LeaderboardEntry, LeaderboardPeriod, MyScoresResponse, OnlineEntry, OnlineGame } from "../api/types";
import Avatar from "../character/Avatar";
import { normalizeLoadout } from "../character/catalog";
import TitleBadge from "../components/TitleBadge";
import { isOnlineOnly } from "../platform/playStyles";
import { boardCells } from "../platform/boardScore";
import { GAMES, LIVE_GAMES, findGame } from "../platform/registry";
import { useAuth } from "../store/auth";
import BackButton from "../components/BackButton";

const fmt = (n: number) => n.toLocaleString();

export default function Leaderboard() {
  const { gameId } = useParams();
  const game = findGame(gameId);
  const user = useAuth((s) => s.user);
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [mine, setMine] = useState<MyScoresResponse | null>(null);
  /** Online-only games: most online series won. */
  const [champions, setChampions] = useState<OnlineEntry[] | null>(null);
  const onlineOnly = !!game && isOnlineOnly(game);
  const [error, setError] = useState<string | null>(null);
  const [boardIdx, setBoardIdx] = useState(0);
  const boards = game?.meta.boards;
  const board = boards?.[boardIdx] ?? boards?.[0];
  const [period, setPeriod] = useState<Exclude<LeaderboardPeriod, "today">>("all");
  // Daily boards are always "today"; the rest follow the period switch.
  const effectivePeriod: LeaderboardPeriod = board?.period ?? period;

  // Each game starts on its first board (or its Daily with ?board=daily).
  const [params] = useSearchParams();
  const wantDaily = params.get("board") === "daily";
  useEffect(() => {
    const daily = wantDaily ? (boards?.findIndex((b) => b.period === "today") ?? -1) : -1;
    setBoardIdx(Math.max(0, daily));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, wantDaily]);

  useEffect(() => {
    if (!game) return;
    let cancelled = false; // ignore stale responses when switching tabs
    setEntries(null);
    setError(null);
    if (onlineOnly) {
      setChampions(null);
      rooms
        .leaderboard(game.meta.id as OnlineGame)
        .then((c) => !cancelled && setChampions(c))
        .catch((e) => {
          if (cancelled) return;
          setChampions([]);
          setError(e instanceof Error ? e.message : "failed to load leaderboard");
        });
      return () => {
        cancelled = true;
      };
    }
    api
      .leaderboard(game.meta.id, { level: board?.level, period: effectivePeriod })
      .then((e) => !cancelled && setEntries(e))
      .catch((e) => {
        if (cancelled) return;
        setEntries([]);
        setError(e instanceof Error ? e.message : "failed to load leaderboard");
      });
    return () => {
      cancelled = true;
    };
  }, [game, board, effectivePeriod]);

  useEffect(() => {
    if (!game || !user || onlineOnly) {
      setMine(null);
      return;
    }
    let cancelled = false;
    api
      .myScores(game.meta.id)
      .then((m) => !cancelled && setMine(m))
      .catch(() => !cancelled && setMine(null));
    return () => {
      cancelled = true;
    };
  }, [game, user]);

  if (!game) return <Navigate to={`/leaderboard/${GAMES[0].meta.id}`} replace />;

  const { meta } = game;
  const live = meta.status === "live";
  const showBird = mine?.scores.some((s) => s.bird_variant) ?? false;
  const detail = board?.detailLabel ?? meta.detailLabel;
  const cols = detail ? 4 : 3;

  return (
    <div className="board-page">
      <div className="page-head">
        <div>
          <BackButton />
          <h1 style={{ marginTop: 12 }}>🏆 High scores</h1>
          <p>Top 20 per game, all time or per week. Every score is verified by the server.</p>
        </div>
        {live && (
          <Link to={`/play/${meta.id}`} className="btn btn-green">
            ▶ Play {meta.title}
          </Link>
        )}
      </div>

      <WeeklyPrizes />

      <nav className="tabs" aria-label="Choose game leaderboard">
        {LIVE_GAMES.map((g) => (
          <NavLink
            key={g.meta.id}
            to={`/leaderboard/${g.meta.id}`}
            className={({ isActive }) => `tab${isActive ? " active" : ""}`}
          >
            <span aria-hidden="true">{g.meta.icon}</span> {g.meta.title}
            {g.meta.status !== "live" && <span className="tag tag-yellow">Soon</span>}
          </NavLink>
        ))}
      </nav>

      {boards && (
        <div className="board-subtabs segmented" role="radiogroup" aria-label={`${meta.title} boards`}>
          {boards.map((b, i) => (
            <button
              key={b.level ?? "all"}
              role="radio"
              aria-checked={board === b}
              className={`btn-sm${board === b ? "" : " btn-ghost"}`}
              onClick={() => setBoardIdx(i)}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}

      {onlineOnly && (
        <>
          <p className="wam-hint">{meta.title} is played online with friends: the board counts online series won (all time).</p>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="board-table-wrap">
            <table className="board-table">
              <caption className="sr-only">{meta.title} online champions</caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Player</th>
                  <th scope="col">Series won</th>
                  <th scope="col">Played</th>
                </tr>
              </thead>
              <tbody>
                {champions === null && (
                  <tr>
                    <td colSpan={4} className="empty">
                      Loading…
                    </td>
                  </tr>
                )}
                {champions?.map((e) => (
                  <tr key={e.rank} className={user?.username === e.username ? "me" : ""}>
                    <td>
                      <span className={`rank rank-${e.rank}`}>{e.rank}</span>
                    </td>
                    <td>
                      <Link to={`/u/${encodeURIComponent(e.username)}`} className="board-player">
                        <Avatar loadout={e.avatar} size={32} crop="head" animated={e.rank <= 3} />
                        <strong>{e.username}</strong>
                        <TitleBadge id={normalizeLoadout(e.avatar).title} small />
                      </Link>
                      {user?.username === e.username && (
                        <>
                          {" "}
                          <span className="tag">You</span>
                        </>
                      )}
                    </td>
                    <td className="num">{fmt(e.wins)}</td>
                    <td className="num">{fmt(e.played)}</td>
                  </tr>
                ))}
                {champions?.length === 0 && !error && (
                  <tr>
                    <td colSpan={4} className="empty">
                      Nobody has won an online series yet. Be the first!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!onlineOnly && !board?.period && (
        <div className="board-period">
          <div className="segmented" role="radiogroup" aria-label="Time period">
            {(
              [
                ["all", "All time"],
                ["week", "This week"],
                ["last_week", "Last week"],
              ] as const
            ).map(([p, label]) => (
              <button
                key={p}
                role="radio"
                aria-checked={period === p}
                className={`btn-sm${period === p ? "" : " btn-ghost"}`}
                onClick={() => setPeriod(p)}
              >
                {label}
              </button>
            ))}
          </div>
          {period === "week" && (
            <small>
              New week starts in {formatCountdown(nextWeekReset(new Date()).getTime() - Date.now())} (Monday 00:00 WIB). The top 3 win
              coins.
            </small>
          )}
          {period === "last_week" && <small>Final standings. The top 3 claim their prize from the banner.</small>}
        </div>
      )}

      {!onlineOnly && error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {!onlineOnly && (
        <div className="board-table-wrap">
          <table className="board-table">
            <caption className="sr-only">{meta.title} leaderboard</caption>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Player</th>
                <th scope="col">{board?.scoreLabel ?? meta.scoreLabel}</th>
                {detail && <th scope="col">{detail}</th>}
              </tr>
            </thead>
            <tbody>
              {entries === null && (
                <tr>
                  <td colSpan={cols} className="empty">
                    Loading…
                  </td>
                </tr>
              )}
              {entries?.map((e) => (
                <tr key={e.rank} className={user?.username === e.username ? "me" : ""}>
                  <td>
                    <span className={`rank rank-${e.rank}`}>{e.rank}</span>
                  </td>
                  <td>
                    <Link to={`/u/${encodeURIComponent(e.username)}`} className="board-player">
                      <Avatar loadout={e.avatar} size={32} crop="head" animated={e.rank <= 3} />
                      <strong>{e.username}</strong>
                      <TitleBadge id={normalizeLoadout(e.avatar).title} small />
                    </Link>
                    {user?.username === e.username && (
                      <>
                        {" "}
                        <span className="tag">You</span>
                      </>
                    )}
                  </td>
                  {(() => {
                    const c = boardCells(board, e.best_score, e.detail);
                    return (
                      <>
                        <td className="num">{c.main}</td>
                        {detail && <td className="num">{c.extra}</td>}
                      </>
                    );
                  })()}
                </tr>
              ))}
              {entries?.length === 0 && !error && (
                <tr>
                  <td colSpan={cols} className="empty">
                    {live
                      ? "No scores yet. Be the first legend."
                      : `${meta.title} is coming soon. Its board opens on launch day.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {live && mine && !onlineOnly && (
        <section>
          <h2>Your runs · best {fmt(mine.best_score)}</h2>
          <div className="board-table-wrap">
            <table className="board-table">
              <thead>
                <tr>
                  <th scope="col">Score</th>
                  {meta.detailLabel && <th scope="col">{meta.detailLabel}</th>}
                  {showBird && <th scope="col">Bird</th>}
                  <th scope="col">{boards ? "Mode" : "Level"}</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {mine.scores.map((s, i) => (
                  <tr key={i}>
                    {(() => {
                      const c = boardCells(boards?.find((b) => b.level === s.level), s.score, s.detail, true);
                      return (
                        <>
                          <td className="num">{c.main}</td>
                          {meta.detailLabel && <td className="num">{c.extra}</td>}
                        </>
                      );
                    })()}
                    {showBird && (
                      <td style={{ textTransform: "capitalize" }}>{s.bird_variant ?? "-"}</td>
                    )}
                    <td>{boards?.find((b) => b.level === s.level)?.label ?? s.level}</td>
                    <td>{new Date(s.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {mine.scores.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      No runs yet. Go play!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
