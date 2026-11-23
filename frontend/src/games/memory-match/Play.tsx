import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { memoryMatch } from "../../api/client";
import type { MemoryCollection, MemoryMode, MemorySize } from "../../api/types";
import GameHeader from "../../components/GameHeader";
import OnlineLobby from "../../online/OnlineLobby";
import { playSfx } from "../../platform/sound";
import { useWallet } from "../../store/wallet";
import Locker from "./Locker";
import { POWERS, SIZES } from "./logic";
import OnlineMemory from "./OnlineMemory";
import "./memory.css";

const MODES: { id: MemoryMode; icon: string; name: string; text: string }[] = [
  { id: "classic", icon: "🃏", name: "Classic", text: "Plain pairs. Pure memory: find a pair and go again." },
  { id: "chaos", icon: "⚡", name: "Chaos", text: "Each of you brings 3 power-ups that shuffle, swap, fog and confuse." },
];

/** Memory Match: online only. Pick a mode and size, open a room, or join one. */
export default function Play() {
  const [params, setParams] = useSearchParams();
  const roomParam = params.get("room");
  const [code, setCode] = useState<string | null>(roomParam ? roomParam.toUpperCase() : null);
  const [mode, setMode] = useState<MemoryMode>("classic");
  const [size, setSize] = useState<MemorySize>("medium");
  const [collection, setCollection] = useState<MemoryCollection | null>(null);
  const [lockerOpen, setLockerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coins = useWallet((s) => s.wallet?.coins ?? 0);
  const refreshWallet = useWallet((s) => s.refresh);

  useEffect(() => {
    memoryMatch
      .collection()
      .then(setCollection)
      .catch(() => setCollection(null));
  }, []);

  async function buy(id: string) {
    setBusy(true);
    setError(null);
    try {
      setCollection(await memoryMatch.buy(id));
      playSfx("reward");
      void refreshWallet();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not buy that");
    } finally {
      setBusy(false);
    }
  }

  const shop = { collection, coins, busy, onBuy: (id: string) => void buy(id) };
  const ownedCount = POWERS.filter((p) => p.price === null || collection?.powers.find((c) => c.id === p.id)?.owned).length;

  const header = (
    <GameHeader gameId="memory-match" tag={code ? <span className="tag tag-yellow">🌐 Online · {code}</span> : undefined} />
  );

  if (code)
    return (
      <>
        {header}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <OnlineMemory
          code={code}
          shop={shop}
          onExit={() => {
            setParams({}, { replace: true });
            setCode(null);
          }}
        />
      </>
    );

  return (
    <>
      {header}
      <div className="c4-menu mm-menu">
        <fieldset className="wam-modes mm-modes">
          <legend>Pick a mode</legend>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`wam-mode${mode === m.id ? " selected" : ""}`}
              aria-pressed={mode === m.id}
              onClick={() => setMode(m.id)}
            >
              <span className="wam-mode-icon" aria-hidden="true">
                {m.icon}
              </span>
              <strong>{m.name}</strong>
              <small>{m.text}</small>
            </button>
          ))}
        </fieldset>

        <OnlineLobby
          game="memory-match"
          options={{ memory_mode: mode, memory_size: size }}
          onEnter={(c) => {
            setParams({ room: c }, { replace: true });
            setCode(c);
          }}
          extra={
            <>
              <div className="row-label">
                <span id="mm-size">Board</span>
                <div className="segmented" role="radiogroup" aria-labelledby="mm-size">
                  {SIZES.map((s) => (
                    <button
                      key={s.id}
                      role="radio"
                      aria-checked={size === s.id}
                      className={`btn-sm${size === s.id ? "" : " btn-ghost"}`}
                      onClick={() => setSize(s.id)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="wam-hint">
                {mode === "chaos" ? "⚡ Chaos" : "🃏 Classic"} · {SIZES.find((s) => s.id === size)?.pairs} pairs. Your friend plays the room's mode and
                board.
              </p>
            </>
          }
        />

        <section className="panel mm-locker-panel">
          <div className="mm-locker-head">
            <span aria-hidden="true">🧰</span>
            <span className="mm-locker-sum">
              <strong>Power locker</strong>
              <small>
                {ownedCount}/{POWERS.length} owned · you have 🪙 {coins.toLocaleString()}
              </small>
            </span>
            <button className="btn-blue btn-sm" onClick={() => setLockerOpen((o) => !o)} aria-expanded={lockerOpen}>
              {lockerOpen ? "Close" : "Open"}
            </button>
          </div>
          {lockerOpen && <Locker collection={collection} coins={coins} busy={busy} onBuy={(id) => void buy(id)} />}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <p className="wam-hint">Chaos games: bring 3 different powers, each works once. 5 are free; the other 5 are bought once with coins.</p>
        </section>
      </div>
    </>
  );
}
