import { useEffect, useState } from "react";
import { useCharacter } from "../store/character";
import { useAuth } from "../store/auth";
import type { Loadout } from "./catalog";
import Avatar, { type Pose } from "./Avatar";

/** Emotes: what the bubble shows and which pose the character plays. */
export const EMOTES: { id: string; emoji: string; label: string; pose: Pose }[] = [
  { id: "wave", emoji: "👋", label: "Wave", pose: "wave" },
  { id: "happy", emoji: "😀", label: "Happy", pose: "cheer" },
  { id: "wow", emoji: "😮", label: "Wow", pose: "think" },
  { id: "sad", emoji: "😢", label: "Sad", pose: "sad" },
  { id: "fire", emoji: "🔥", label: "On fire", pose: "cheer" },
];

const BUBBLE: Partial<Record<Pose, string>> = { wave: "👋", cheer: "🎉", sad: "😢", think: "💭" };

/** The robot opponent in AI games. */
export const ZERO_BOT: Loadout = {
  skin_tone: "skin-alien",
  glasses: "glasses-visor",
  shirt: "shirt-hoodie-gray",
  pants: "pants-long-gray",
  hat: "hat-beanie-gray",
  background: "bg-grid",
};

interface LiveProps {
  loadout: Loadout | null | undefined;
  pose?: Pose;
  /** A one-off emote; it plays for a moment, then the pose returns. */
  emote?: { emoji: string; pose: Pose; at: number } | null;
  size?: number;
  crop?: "full" | "head";
  label?: string;
  /** Show the pose's bubble (🎉, 😢, 💭, 👋). */
  bubble?: boolean;
}

/** An animated character with a speech bubble for poses and emotes. */
export function LiveAvatar({ loadout, pose = "idle", emote, size = 96, crop = "full", label, bubble = true }: LiveProps) {
  const [active, setActive] = useState<{ emoji: string; pose: Pose } | null>(null);

  useEffect(() => {
    if (!emote) return;
    setActive({ emoji: emote.emoji, pose: emote.pose });
    const id = window.setTimeout(() => setActive(null), 2200);
    return () => window.clearTimeout(id);
  }, [emote]);

  const shown = active?.pose ?? pose;
  const text = active?.emoji ?? (bubble ? BUBBLE[pose] : undefined);
  return (
    <span className="av-wrap">
      <Avatar loadout={loadout} animated pose={shown} size={size} crop={crop} label={label} />
      {text && (
        <span className="av-bubble" key={`${text}-${emote?.at ?? 0}`} aria-hidden="true">
          {text}
        </span>
      )}
    </span>
  );
}

/** Your own outfit (loads it once if needed). */
export function useMyLoadout(): Loadout | null {
  const user = useAuth((s) => s.user);
  const loadout = useCharacter((s) => s.view?.loadout ?? null);
  const load = useCharacter((s) => s.load);
  useEffect(() => {
    if (user && !loadout) void load();
  }, [user, loadout, load]);
  return loadout;
}

/** Your character reacting to a result: cheer (win / new best), wave (good game) or sad (loss). */
export function MyReaction({ pose, size = 88 }: { pose: Pose; size?: number }) {
  const loadout = useMyLoadout();
  const label = pose === "cheer" ? "Your character cheering" : pose === "sad" ? "Your character, a bit sad" : "Your character";
  return (
    <div className="my-reaction">
      <LiveAvatar loadout={loadout} pose={pose} size={size} label={label} />
    </div>
  );
}

/** A row of emote buttons; `onEmote` gets the chosen emote. */
export function EmoteBar({ onEmote }: { onEmote: (e: (typeof EMOTES)[number]) => void }) {
  return (
    <div className="emote-bar" role="group" aria-label="Emotes">
      {EMOTES.map((e) => (
        <button key={e.id} type="button" className="emote-btn" onClick={() => onEmote(e)} aria-label={e.label} title={e.label}>
          {e.emoji}
        </button>
      ))}
    </div>
  );
}

/** You vs your opponent, both animated; `turn` decides who is thinking. */
export function VersusBar({
  opponent,
  opponentName,
  turn,
  result,
}: {
  opponent: Loadout | null;
  opponentName: string;
  /** Whose move it is now. */
  turn: "me" | "them" | null;
  /** Set when the game is over. */
  result?: "win" | "loss" | "draw" | null;
}) {
  const me = useMyLoadout();
  const user = useAuth((s) => s.user);
  const [emote, setEmote] = useState<{ emoji: string; pose: Pose; at: number } | null>(null);

  const myPose: Pose = result === "win" ? "cheer" : result === "loss" ? "sad" : turn === "me" ? "think" : "idle";
  const theirPose: Pose = result === "loss" ? "cheer" : result === "win" ? "sad" : turn === "them" ? "think" : "idle";

  return (
    <div className="versus-bar">
      <div className="versus-side">
        <LiveAvatar loadout={me} pose={myPose} emote={emote} size={72} label="You" bubble={!!result} />
        <strong>{user?.is_guest ? "You" : user?.username ?? "You"}</strong>
        <EmoteBar onEmote={(e) => setEmote({ emoji: e.emoji, pose: e.pose, at: Date.now() })} />
      </div>
      <span className="versus-vs" aria-hidden="true">
        VS
      </span>
      <div className="versus-side">
        <LiveAvatar loadout={opponent} pose={theirPose} size={72} label={opponentName} bubble={turn === "them" || !!result} />
        <strong>{opponentName}</strong>
      </div>
    </div>
  );
}

/** The finished game's result from player 1's side (null while playing). */
export function gameResult(m: { game_over: boolean; outcome: { kind: string; winner?: string } }): "win" | "loss" | "draw" | null {
  if (!m.game_over) return null;
  if (m.outcome.kind === "win") return m.outcome.winner === "p1" ? "win" : "loss";
  return "draw";
}
