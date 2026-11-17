import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { findGame } from "../../platform/registry";
import { playSfx } from "../../platform/sound";
import { dailyLink, shareText, wibDate } from "./logic";

interface Props {
  gameId: string;
  /** Main result, e.g. "1,840 pts". */
  headline: string;
  /** One extra line of emoji stats. */
  detail?: string;
}

/** "Copy result" card on a Daily's results: score, today's rank, a link. */
export default function ShareDaily({ gameId, headline, detail }: Props) {
  const [rank, setRank] = useState<{ rank: number | null; players: number } | null>(null);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const meta = findGame(gameId)?.meta;

  useEffect(() => {
    let cancelled = false;
    api
      .dailies()
      .then((l) => {
        const d = l.find((x) => x.game_id === gameId);
        if (!cancelled && d) setRank({ rank: d.rank, players: d.players });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  if (!meta) return null;
  const text = shareText({
    icon: meta.icon,
    title: meta.title,
    date: wibDate(),
    headline,
    detail,
    rank: rank?.rank,
    players: rank?.players,
    url: `${window.location.origin}${dailyLink(gameId)}`,
  });
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("copied");
      playSfx("click");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <section className="share-daily" aria-label="Share your Daily result">
      <pre className="share-text">{text}</pre>
      <div className="game-controls">
        <button className="btn-sm" onClick={() => void copy()}>
          {copied === "copied" ? "✓ Copied!" : "📋 Copy result"}
        </button>
        {canShare && (
          <button className="btn-ghost btn-sm" onClick={() => void navigator.share({ text }).catch(() => undefined)}>
            📤 Share
          </button>
        )}
        {copied === "failed" && <small className="muted">Couldn't copy: select the text above instead.</small>}
      </div>
    </section>
  );
}
