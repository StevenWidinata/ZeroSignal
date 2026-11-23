import { useEffect, useRef, useState } from "react";
import { rooms } from "../../api/client";
import type { MemoryRoomInfo, RoomView } from "../../api/types";
import { currentAction } from "../../platform/keymap";
import { playSfx } from "../../platform/sound";
import { blockAt, describeLast, findPower, playerOf, positionAt, powerCode, rowOf, symbol, targetHint } from "./logic";

type Act = (fn: () => Promise<RoomView>) => Promise<boolean>;

/** How long a pair you (or your rival) turned over stays visible. */
const SHOW_MS = 1200;
/** …and under Fog. */
const FOG_MS = 600;

/**
 * The shared board during a game: scores, the cards, your power bar.
 * Cards are positions on the server's board; Mirror only changes where
 * each one is drawn.
 */
export default function Table({ room, act }: { room: RoomView; act: Act }) {
  const info = room.board.highlight as MemoryRoomInfo;
  const me = playerOf(room.you, room.first_seat);
  const them = (1 - me) as 0 | 1;
  const rival = room.players[room.you === 1 ? 1 : 0]?.username ?? "Your friend";
  const cells = info.cells;
  const myTurn = room.your_turn && !room.game_over;
  const fogged = myTurn && !!info.effects?.[me]?.fog;
  const mirrored = myTurn && !!info.effects?.[me]?.mirror;
  const lockedNow = !room.game_over && info.turn !== undefined ? (info.effects?.[info.turn]?.locked ?? []) : [];
  const myPowers = info.powers?.[me] ?? [];
  const theirPowers = info.powers?.[them] ?? [];
  const chaos = info.mode === "chaos";

  const [armed, setArmed] = useState<string | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [flash, setFlash] = useState<{ cards: [number, number][]; kind: "miss" | "match" } | null>(null);
  const [glow, setGlow] = useState<number[]>([]);
  const [peek, setPeek] = useState<[number, number][]>([]);
  /** Under Fog: the face-up card you may still see. */
  const [fogShown, setFogShown] = useState<number | null>(null);

  // Were you fogged before this move? (A miss ends your turn and clears it.)
  const wasFogged = useRef(false);
  // One timer per effect, so a quick next move never leaves one stuck on.
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const later = (key: string, ms: number, fn: () => void) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(fn, ms);
  };
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  const movesKey = `${room.game_no}:${room.moves}`;
  // React to each new move: sounds, the pair that was turned, glowing spots.
  useEffect(() => {
    const last = info.last;
    if (!last) return;
    if (last.kind === "flip") {
      playSfx("click");
      setFogShown(last.cards[0]?.[0] ?? null);
      later("fog", FOG_MS, () => setFogShown(null));
    } else if (last.kind === "match" || last.kind === "miss") {
      playSfx(last.kind === "match" ? "chime" : "whiff");
      setFlash({ cards: last.cards, kind: last.kind });
      later("flash", last.player === me && wasFogged.current ? FOG_MS : SHOW_MS, () => setFlash(null));
    } else {
      playSfx("powerup");
      setGlow(last.spots);
      later("glow", 1600, () => setGlow([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movesKey]);

  useEffect(() => {
    wasFogged.current = fogged;
  });

  // A private Peek / X-Ray look arrives only once: keep it for a moment.
  const revealKey = info.reveal?.length ? `${movesKey}:${JSON.stringify(info.reveal)}` : null;
  useEffect(() => {
    if (!info.reveal?.length) return;
    setPeek(info.reveal);
    later("peek", info.last?.power === "x-ray" ? 1500 : 2000, () => setPeek([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey]);

  // A turn change or a new game drops a half-picked power.
  useEffect(() => {
    setArmed(null);
    setPicked([]);
  }, [room.your_turn, room.game_no]);

  const power = armed ? findPower(armed) : undefined;
  const preview = power && picked.length === 1 ? (power.target === "block" ? blockAt(picked[0], info.cols, info.rows) : power.target === "row" ? rowCells(picked[0]) : picked) : picked;
  function rowCells(pos: number) {
    const r = rowOf(pos, info.cols);
    return Array.from({ length: info.cols }, (_, c) => r * info.cols + c);
  }

  const canUsePowers = myTurn && !!info.can_power;
  function arm(id: string) {
    if (!canUsePowers || myPowers.find((p) => p.id === id)?.used) return;
    setArmed((a) => (a === id ? null : id));
    setPicked([]);
  }
  function cancel() {
    setArmed(null);
    setPicked([]);
  }
  async function send(code: string) {
    cancel();
    await act(() => rooms.moveUci(room.code, code));
  }

  function tap(pos: number) {
    if (!myTurn) return;
    if (power) {
      if (power.target === "two") {
        if (cells[pos] !== 0) return;
        const next = picked.includes(pos) ? picked.filter((p) => p !== pos) : [...picked, pos].slice(-2);
        setPicked(next);
        const code = powerCode(power, next, info);
        if (code) void send(code);
      } else if (power.target === "block" || power.target === "row") {
        if (cells[pos] < 0 && power.target === "row" && !rowCells(pos).some((i) => cells[i] >= 0)) return;
        setPicked([pos]);
      }
      return;
    }
    if (cells[pos] !== 0 || lockedNow.includes(pos)) return;
    void act(() => rooms.move(room.code, pos));
  }

  // Keys: 1–3 pick a power, Esc cancels, arrows move between cards.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const a = currentAction("memory-match", e.code);
      if (!a) return;
      if (a === "cancel") {
        cancel();
        return;
      }
      if (a.startsWith("power")) {
        const p = myPowers[Number(a.slice(5)) - 1];
        if (p) {
          e.preventDefault();
          arm(p.id);
        }
        return;
      }
      const slot = Number((document.activeElement as HTMLElement | null)?.dataset?.slot ?? -1);
      const step = { left: -1, right: 1, up: -info.cols, down: info.cols }[a];
      if (step === undefined) return;
      e.preventDefault();
      const next = slot < 0 ? 0 : Math.max(0, Math.min(cells.length - 1, slot + step));
      document.querySelector<HTMLButtonElement>(`.mm-board [data-slot="${next}"]`)?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const flashAt = new Map(flash?.cards ?? []);
  const peekAt = new Map(peek);
  const lastLine = describeLast(info.last, me, rival);
  const pairs = info.pairs ?? [0, 0];
  const myEffects = info.effects?.[me];
  const pending = [myEffects?.fog && "🌫️ Fog", myEffects?.mirror && "🪞 Mirror", myEffects?.locked.length && "🔒 Lock"].filter(Boolean) as string[];
  const confirmCode = power && power.target !== "two" ? powerCode(power, picked, info) : null;

  return (
    <div className="mm-table">
      <div className="mm-score">
        <div className={`mm-side${info.turn === me && !room.game_over ? " to-move" : ""}`}>
          <strong>You · {pairs[me]} pairs</strong>
          {pending.length > 0 && <small className="mm-warn">{myTurn ? "On you now" : "Next turn"}: {pending.join(" · ")}</small>}
          {myEffects?.second_chance && <small className="mm-good">🍀 Second Chance is on</small>}
        </div>
        <div className={`mm-side mm-side-rival${info.turn === them && !room.game_over ? " to-move" : ""}`}>
          <strong>
            {rival} · {pairs[them]} pairs
          </strong>
          {chaos && theirPowers.length > 0 && (
            <span className="mm-chips" aria-label={`${rival}'s powers`}>
              {theirPowers.map((p) => {
                const def = findPower(p.id);
                return (
                  <span key={p.id} className={`mm-chip${p.used ? " used" : ""}`} title={`${def?.name}${p.used ? " (used)" : ""}`}>
                    {def?.icon}
                  </span>
                );
              })}
            </span>
          )}
        </div>
      </div>

      <p className="mm-last" role="status" aria-live="polite">
        {lastLine ?? " "}
      </p>

      <div
        className={`mm-board mm-${info.size}${fogged ? " fogged" : ""}${mirrored ? " mirrored" : ""}${power ? " targeting" : ""}`}
        style={{ ["--cols" as string]: info.cols }}
        role="grid"
        aria-label={`Memory board, ${info.cols} by ${info.rows}${mirrored ? ", mirrored" : ""}`}
      >
        {cells.map((_, slot) => {
          const pos = positionAt(slot, info.cols, mirrored);
          const c = cells[pos];
          const flashed = flashAt.get(pos);
          const peeked = peekAt.get(pos);
          let face: string | null = null;
          let cls = "";
          if (flashed !== undefined) {
            face = symbol(flashed);
            cls = flash?.kind === "match" ? " matched" : " missed";
          } else if (c > 0) {
            face = fogged && fogShown !== pos ? null : symbol(c - 1);
            cls = face ? " up" : " up fog-hidden";
          } else if (c === 0 && peeked !== undefined) {
            face = symbol(peeked);
            cls = " peek";
          }
          const taken = c < 0 && flashed === undefined;
          const locked = lockedNow.includes(pos) && c === 0;
          const clickable = myTurn && !taken && (power ? power.target !== "none" && c === 0 : c === 0 && !locked);
          const label = taken ? "taken" : face ? `card ${face}` : locked ? "locked card" : "face-down card";
          return (
            <button
              key={slot}
              type="button"
              data-slot={slot}
              className={`mm-card${cls}${taken ? " taken" : ""}${locked ? " locked" : ""}${glow.includes(pos) ? " glow" : ""}${preview.includes(pos) ? " picked" : ""}`}
              onClick={() => tap(pos)}
              disabled={!clickable}
              aria-label={`Row ${Math.floor(slot / info.cols) + 1}, ${label}`}
            >
              {!taken && (
                <span className="mm-card-inner">
                  <span className="mm-back" aria-hidden="true">
                    {locked ? "🔒" : "?"}
                  </span>
                  <span className="mm-front" aria-hidden="true">
                    {face ?? "?"}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {chaos && myPowers.length > 0 && (
        <div className="mm-powers">
          <div className="mm-powerbar" role="group" aria-label="Your powers">
            {myPowers.map((p, i) => {
              const def = findPower(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`mm-power${armed === p.id ? " armed" : ""}${p.used ? " used" : ""}`}
                  onClick={() => arm(p.id)}
                  disabled={p.used || !canUsePowers}
                  aria-pressed={armed === p.id}
                  title={def?.text}
                >
                  <span aria-hidden="true">{def?.icon}</span> {def?.name}
                  <small>{p.used ? "used" : `key ${i + 1}`}</small>
                </button>
              );
            })}
          </div>
          <div className="mm-power-hint">
            {power ? (
              <>
                <span>{targetHint(power)}</span>
                {power.target === "none" && (
                  <button className="btn-green btn-sm" onClick={() => void send(power.id)}>
                    {power.icon} Use {power.name}
                  </button>
                )}
                {confirmCode && power.target !== "none" && (
                  <button className="btn-green btn-sm" onClick={() => void send(confirmCode)}>
                    {power.icon} {power.target === "block" ? "Turn this block" : "X-Ray this row"}
                  </button>
                )}
                <button className="btn-ghost btn-sm" onClick={cancel}>
                  Cancel
                </button>
              </>
            ) : (
              <span className="wam-hint">
                {!myTurn
                  ? "Powers work on your turn."
                  : info.can_power
                    ? "Tap a power (one per turn, not while a card is half-flipped), or flip a card."
                    : "One power per turn: flip your cards."}
              </span>
            )}
          </div>
        </div>
      )}

      {room.game_over && info.stats && (
        <p className="mm-summary">
          You found {pairs[me]} of {pairs[0] + pairs[1]} pairs · {info.stats[me].misses} misses · best run {info.stats[me].best_run}
          {chaos ? ` · ${info.stats[me].powers} powers used` : ""}
        </p>
      )}
    </div>
  );
}
