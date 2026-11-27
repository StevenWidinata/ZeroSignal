import { useEffect, useMemo, useState, type ReactNode } from "react";
import { rooms } from "../api/client";
import type { OnlineGame, RoomView } from "../api/types";
import { EMOTES, EmoteBar, LiveAvatar } from "../character/Live";
import type { Pose } from "../character/Avatar";
import C4Board from "../games/connect-four/Board";
import type { Cells as C4Cells } from "../games/connect-four/logic";
import TttBoard from "../games/tic-tac-toe/Board";
import type { Cells as TttCells } from "../games/tic-tac-toe/logic";
import { playSfx } from "../platform/sound";
import { pingResult } from "../mascot/bus";
import { useRoom } from "./useRoom";

const GAME_NAME: Record<OnlineGame, string> = {
  "connect-four": "Connect Four",
  "tic-tac-toe": "Tic-Tac-Toe",
  chess: "Chess",
  sonar: "Sonar",
  checkers: "Checkers",
  "memory-match": "Memory Match",
};
/** Each seat's look: seat 1 (host) and seat 2 (friend). */
const C4_SKIN = ["red", "blue"];
const TTT_FACE = ["x", "o"];

/** The link a friend opens to join. */
export function roomLink(game: OnlineGame, code: string): string {
  return `${window.location.origin}/play/${game}?room=${code}`;
}

/** Things indexed by seat (1, 2), reordered so index 0 = whoever moves first. */
function byMover<T>(perSeat: T[], first: 1 | 2): [T, T] {
  return first === 1 ? [perSeat[0], perSeat[1]] : [perSeat[1], perSeat[0]];
}

function emoteOf(id: string | null) {
  return EMOTES.find((e) => e.id === id);
}

/** A game's own board for a room (chess brings its own, so its code loads only on the chess page). */
export type RoomBoard = (room: RoomView, act: (fn: () => Promise<RoomView>) => Promise<boolean>) => ReactNode;

export default function OnlineMatch({
  game,
  code,
  onExit,
  renderBoard,
  renderControls,
  leaveLabel = "✕ Leave room",
}: {
  game: OnlineGame;
  code: string;
  onExit: () => void;
  renderBoard?: RoomBoard;
  /** Extra buttons under the board (chess: offer a draw). */
  renderControls?: RoomBoard;
  leaveLabel?: string;
}) {
  const { room, error, fatal, act } = useRoom(code);
  const [myEmote, setMyEmote] = useState<{ emoji: string; pose: Pose; at: number } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copied, setCopied] = useState(false);

  // Play a sound when it becomes your turn and when a game ends.
  const yourTurn = room?.your_turn ?? false;
  const over = room?.game_over ?? false;
  useEffect(() => {
    if (yourTurn) playSfx("tick");
  }, [yourTurn]);
  useEffect(() => {
    if (!room || !over) return;
    const o = room.board.outcome;
    const winnerSeat = o.kind === "win" ? (o.winner === "p1" ? room.first_seat : 3 - room.first_seat) : 0;
    playSfx(winnerSeat === 0 ? "draw" : winnerSeat === room.you ? "win" : "lose");
    pingResult(winnerSeat === 0 ? "draw" : winnerSeat === room.you ? "cheer" : "sad");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over]);

  if (fatal || (!room && error)) {
    return (
      <div className="panel notice">
        <h2>Couldn't join room {code}</h2>
        <p>{error}</p>
        <button className="btn-green" onClick={onExit}>
          ← Back to menu
        </button>
      </div>
    );
  }
  if (!room) return <div className="loading">Joining room {code}</div>;

  const me = room.you;
  const them = (3 - me) as 1 | 2;
  const mine = room.players[me - 1];
  const theirs = room.players[them - 1];
  const mover = (seat: number) => (seat === room.first_seat ? 1 : 2);

  if (room.status === "waiting") {
    const link = roomLink(game, room.code);
    return (
      <div className="panel online-wait">
        <LiveAvatar loadout={mine?.avatar} pose="wave" size={96} />
        <h2>Waiting for your friend…</h2>
        <p>Send them this code or link. The game starts as soon as they join.</p>
        <div className="online-code" aria-label={`Room code ${room.code.split("").join(" ")}`}>
          {room.code}
        </div>
        <div className="game-controls">
          <button
            className="btn-blue btn-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(() => setCopied(true));
            }}
          >
            {copied ? "✓ Link copied" : "🔗 Copy invite link"}
          </button>
          <button className="btn-ghost btn-sm" onClick={() => void act(() => rooms.leave(room.code)).then(onExit)}>
            Cancel room
          </button>
        </div>
        <p className="wam-hint">
          {GAME_NAME[game]} · best of {room.best_of}. Your friend can open <strong>{link}</strong>, or pick Online → Join and type the code.
        </p>
      </div>
    );
  }

  // Board: P1 = the seat that moved first this game.
  const p1Seat = room.first_seat;
  const names = byMover(room.players.map((p) => p?.username ?? "?"), p1Seat);
  const turn = room.board.next === "p1" ? 1 : 2;
  const lastCell = room.moves.length ? Number(room.moves[room.moves.length - 1]) : null;
  const interactive = room.your_turn;
  const play = (cell: number) => {
    if (!room.your_turn) return;
    playSfx("drop");
    void act(() => rooms.move(room.code, cell));
  };

  let board: React.ReactNode;
  if (renderBoard) {
    board = renderBoard(room, act);
  } else if (game === "connect-four") {
    const cells = room.board.cells as C4Cells;
    const lastMove: [number, number] | null =
      lastCell === null ? null : [lastCell, cells[lastCell].filter(Boolean).length - 1];
    board = (
      <C4Board
        cells={cells}
        skins={byMover(C4_SKIN, p1Seat)}
        turn={turn}
        interactive={interactive}
        winningCells={(room.board.highlight as [number, number][] | null) ?? []}
        lastMove={lastMove}
        playerNames={names}
        onPlay={play}
      />
    );
  } else {
    board = (
      <TttBoard
        cells={room.board.cells as TttCells}
        board="classic"
        faces={byMover(TTT_FACE, p1Seat)}
        interactive={interactive}
        line={(room.board.highlight as [number, number, number] | null) ?? null}
        lastMove={lastCell}
        names={names}
        onPlay={play}
      />
    );
  }

  // Who won this game / the series, from my side.
  const gameWinnerSeat =
    room.game_over && room.board.outcome.kind === "win" ? (room.board.outcome.winner === "p1" ? p1Seat : 3 - p1Seat) : null;
  const seriesDone = room.status === "finished" || room.status === "abandoned";
  const iWon = seriesDone ? room.winner === me : gameWinnerSeat === me;
  const iLost = seriesDone ? room.winner === them : gameWinnerSeat === them;
  const myPose: Pose = iWon ? "cheer" : iLost ? "sad" : room.your_turn ? "think" : "idle";
  const theirPose: Pose = iLost ? "cheer" : iWon ? "sad" : !room.your_turn && room.status === "playing" && !room.game_over ? "think" : "idle";
  const theirEmote = emoteOf(theirs?.emote ?? null);

  const status = (() => {
    if (room.status === "abandoned") return room.winner === me ? `${theirs?.username ?? "Your friend"} left. You win the series!` : "You left this room.";
    if (room.status === "finished") {
      if (room.winner === 0) return "The series is a draw!";
      return room.winner === me ? "🏆 You won the series!" : `${theirs?.username} won the series.`;
    }
    if (room.game_over) {
      if (gameWinnerSeat === null) return `Game ${room.game_no} is a draw.`;
      return gameWinnerSeat === me ? `You won game ${room.game_no}!` : `${theirs?.username} won game ${room.game_no}.`;
    }
    if (theirs && !theirs.here) return `Waiting for ${theirs.username} to come back… (they forfeit after 2 minutes away)`;
    return room.your_turn ? "Your turn!" : `${theirs?.username ?? "Your friend"} is thinking…`;
  })();

  return (
    <div className={`c4-play online-play${game === "chess" ? " chess-play" : game === "sonar" ? " sonar-play" : game === "checkers" ? " ck-play" : game === "memory-match" ? " mm-play" : ""}`}>
      <div className="versus-bar">
        <div className="versus-side">
          <LiveAvatar loadout={mine?.avatar} pose={myPose} emote={myEmote} size={72} label="You" bubble={room.game_over || seriesDone} />
          <strong>You · {room.wins[me - 1]}</strong>
          <EmoteBar
            onEmote={(e) => {
              setMyEmote({ emoji: e.emoji, pose: e.pose, at: Date.now() });
              void act(() => rooms.emote(room.code, e.id));
            }}
          />
        </div>
        <span className="versus-vs" aria-hidden="true">
          VS
        </span>
        <div className="versus-side">
          <OpponentAvatar
            loadout={theirs?.avatar}
            pose={theirPose}
            emote={theirEmote && theirs?.emote_at ? { emoji: theirEmote.emoji, pose: theirEmote.pose, at: Date.parse(theirs.emote_at) } : null}
            label={theirs?.username ?? "Friend"}
          />
          <strong>
            {theirs?.username ?? "Friend"} · {room.wins[them - 1]} {theirs && !theirs.here && <span title="away">💤</span>}
          </strong>
          <small className="wam-hint">
            Game {room.game_no} · best of {room.best_of} · draws {room.draws} · {mover(me) === 1 ? "you moved first" : "they moved first"}
          </small>
        </div>
      </div>

      <div className="status-bar" role="status" aria-live="polite">
        {status}
      </div>

      {board}

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <div className="game-controls">
        {renderControls?.(room, act)}
        {room.status === "playing" && room.game_over && (
          <button className="btn-green" onClick={() => void act(() => rooms.next(room.code))}>
            ▶ Next game
          </button>
        )}
        {room.status === "finished" &&
          (mine?.rematch ? (
            <button disabled>Waiting for {theirs?.username} to accept…</button>
          ) : (
            <button className="btn-green" onClick={() => void act(() => rooms.rematch(room.code))}>
              {theirs?.rematch ? "✓ Accept rematch" : "↻ Rematch"}
            </button>
          ))}
        {room.status === "playing" &&
          (confirmLeave ? (
            <span className="g2048-confirm">
              Leave? {theirs?.username ?? "Your friend"} wins the series.
              <button className="btn-danger btn-sm" onClick={() => void act(() => rooms.leave(room.code))}>
                Yes, leave
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setConfirmLeave(false)}>
                Stay
              </button>
            </span>
          ) : (
            <button className="btn-ghost" onClick={() => setConfirmLeave(true)}>
              {leaveLabel}
            </button>
          ))}
        {seriesDone && (
          <button className="btn-ghost" onClick={onExit}>
            ← Back to menu
          </button>
        )}
      </div>
      <p className="wam-hint">
        Room <strong>{room.code}</strong> · the server checks every move. Winning a series pays 30 XP, a draw 15, a loss 10.
      </p>
    </div>
  );
}

/** The opponent's character; only replays an emote when a new one arrives. */
function OpponentAvatar({
  loadout,
  pose,
  emote,
  label,
}: {
  loadout: Record<string, string> | null | undefined;
  pose: Pose;
  emote: { emoji: string; pose: Pose; at: number } | null;
  label: string;
}) {
  const key = emote?.at ?? 0;
  // Ignore emotes older than a few seconds (e.g. when you first open the room).
  const fresh = useMemo(() => (emote && Date.now() - emote.at < 6000 ? emote : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <LiveAvatar loadout={loadout} pose={pose} emote={fresh} size={72} label={label} bubble={pose !== "idle"} />;
}
