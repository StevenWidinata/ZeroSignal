import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { StatsView } from "../api/types";
import QuestList from "../components/QuestList";
import WeeklyPrizes from "../components/WeeklyPrizes";
import {
  PLAY_FILTERS,
  countBy,
  filterGames,
  filterInfo,
  loadFilter,
  playInfo,
  saveFilter,
  sortedStyles,
  type PlayFilter,
} from "../platform/playStyles";
import { recentGames } from "../platform/recent";
import { GAMES, LIVE_GAMES, findGame } from "../platform/registry";
import type { GameModule } from "../platform/types";
import { isMember, useAuth } from "../store/auth";
import { LiveAvatar } from "../character/Live";
import { rewardWaiting, useDailyLogin } from "../store/dailyLogin";
import { useCharacter } from "../store/character";
import { useWallet } from "../store/wallet";
import { sumBoards } from "./statsLogic";

const fmt = (n: number) => n.toLocaleString();

/** Your best on a game (best score, or points for running-total games). */
function bestOf(stats: StatsView | null, id: string): number {
  return stats ? sumBoards(stats.boards, id).best : 0;
}

function GameCard({ game, best }: { game: GameModule; best: number }) {
  const { meta } = game;
  const live = meta.status === "live" && !!game.Play;
  return (
    <article className={`game-card accent-${meta.accent}${live ? "" : " is-soon"}`} aria-labelledby={`game-${meta.id}-title`}>
      <div className="game-card-art" aria-hidden="true">
        <span className="game-card-icon">{meta.icon}</span>
        {!live && <span className="ribbon">Coming soon</span>}
      </div>
      <div className="game-card-body">
        <h2 id={`game-${meta.id}-title`}>{meta.title}</h2>
        <p>{meta.tagline}</p>
        <ul className="play-badges" aria-label="How you can play">
          {sortedStyles(meta.play).map((id) => {
            const p = playInfo(id);
            return (
              <li key={id} className={`play-badge play-${id}`} title={p.hint}>
                <span aria-hidden="true">{p.icon}</span> {p.badge}
              </li>
            );
          })}
        </ul>
        <ul className="tag-list" aria-label="Tags">
          {meta.tags.map((t) => (
            <li key={t} className="tag tag-outline">
              {t}
            </li>
          ))}
        </ul>
        {best > 0 && (
          <p className="game-card-best">
            {meta.scoreLabel}: <strong>{fmt(best)}</strong>
          </p>
        )}
      </div>
      <div className="game-card-actions">
        {live ? (
          <>
            <Link to={`/play/${meta.id}`} className="btn">
              ▶ Play
            </Link>
            <Link to={`/leaderboard/${meta.id}`} className="btn btn-ghost btn-sm">
              🏆 Scores
            </Link>
          </>
        ) : (
          <button disabled aria-disabled="true">
            Locked
          </button>
        )}
      </div>
    </article>
  );
}

/** Logged in: you, your level, and where to pick up. */
function WelcomeStrip({ continueId }: { continueId: string | undefined }) {
  const user = useAuth((s) => s.user);
  const wallet = useWallet((s) => s.wallet);
  const loadout = useCharacter((s) => s.view?.loadout);
  const loadCharacter = useCharacter((s) => s.load);
  useEffect(() => {
    if (!loadout) void loadCharacter();
  }, [loadout, loadCharacter]);
  const next = continueId ? findGame(continueId) : undefined;
  // Wave hello for a few seconds when you arrive.
  const [greeting, setGreeting] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setGreeting(false), 3500);
    return () => window.clearTimeout(id);
  }, []);
  const dailyStatus = useDailyLogin((s) => s.status);
  const openDaily = useDailyLogin((s) => s.open);
  const pct = wallet?.xp_for_next ? Math.min(100, (wallet.xp_into_level / wallet.xp_for_next) * 100) : 0;

  return (
    <section className="welcome panel" aria-label="Your progress">
      <Link to="/profile" className="welcome-avatar" aria-label="Your character">
        {loadout ? <LiveAvatar loadout={loadout} size={72} pose={greeting ? "wave" : "idle"} bubble={greeting} /> : <span aria-hidden="true">🙂</span>}
      </Link>
      <div className="welcome-main">
        <h1>Welcome back, {user?.username}!</h1>
        {wallet && (
          <div className="welcome-level">
            <span className="tag">Level {wallet.level}</span>
            <div
              className="quest-bar"
              role="progressbar"
              aria-label="XP to next level"
              aria-valuemin={0}
              aria-valuemax={wallet.xp_for_next}
              aria-valuenow={wallet.xp_into_level}
            >
              <span style={{ width: `${pct}%` }} />
            </div>
            <small>
              {fmt(wallet.xp_into_level)} / {fmt(wallet.xp_for_next)} XP · {fmt(wallet.coins)} 🪙 · {wallet.tokens} tokens
            </small>
          </div>
        )}
      </div>
      <div className="welcome-actions">
        {next ? (
          <Link to={`/play/${next.meta.id}`} className="btn btn-green">
            ▶ Continue {next.meta.title}
          </Link>
        ) : (
          <a href="#games" className="btn btn-green">
            ▶ Pick a game
          </a>
        )}
        {rewardWaiting(dailyStatus) && (
          <button className="btn-sm" onClick={openDaily}>
            🎁 Daily reward
          </button>
        )}
        <Link to="/stats" className="btn btn-ghost btn-sm">
          📊 Stats
        </Link>
        <Link to="/achievements" className="btn btn-ghost btn-sm">
          🏅 Achievements
        </Link>
      </div>
    </section>
  );
}

function RecentRow({ ids, stats }: { ids: string[]; stats: StatsView | null }) {
  const games = ids.map((id) => findGame(id)).filter((g): g is GameModule => !!g && g.meta.status === "live");
  return (
    <section aria-labelledby="recent-heading" className="hub-recent">
      <h2 id="recent-heading" className="section-title">
        🕹️ Recently played
      </h2>
      {games.length === 0 ? (
        <p className="stats-empty">Nothing yet. Pick a game below and it shows up here.</p>
      ) : (
        <ul className="recent-list">
          {games.map((g) => {
            const best = bestOf(stats, g.meta.id);
            return (
              <li key={g.meta.id} className={`recent-item accent-${g.meta.accent}`}>
                <span className="recent-icon" aria-hidden="true">
                  {g.meta.icon}
                </span>
                <span className="recent-text">
                  <strong>{g.meta.title}</strong>
                  <small>{best > 0 ? `${g.meta.scoreLabel}: ${fmt(best)}` : "No score yet"}</small>
                </span>
                <Link to={`/play/${g.meta.id}`} className="btn btn-sm" aria-label={`Play ${g.meta.title}`}>
                  ▶
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Chips that filter the game grids by how you can play. */
function PlayFilterBar({ value, onChange }: { value: PlayFilter; onChange: (f: PlayFilter) => void }) {
  return (
    <div className="play-filter" role="radiogroup" aria-label="Show games you can play">
      {PLAY_FILTERS.map((f) => {
        const info = filterInfo(f);
        const n = countBy(LIVE_GAMES, f);
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={value === f}
            title={info?.hint ?? "Every game"}
            className={`play-chip${value === f ? " selected" : ""}`}
            onClick={() => onChange(f)}
          >
            {info && <span aria-hidden="true">{info.icon}</span>}
            <span>{info ? info.label : "All games"}</span>
            <span className="play-chip-count">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function Hub() {
  const user = useAuth((s) => s.user);
  const [filter, setFilter] = useState<PlayFilter>(loadFilter);
  const pickFilter = (f: PlayFilter) => {
    setFilter(f);
    saveFilter(f);
  };
  const liveShown = filterGames(LIVE_GAMES, filter);
  const soonShown = filterGames(GAMES.filter((g) => g.meta.status !== "live"), filter);
  const shownInfo = filterInfo(filter);
  const [stats, setStats] = useState<StatsView | null>(null);
  const recent = useMemo(() => recentGames().filter((id) => findGame(id)?.meta.status === "live"), []);

  useEffect(() => {
    if (!user) {
      setStats(null);
      return;
    }
    let cancelled = false;
    api
      .stats()
      .then((s) => !cancelled && setStats(s))
      .catch(() => !cancelled && setStats(null));
    return () => {
      cancelled = true;
    };
  }, [user]);

  const quickPlay = recent[0] ?? LIVE_GAMES[0]?.meta.id ?? "sling-squad";

  return (
    <div className="hub">
      {isMember(user) ? (
        <WelcomeStrip continueId={recent[0]} />
      ) : (
        <section className="hero hero-compact">
          <p className="eyebrow">▶ INSERT COIN</p>
          <h1 className="hero-title">
            ZERO<span>SIGNAL</span>
          </h1>
          <p className="hero-sub">
            {LIVE_GAMES.length} arcade games with real leaderboards. Every score is checked by the server, so the top spot actually
            means something. Jump in now: no account needed until you want to save your scores.
          </p>
          <div className="hero-actions">
            <Link to={`/play/${quickPlay}`} className="btn btn-green">
              ▶ {user ? "Keep playing" : "Play now"}
            </Link>
            <Link to="/register" className="btn btn-ghost">
              {user ? "Register to save" : "Create account"}
            </Link>
            <Link to="/login" className="btn btn-ghost">
              Log in
            </Link>
          </div>
        </section>
      )}

      <WeeklyPrizes />

      {user && (
        <div className="hub-top">
          <RecentRow ids={recent} stats={stats} />
          <section aria-labelledby="quests-heading" className="hub-quests">
            <div className="hub-quests-head">
              <h2 id="quests-heading" className="section-title">
                📜 Today's quests
              </h2>
              {isMember(user) && (
                <Link to="/quests" className="btn btn-ghost btn-sm">
                  All quests →
                </Link>
              )}
            </div>
            {isMember(user) ? (
              <QuestList />
            ) : (
              <div className="recent-item">
                <span className="recent-icon" aria-hidden="true">
                  📜
                </span>
                <span className="recent-text">
                  <strong>Your quests are counting</strong>
                  <small>Register to claim the rewards.</small>
                </span>
                <Link to="/register" className="btn btn-sm">
                  Register
                </Link>
              </div>
            )}
          </section>
        </div>
      )}

      <section aria-labelledby="games-heading" id="games">
        <h2 id="games-heading" className="section-title">
          Choose your game
        </h2>
        <PlayFilterBar value={filter} onChange={pickFilter} />
        {shownInfo && <p className="play-filter-hint">{shownInfo.hint}</p>}
        {liveShown.length === 0 ? (
          <p className="stats-empty">No games like that yet. More are coming soon.</p>
        ) : (
          <div className="game-grid">
            {liveShown.map((g) => (
              <GameCard key={g.meta.id} game={g} best={bestOf(stats, g.meta.id)} />
            ))}
          </div>
        )}
      </section>

      {soonShown.length > 0 && (
        <section aria-labelledby="soon-heading" className="hub-soon">
          <div className="hub-quests-head">
            <h2 id="soon-heading" className="section-title">
              🛠️ Coming soon
            </h2>
            <Link to="/roadmap" className="btn btn-ghost btn-sm">
              Roadmap →
            </Link>
          </div>
          <div className="game-grid">
            {soonShown.map((g) => (
              <GameCard key={g.meta.id} game={g} best={0} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
