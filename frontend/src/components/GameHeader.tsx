import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { findGame } from "../platform/registry";
import BackButton from "./BackButton";

/**
 * The top of every game screen (Game Kit): back button, title, an optional
 * tag for the current mode, the game's tagline and its leaderboard.
 */
export default function GameHeader({ gameId, tag }: { gameId: string; tag?: ReactNode }) {
  const meta = findGame(gameId)?.meta;
  return (
    <div className="page-head">
      <div>
        <BackButton />
        <h1 style={{ marginTop: 12 }}>
          {meta?.icon} {meta?.title ?? gameId}
          {tag ? <> {tag}</> : null}
        </h1>
        {meta && <p>{meta.tagline}</p>}
      </div>
      <Link to={`/leaderboard/${gameId}`} className="btn btn-blue btn-sm">
        🏆 Leaderboard
      </Link>
    </div>
  );
}
